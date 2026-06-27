/**
 * Vinyl Collection Card
 * v2 - Discogs lookup, cover art, spinners
 */

const GENRES = [
  "Blues", "Brass & Military", "Children's", "Classical",
  "Electronic", "Folk, World, & Country", "Funk / Soul",
  "Hip Hop", "Jazz", "Latin", "Non-Music", "Pop",
  "Reggae", "Rock", "Stage & Screen"
];

class VinylCollectionCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._records = [];
    this._searchTimeout = null;
    this._discogsSearchTimeout = null;
    this._modalRecord = null;
    this._modalRating = 0;
    this._sortCol = "artist";
    this._sortDir = 1;
    this._deleteId = null;
    this._loading = false;
    this._saving = false;
    this._discogsResults = [];
    this._discogsSearching = false;
    this._hasDiscogsToken = null;
    this._discogsEnabled = null;
    this._selectedCoverUrl = null;
    this._spotifyResults = [];
    this._spotifySearching = false;
    this._spotifyError = null;
    this._spotifySearchTimeout = null;
    this._spotifyEnabled = null;
    this._playPickerRecord = null;
  }

  setConfig(config) { this._config = config || {}; }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._render();
      this._rendered = true;
      this._init();
    }
  }

  getCardSize() { return 8; }

  async _init() {
    await this._checkDiscogsToken();
    await this._search("");
  }

  async _checkDiscogsToken() {
    try {
      const r = await this._call("get_config", {});
      this._hasDiscogsToken = r.response.has_discogs_token === true;
      this._discogsEnabled = r.response.discogs_enabled === true;
      this._spotifyEnabled = r.response.spotify_enabled === true;
    } catch (e) {
      this._hasDiscogsToken = false;
      this._discogsEnabled = false;
      this._spotifyEnabled = true;
    }
  }

  _hasSpotifyIntegration() {
    return !!(this._hass && this._hass.config && (this._hass.config.components || []).includes("spotify"));
  }

  _getSpotifyPlayers() {
    if (!this._hass) return [];
    return Object.entries(this._hass.states)
      .filter(([id]) => id.startsWith("media_player.") && id.toLowerCase().includes("spotify"))
      .map(([id, state]) => ({ entity_id: id, name: state.attributes.friendly_name || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _call(service, data) {
    return this._hass.callService("vinyl_collection", service, data, undefined, true, true);
  }

  async _search(query) {
    this._setLoading(true);
    try {
      const r = await this._call("search", { query });
      this._records = r.response.results || [];
    } catch (e) {
      this._records = [];
    }
    this._setLoading(false);
    this._renderTable();
  }

  _setLoading(on) {
    this._loading = on;
    const el = this.shadowRoot.querySelector("#table-spinner");
    if (el) el.style.display = on ? "flex" : "none";
  }

  _setSaving(on) {
    this._saving = on;
    const btn = this.shadowRoot.querySelector("#dialog-save");
    const spinner = this.shadowRoot.querySelector("#save-spinner");
    if (btn) { btn.disabled = on; btn.style.opacity = on ? "0.6" : "1"; }
    if (spinner) spinner.style.display = on ? "inline-block" : "none";
  }

  _onSearchInput(v) {
    clearTimeout(this._searchTimeout);
    this._searchTimeout = setTimeout(() => this._search(v), 220);
  }

  async _saveRecord(data) {
    this._setSaving(true);
    try {
      if (data.record_id) {
        await this._call("update_record", data);
      } else {
        await this._call("add_record", data);
      }
      this._closeDialog();
      const q = this.shadowRoot.querySelector("#search-input").value;
      await this._search(q);
    } catch (e) {
      const el = this.shadowRoot.querySelector("#dialog-error");
      if (el) { el.textContent = "Save failed: " + e.message; el.style.display = "block"; }
    }
    this._setSaving(false);
  }

  async _deleteRecord(id) {
    const btn = this.shadowRoot.querySelector("#delete-confirm");
    if (btn) { btn.disabled = true; btn.style.opacity = "0.6"; }
    try {
      await this._call("remove_record", { record_id: id });
      this._closeDeleteDialog();
      const q = this.shadowRoot.querySelector("#search-input").value;
      await this._search(q);
    } catch (e) {
      this._closeDeleteDialog();
    }
    if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
  }

  _openDeleteDialog(id) {
    this._deleteId = id;
    const rec = this._records.find(r => r.record_id === id);
    const label = rec ? rec.artist + " - " + rec.album : "this record";
    this.shadowRoot.querySelector("#delete-msg").textContent = "Remove \"" + label + "\" from your collection?";
    this.shadowRoot.querySelector("#delete-overlay").classList.add("open");
  }

  _closeDeleteDialog() {
    this._deleteId = null;
    this.shadowRoot.querySelector("#delete-overlay").classList.remove("open");
  }

  _openDialog(record) {
    this._modalRecord = record || {};
    this._modalRating = record ? (record.rating || 0) : 0;
    this._discogsResults = [];
    this._discogsSearching = false;
    this._selectedCoverUrl = record ? (record.cover_url || null) : null;
    this._renderDialog();
    this.shadowRoot.querySelector("#dialog-overlay").classList.add("open");
  }

  _closeDialog() {
    this.shadowRoot.querySelector("#dialog-overlay").classList.remove("open");
    this.shadowRoot.querySelector("#artist-suggestions").style.display = "none";
    clearTimeout(this._discogsSearchTimeout);
  }

  _setSort(col) {
    if (this._sortCol === col) { this._sortDir *= -1; }
    else { this._sortCol = col; this._sortDir = 1; }
    this._renderTable();
  }

  _sortedRecords() {
    const col = this._sortCol;
    return [...this._records].sort((a, b) => {
      let av = a[col] != null ? a[col] : "";
      let bv = b[col] != null ? b[col] : "";
      if (typeof av === "number" || typeof bv === "number") {
        av = Number(av) || 0; bv = Number(bv) || 0;
      } else {
        av = String(av).toLowerCase(); bv = String(bv).toLowerCase();
      }
      return av < bv ? -this._sortDir : av > bv ? this._sortDir : 0;
    });
  }

  _starsHTML(n) {
    let html = "<span class=\"stars\">";
    for (let i = 1; i <= 5; i++) {
      html += "<span class=\"star" + (i <= n ? " on" : "") + "\">&#9733;</span>";
    }
    return html + "</span>";
  }

  _coverHTML(url, size) {
    size = size || 40;
    if (url) {
      return "<img src=\"" + this._esc(url) + "\" width=\"" + size + "\" height=\"" + size + "\" style=\"border-radius:4px;object-fit:cover;display:block;\" onerror=\"this.style.display='none';this.nextSibling.style.display='block';\"/>" +
        "<ha-icon icon=\"mdi:album\" style=\"display:none;width:" + size + "px;height:" + size + "px;color:var(--secondary-text-color);\"></ha-icon>";
    }
    return "<ha-icon icon=\"mdi:album\" style=\"width:" + size + "px;height:" + size + "px;color:var(--secondary-text-color);\"></ha-icon>";
  }

  _genreOptions(selected) {
    return GENRES.map(g =>
      "<option value=\"" + g + "\"" + (g === selected ? " selected" : "") + ">" + g + "</option>"
    ).join("") + "<option value=\"__custom__\">Other (custom)...</option>";
  }

  _uniqueArtists() {
    const seen = new Set();
    this._records.forEach(r => { if (r.artist) seen.add(r.artist); });
    return Array.from(seen).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  _updateArtistSuggestions(value) {
    const root = this.shadowRoot;
    const suggestions = root.querySelector("#artist-suggestions");
    if (!value.trim()) { suggestions.style.display = "none"; return; }
    const matches = this._uniqueArtists().filter(a =>
      a.toLowerCase().includes(value.toLowerCase()) && a.toLowerCase() !== value.toLowerCase()
    );
    if (matches.length === 0) { suggestions.style.display = "none"; return; }
    suggestions.innerHTML = matches.slice(0, 6).map(a =>
      "<div class=\"suggestion\" data-value=\"" + this._esc(a) + "\">" + this._esc(a) + "</div>"
    ).join("");
    suggestions.style.display = "block";
    suggestions.querySelectorAll(".suggestion").forEach(el => {
      el.addEventListener("mousedown", e => {
        e.preventDefault();
        root.querySelector("#f-artist").value = el.dataset.value;
        suggestions.style.display = "none";
      });
    });
  }

  async _doDiscogsSearch() {
    const root = this.shadowRoot;
    const query = root.querySelector("#discogs-search-input").value.trim();
    if (!query) return;

    this._discogsSearching = true;
    this._renderDiscogsResults();

    try {
      const r = await this._call("lookup_discogs", { query });
      this._discogsResults = r.response.results || [];
    } catch (e) {
      this._discogsResults = [];
    }

    this._discogsSearching = false;
    this._renderDiscogsResults();
  }

  _renderDiscogsResults() {
    const root = this.shadowRoot;
    const container = root.querySelector("#discogs-results");
    if (!container) return;

    if (this._discogsSearching) {
      container.innerHTML =
        "<div style=\"display:flex;align-items:center;gap:8px;padding:12px;color:var(--secondary-text-color);font-size:13px;\">" +
        "<div class=\"spinner\" style=\"width:16px;height:16px;border-width:2px;\"></div>Searching Discogs..." +
        "</div>";
      container.style.display = "block";
      return;
    }

    if (this._discogsResults.length === 0) {
      container.style.display = "none";
      return;
    }

    container.innerHTML = this._discogsResults.map((r, i) =>
      "<div class=\"discogs-result\" data-index=\"" + i + "\">" +
      "<div class=\"discogs-thumb\">" + this._coverHTML(r.cover_url, 48) + "</div>" +
      "<div class=\"discogs-info\">" +
      "<div class=\"discogs-title\">" + this._esc(r.artist) + " - " + this._esc(r.album) + "</div>" +
      "<div class=\"discogs-meta\">" +
      (r.year ? r.year + " " : "") +
      (r.format ? "&bull; " + this._esc(r.format) + " " : "") +
      (r.label ? "&bull; " + this._esc(r.label) + " " : "") +
      (r.country ? "&bull; " + this._esc(r.country) : "") +
      "</div>" +
      "</div>" +
      "</div>"
    ).join("");

    container.style.display = "block";

    container.querySelectorAll(".discogs-result").forEach(el => {
      el.addEventListener("click", () => {
        const result = this._discogsResults[parseInt(el.dataset.index)];
        this._applyDiscogsResult(result);
      });
    });
  }

  _applyDiscogsResult(result) {
    const root = this.shadowRoot;

    root.querySelector("#f-artist").value = result.artist || "";
    root.querySelector("#f-album").value = result.album || "";
    root.querySelector("#f-year").value = result.year || "";

    const genreSelect = root.querySelector("#f-genre-select");
    const genreCustom = root.querySelector("#f-genre-custom");
    const genre = result.genre || "";
    const isCustomGenre = genre !== "" && !GENRES.includes(genre);
    genreSelect.innerHTML = "<option value=\"\">--</option>" + this._genreOptions(isCustomGenre ? "" : genre);
    if (isCustomGenre) {
      genreSelect.value = "__custom__";
      genreCustom.value = genre;
      genreCustom.style.display = "block";
    } else {
      genreSelect.value = genre;
      genreCustom.style.display = "none";
    }

    root.querySelector("#f-label").value = result.label || "";
    root.querySelector("#f-catalog-number").value = result.catalog_number || "";
    root.querySelector("#f-discogs-id").value = result.discogs_id || "";
    root.querySelector("#f-cover-url").value = result.cover_url || "";
    root.querySelector("#f-spotify-uri").value = result.spotify_uri || "";

    this._selectedCoverUrl = result.cover_url || null;
    this._renderCoverPreview();

    root.querySelector("#discogs-results").style.display = "none";
    root.querySelector("#discogs-search-input").value = "";
    this._discogsResults = [];
  }

  _renderCoverPreview() {
    const root = this.shadowRoot;
    const preview = root.querySelector("#cover-preview");
    if (!preview) return;
    preview.innerHTML = this._coverHTML(this._selectedCoverUrl, 80);
    preview.style.display = this._selectedCoverUrl ? "block" : "none";
  }

  _render() {
    const root = this.shadowRoot;
    root.innerHTML =
      "<style>" +
      "* { box-sizing: border-box; margin: 0; padding: 0; }" +
      ":host { display: block; font-family: var(--paper-font-body1_-_font-family, sans-serif); }" +
      "ha-card { padding: 16px 20px; }" +
      ".toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }" +
      ".search-input { flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--divider-color, #ccc); background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5)); color: var(--primary-text-color); font-size: 14px; font-family: inherit; outline: none; }" +
      ".search-input:focus { border-color: var(--primary-color); }" +
      ".add-btn { padding: 0 16px; height: 36px; border-radius: 18px; border: none; background: var(--primary-color); color: var(--text-primary-color, #fff); font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap; font-family: inherit; }" +
      ".add-btn:hover { opacity: 0.85; }" +
      ".count { font-size: 12px; color: var(--secondary-text-color); margin-bottom: 8px; }" +
      ".table-wrap { overflow-x: auto; position: relative; min-height: 60px; }" +
      "table { width: 100%; border-collapse: collapse; font-size: 13px; }" +
      "thead th { text-align: left; padding: 6px 8px; font-size: 12px; color: var(--secondary-text-color); border-bottom: 1px solid var(--divider-color); cursor: pointer; user-select: none; white-space: nowrap; }" +
      "thead th:hover { color: var(--primary-text-color); }" +
      "thead th .arrow { margin-left: 3px; opacity: 0.5; font-size: 10px; }" +
      "thead th.active { color: var(--primary-color); }" +
      "thead th.active .arrow { opacity: 1; }" +
      "tbody tr { border-bottom: 1px solid var(--divider-color); }" +
      "tbody tr:hover { background: var(--secondary-background-color); }" +
      "td { padding: 6px 8px; vertical-align: middle; }" +
      "td.cover-cell { width: 48px; padding: 4px 8px; }" +
      "td.actions { white-space: nowrap; text-align: right; }" +
      ".icon-btn { background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px; opacity: 0.6; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; color: var(--secondary-text-color); }" +
      ".icon-btn:hover { opacity: 1; background: var(--secondary-background-color); color: var(--primary-text-color); }" +
      ".stars { font-size: 14px; letter-spacing: 1px; color: var(--disabled-text-color, #ccc); }" +
      ".stars .star.on { color: #f4a820; }" +
      ".empty { text-align: center; padding: 32px; color: var(--secondary-text-color); font-size: 13px; }" +
      "@keyframes spin { to { transform: rotate(360deg); } }" +
      ".spinner { width: 24px; height: 24px; border: 3px solid var(--divider-color, #ccc); border-top-color: var(--primary-color); border-radius: 50%; animation: spin 0.7s linear infinite; }" +
      ".spinner-wrap { display: none; position: absolute; inset: 0; align-items: center; justify-content: center; background: var(--card-background-color, rgba(255,255,255,0.7)); z-index: 2; min-height: 60px; }" +
      ".spinner-inline { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; display: none; margin-left: 8px; vertical-align: middle; }" +
      ".overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9999; align-items: center; justify-content: center; }" +
      ".overlay.open { display: flex; }" +
      ".dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 12px; width: 90%; max-width: 500px; max-height: 90vh; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }" +
      ".dialog h3 { font-size: 18px; font-weight: 500; }" +
      ".discogs-search-row { margin-bottom: 0; }" +
      ".discogs-search-row input { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc); background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5)); color: var(--primary-text-color); font-size: 14px; font-family: inherit; outline: none; }" +
      ".discogs-search-row input:focus { border-color: var(--primary-color); }" +
      ".discogs-search-row input:disabled { opacity: 0.45; cursor: not-allowed; }" +
      ".discogs-hint { margin-top: 6px; font-size: 12px; color: var(--secondary-text-color); line-height: 1.4; display: none; }" +
      ".discogs-disabled-notice { display: none; font-size: 13px; color: var(--secondary-text-color); background: var(--secondary-background-color, #f5f5f5); border-radius: 8px; padding: 10px 14px; line-height: 1.5; }" +
      ".discogs-results { display: none; border: 1px solid var(--divider-color, #ccc); border-radius: 8px; overflow: hidden; }" +
      ".discogs-result { display: flex; gap: 12px; padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--divider-color, #eee); align-items: center; }" +
      ".discogs-result:last-child { border-bottom: none; }" +
      ".discogs-result:hover { background: var(--secondary-background-color); }" +
      ".discogs-thumb { flex-shrink: 0; }" +
      ".discogs-info { flex: 1; min-width: 0; }" +
      ".discogs-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }" +
      ".discogs-meta { font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; }" +
      ".discogs-divider { border: none; border-top: 1px solid var(--divider-color, #ccc); margin: 4px 0 0 0; }" +
      ".cover-preview { display: none; }" +
      ".cover-and-fields { display: flex; gap: 14px; align-items: flex-start; }" +
      ".cover-and-fields .fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; }" +
      "label { display: block; font-size: 12px; color: var(--secondary-text-color); margin-bottom: 3px; }" +
      "input[type=text], input[type=number], select, textarea { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc); background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5)); color: var(--primary-text-color); font-size: 14px; font-family: inherit; outline: none; }" +
      "input[type=text]:focus, input[type=number]:focus, select:focus, textarea:focus { border-color: var(--primary-color); }" +
      "textarea { resize: vertical; min-height: 60px; }" +
      ".row2 { display: flex; gap: 12px; }" +
      ".row2 > div { flex: 1; }" +
      ".artist-wrap { position: relative; }" +
      ".suggestions { position: absolute; top: 100%; left: 0; right: 0; background: var(--card-background-color, #fff); border: 1px solid var(--divider-color, #ccc); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10; display: none; max-height: 200px; overflow-y: auto; }" +
      ".suggestion { padding: 8px 12px; cursor: pointer; font-size: 14px; color: var(--primary-text-color); }" +
      ".suggestion:hover { background: var(--secondary-background-color); }" +
      ".star-pick { display: flex; gap: 8px; padding: 4px 0; }" +
      ".star-pick .star { font-size: 28px; cursor: pointer; color: var(--disabled-text-color, #ccc); line-height: 1; }" +
      ".star-pick .star.on { color: #f4a820; }" +
      ".dialog-error { display: none; font-size: 13px; color: var(--error-color, #db4437); }" +
      ".dialog-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 4px; }" +
      ".btn { padding: 0 16px; height: 36px; border-radius: 18px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: inherit; border: none; display: inline-flex; align-items: center; }" +
      ".btn-cancel { background: none; color: var(--primary-color); border: 1px solid var(--divider-color, #ccc); }" +
      ".btn-save { background: var(--primary-color); color: var(--text-primary-color, #fff); }" +
      ".btn-delete { background: var(--error-color, #db4437); color: #fff; }" +
      ".btn:hover { opacity: 0.85; }" +
      ".btn:disabled { cursor: not-allowed; }" +
      ".delete-dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 12px; width: 90%; max-width: 360px; padding: 24px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }" +
      ".delete-dialog h3 { font-size: 16px; font-weight: 500; }" +
      ".delete-dialog p { font-size: 14px; color: var(--secondary-text-color); line-height: 1.5; }" +
      ".spotify-section { display: flex; flex-direction: column; gap: 6px; }" +
      ".spotify-header { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--secondary-text-color); line-height: 1; }" +
      ".spotify-header ha-icon { display: flex; align-items: center; --mdc-icon-size: 16px; width: 16px; height: 16px; }" +
      ".spotify-not-installed { font-size: 12px; color: var(--secondary-text-color); display: none; }" +
      ".spotify-disabled-notice { font-size: 13px; color: var(--secondary-text-color); background: var(--secondary-background-color, #f5f5f5); border-radius: 8px; padding: 10px 14px; line-height: 1.5; display: none; }" +
      ".spotify-search-row input { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc); background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5)); color: var(--primary-text-color); font-size: 14px; font-family: inherit; outline: none; }" +
      ".spotify-search-row input:focus { border-color: #1DB954; }" +
      ".spotify-results { display: none; border: 1px solid var(--divider-color, #ccc); border-radius: 8px; overflow: hidden; max-height: 220px; overflow-y: auto; }" +
      ".spotify-result { display: flex; gap: 12px; padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--divider-color, #eee); align-items: center; }" +
      ".spotify-result:last-child { border-bottom: none; }" +
      ".spotify-result:hover { background: var(--secondary-background-color); }" +
      ".spotify-info { flex: 1; min-width: 0; }" +
      ".spotify-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }" +
      ".spotify-meta { font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }" +
      ".spotify-help { font-size: 12px; color: var(--secondary-text-color); line-height: 1.5; }" +
      ".spotify-saved { display: none; font-size: 13px; color: #1DB954; background: rgba(29,185,84,0.08); border-radius: 6px; padding: 8px 12px; display: none; align-items: center; gap: 6px; }" +
      ".play-btn { color: #1DB954; }" +
      ".btn-spotify { background: #1DB954; color: #fff; }" +
      ".btn-spotify:disabled { background: var(--disabled-color, #bdbdbd); cursor: not-allowed; opacity: 0.6; }" +
      ".play-picker-dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 12px; width: 90%; max-width: 360px; padding: 24px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-height: 80vh; overflow-y: auto; }" +
      ".play-picker-dialog h3 { font-size: 16px; font-weight: 500; }" +
      ".entity-list { display: flex; flex-direction: column; gap: 2px; }" +
      ".entity-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; border-radius: 6px; font-size: 14px; }" +
      ".entity-item:hover { background: var(--secondary-background-color); }" +
      ".entity-item.last-used { font-weight: 500; }" +
      "</style>" +
      "<ha-card>" +
      "<div class=\"toolbar\">" +
      "<input type=\"text\" class=\"search-input\" id=\"search-input\" placeholder=\"Search artist, album, genre...\" autocomplete=\"off\"/>" +
      "<button class=\"add-btn\" id=\"add-btn\">+ Add Record</button>" +
      "</div>" +
      "<div class=\"count\" id=\"count\"></div>" +
      "<div class=\"table-wrap\">" +
      "<div class=\"spinner-wrap\" id=\"table-spinner\"><div class=\"spinner\"></div></div>" +
      "<table>" +
      "<thead id=\"thead\"><tr>" +
      "<th></th>" +
      "<th data-col=\"artist\">Artist<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"album\">Album<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"year\">Year<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"rating\">Rating<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"genre\">Genre<span class=\"arrow\">-</span></th>" +
      "<th></th>" +
      "</tr></thead>" +
      "<tbody id=\"tbody\"></tbody>" +
      "</table>" +
      "</div>" +
      "</ha-card>" +
      "<div class=\"overlay\" id=\"dialog-overlay\">" +
      "<div class=\"dialog\">" +
      "<h3 id=\"dialog-title\">Add Record</h3>" +
      "<div class=\"discogs-disabled-notice\" id=\"discogs-disabled-notice\">You can enable record search using the Discogs API. To do this, navigate to Settings → Devices &amp; Services → Vinyl Collection → Configure.</div>" +
      "<div id=\"discogs-section\">" +
      "<div class=\"discogs-search-row\">" +
      "<input type=\"text\" id=\"discogs-search-input\" autocomplete=\"off\"/>" +
      "<p class=\"discogs-hint\" id=\"discogs-hint\">To enable Discogs search, add a Discogs token in the integration settings (Settings → Devices &amp; Services → Vinyl Collection → Configure).</p>" +
      "</div>" +
      "<div class=\"discogs-results\" id=\"discogs-results\"></div>" +
      "<hr class=\"discogs-divider\"/>" +
      "</div>" +
      "<div class=\"cover-and-fields\">" +
      "<div class=\"cover-preview\" id=\"cover-preview\"></div>" +
      "<div class=\"fields\">" +
      "<div><label>Artist *</label>" +
      "<div class=\"artist-wrap\">" +
      "<input type=\"text\" id=\"f-artist\" autocomplete=\"off\"/>" +
      "<div class=\"suggestions\" id=\"artist-suggestions\"></div>" +
      "</div></div>" +
      "<div><label>Album *</label><input type=\"text\" id=\"f-album\" autocomplete=\"off\"/></div>" +
      "<div><label>Year</label><input type=\"number\" id=\"f-year\" min=\"1900\" max=\"2100\"/></div>" +
      "<div><label>Genre</label><select id=\"f-genre-select\"><option value=\"\">--</option>" + this._genreOptions("") + "</select>" +
      "<input type=\"text\" id=\"f-genre-custom\" placeholder=\"Enter genre...\" autocomplete=\"off\" style=\"margin-top:6px;display:none;\"/></div>" +
      "<div><label>Rating</label>" +
      "<div class=\"star-pick\" id=\"star-pick\">" +
      "<span class=\"star\" data-v=\"1\">&#9733;</span>" +
      "<span class=\"star\" data-v=\"2\">&#9733;</span>" +
      "<span class=\"star\" data-v=\"3\">&#9733;</span>" +
      "<span class=\"star\" data-v=\"4\">&#9733;</span>" +
      "<span class=\"star\" data-v=\"5\">&#9733;</span>" +
      "</div></div>" +
      "</div>" +
      "</div>" +
      "<input type=\"hidden\" id=\"f-label\"/>" +
      "<input type=\"hidden\" id=\"f-catalog-number\"/>" +
      "<input type=\"hidden\" id=\"f-discogs-id\"/>" +
      "<input type=\"hidden\" id=\"f-cover-url\"/>" +
      "<input type=\"hidden\" id=\"f-spotify-uri\"/>" +
      "<p class=\"spotify-not-installed\" id=\"spotify-not-installed\">Activating the Spotify integration will enable linking and playback.</p>" +
      "<div class=\"spotify-disabled-notice\" id=\"spotify-disabled-notice\">You can enable Spotify search and playback. To do this, navigate to Settings → Devices &amp; Services → Vinyl Collection → Configure.</div>" +
      "<div class=\"spotify-section\" id=\"spotify-section\">" +
      "<div class=\"spotify-header\"><ha-icon icon=\"mdi:spotify\" style=\"color:#1DB954;\"></ha-icon><span>Spotify</span></div>" +
      "<p class=\"spotify-help\">You can link this record to Spotify. This will enable you to play the album on a media player of your choice.</p>" +
      "<div class=\"spotify-saved\" id=\"spotify-saved\"></div>" +
      "<button class=\"btn btn-spotify\" id=\"spotify-search-btn\" style=\"align-self:flex-start;\" disabled>Search Spotify</button>" +
      "<div class=\"spotify-results\" id=\"spotify-results\"></div>" +
      "</div>" +
      "<div class=\"dialog-error\" id=\"dialog-error\"></div>" +
      "<div class=\"dialog-actions\">" +
      "<button class=\"btn btn-cancel\" id=\"dialog-cancel\">Cancel</button>" +
      "<button class=\"btn btn-save\" id=\"dialog-save\">Save<span class=\"spinner-inline\" id=\"save-spinner\"></span></button>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "<div class=\"overlay\" id=\"delete-overlay\">" +
      "<div class=\"delete-dialog\">" +
      "<h3>Remove Record</h3>" +
      "<p id=\"delete-msg\"></p>" +
      "<div class=\"dialog-actions\">" +
      "<button class=\"btn btn-cancel\" id=\"delete-cancel\">Cancel</button>" +
      "<button class=\"btn btn-delete\" id=\"delete-confirm\">Remove</button>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "<div class=\"overlay\" id=\"play-picker-overlay\">" +
      "<div class=\"play-picker-dialog\">" +
      "<h3>Play on...</h3>" +
      "<div class=\"entity-list\" id=\"entity-list\"></div>" +
      "<div class=\"dialog-actions\">" +
      "<button class=\"btn btn-cancel\" id=\"play-picker-cancel\">Cancel</button>" +
      "</div>" +
      "</div>" +
      "</div>";

    root.querySelector("#search-input").addEventListener("input", e => this._onSearchInput(e.target.value));
    root.querySelector("#add-btn").addEventListener("click", () => this._openDialog(null));

    root.querySelector("#thead").querySelectorAll("th[data-col]").forEach(th => {
      th.addEventListener("click", () => this._setSort(th.dataset.col));
    });

    root.querySelectorAll("#star-pick .star").forEach(s => {
      s.addEventListener("click", () => {
        const v = parseInt(s.dataset.v);
        this._modalRating = this._modalRating === v ? 0 : v;
        this._updateStars();
      });
    });

    root.querySelector("#f-artist").addEventListener("input", e => {
      this._updateArtistSuggestions(e.target.value);
      this._updateSpotifyBtn();
    });

    root.querySelector("#f-album").addEventListener("input", () => this._updateSpotifyBtn());
    root.querySelector("#f-artist").addEventListener("blur", () => {
      setTimeout(() => {
        const s = root.querySelector("#artist-suggestions");
        if (s) s.style.display = "none";
      }, 150);
    });

    root.querySelector("#f-genre-select").addEventListener("change", e => {
      const custom = root.querySelector("#f-genre-custom");
      if (e.target.value === "__custom__") {
        custom.style.display = "block";
        custom.focus();
      } else {
        custom.style.display = "none";
      }
    });

    root.querySelector("#discogs-search-input").addEventListener("input", e => {
      const val = e.target.value.trim();
      clearTimeout(this._discogsSearchTimeout);
      if (val.length < 3) {
        this.shadowRoot.querySelector("#discogs-results").style.display = "none";
        return;
      }
      this._discogsSearchTimeout = setTimeout(() => this._doDiscogsSearch(), 500);
    });

    root.querySelector("#dialog-save").addEventListener("click", () => this._onSave());
    root.querySelector("#dialog-cancel").addEventListener("click", () => this._closeDialog());
    root.querySelector("#dialog-overlay").addEventListener("click", e => {
      if (e.target === root.querySelector("#dialog-overlay")) this._closeDialog();
    });

    root.querySelector("#delete-confirm").addEventListener("click", () => {
      if (this._deleteId) this._deleteRecord(this._deleteId);
    });
    root.querySelector("#delete-cancel").addEventListener("click", () => this._closeDeleteDialog());
    root.querySelector("#delete-overlay").addEventListener("click", e => {
      if (e.target === root.querySelector("#delete-overlay")) this._closeDeleteDialog();
    });

    root.querySelector("#spotify-search-btn").addEventListener("click", () => this._doSpotifySearch());

    root.querySelector("#play-picker-cancel").addEventListener("click", () => this._closePlayPicker());
    root.querySelector("#play-picker-overlay").addEventListener("click", e => {
      if (e.target === root.querySelector("#play-picker-overlay")) this._closePlayPicker();
    });
  }

  _renderDialog() {
    const r = this._modalRecord || {};
    const isEdit = !!r.record_id;
    const root = this.shadowRoot;
    const genre = r.genre || "";
    const isCustomGenre = genre !== "" && !GENRES.includes(genre);

    root.querySelector("#dialog-title").textContent = isEdit ? "Edit Record" : "Add Record";
    root.querySelector("#dialog-save").childNodes[0].textContent = isEdit ? "Save Changes" : "Add to Collection";
    root.querySelector("#dialog-error").style.display = "none";
    root.querySelector("#artist-suggestions").style.display = "none";

    const discogsSection = root.querySelector("#discogs-section");
    const discogsDisabledNotice = root.querySelector("#discogs-disabled-notice");
    const discogsActive = !isEdit && this._discogsEnabled;
    discogsSection.style.display = discogsActive ? "block" : "none";
    if (discogsDisabledNotice) discogsDisabledNotice.style.display = (!isEdit && !this._discogsEnabled) ? "block" : "none";

    if (!isEdit) {
      const hasToken = this._hasDiscogsToken === true;
      const searchInput = root.querySelector("#discogs-search-input");
      const hint = root.querySelector("#discogs-hint");
      searchInput.disabled = !hasToken;
      searchInput.placeholder = "Search for your record (powered by Discogs)";
      searchInput.value = "";
      if (hint) hint.style.display = hasToken ? "none" : "block";
      root.querySelector("#discogs-results").style.display = "none";
    }

    root.querySelector("#f-artist").value = r.artist || "";
    root.querySelector("#f-album").value = r.album || "";
    root.querySelector("#f-year").value = r.year || "";
    root.querySelector("#f-label").value = r.label || "";
    root.querySelector("#f-catalog-number").value = r.catalog_number || "";
    root.querySelector("#f-discogs-id").value = r.discogs_id || "";
    root.querySelector("#f-cover-url").value = r.cover_url || "";
    root.querySelector("#f-spotify-uri").value = r.spotify_uri || "";

    const genreSelect = root.querySelector("#f-genre-select");
    const genreCustom = root.querySelector("#f-genre-custom");
    genreSelect.innerHTML = "<option value=\"\">--</option>" + this._genreOptions(isCustomGenre ? "" : genre);

    if (isCustomGenre) {
      genreSelect.value = "__custom__";
      genreCustom.value = genre;
      genreCustom.style.display = "block";
    } else {
      genreSelect.value = genre;
      genreCustom.value = "";
      genreCustom.style.display = "none";
    }

    // Spotify section — only relevant if Spotify integration is installed
    const spotifySection = root.querySelector("#spotify-section");
    const spotifyDisabledNotice = root.querySelector("#spotify-disabled-notice");
    const spotifyNotInstalled = root.querySelector("#spotify-not-installed");
    const spotifyInstalled = this._hasSpotifyIntegration();
    if (spotifyNotInstalled) spotifyNotInstalled.style.display = !spotifyInstalled ? "block" : "none";
    if (spotifyDisabledNotice) spotifyDisabledNotice.style.display = (spotifyInstalled && !this._spotifyEnabled) ? "block" : "none";
    if (spotifySection) spotifySection.style.display = (spotifyInstalled && this._spotifyEnabled) ? "flex" : "none";

    this._spotifyResults = [];
    this._spotifyError = null;
    this._renderSpotifyResults();

    const spotifySaved = root.querySelector("#spotify-saved");
    if (spotifySaved) {
      if (r.spotify_uri) {
        this._showSpotifyLinked(root);
      } else {
        spotifySaved.innerHTML = "";
        spotifySaved.style.display = "none";
      }
    }

    this._updateSpotifyBtn();
    this._renderCoverPreview();
    this._setSaving(false);
    this._updateStars();
  }

  _updateStars() {
    this.shadowRoot.querySelectorAll("#star-pick .star").forEach(s => {
      s.classList.toggle("on", parseInt(s.dataset.v) <= this._modalRating);
    });
  }

  _onSave() {
    const root = this.shadowRoot;
    const artist = root.querySelector("#f-artist").value.trim();
    const album = root.querySelector("#f-album").value.trim();

    if (!artist || !album) {
      const err = root.querySelector("#dialog-error");
      err.textContent = "Artist and Album are required.";
      err.style.display = "block";
      return;
    }

    const data = { artist, album };
    const r = this._modalRecord || {};
    if (r.record_id) data.record_id = r.record_id;

    const year = root.querySelector("#f-year").value;
    if (year) data.year = parseInt(year);

    const genreSelect = root.querySelector("#f-genre-select").value;
    const genreCustom = root.querySelector("#f-genre-custom").value.trim();
    const genre = genreSelect === "__custom__" ? genreCustom : genreSelect;
    if (genre) data.genre = genre;

    if (this._modalRating) data.rating = this._modalRating;

    const label = root.querySelector("#f-label").value.trim();
    if (label) data.label = label;

    const catalogNumber = root.querySelector("#f-catalog-number").value.trim();
    if (catalogNumber) data.catalog_number = catalogNumber;

    const discogsId = root.querySelector("#f-discogs-id").value.trim();
    if (discogsId) data.discogs_id = discogsId;

    const coverUrl = root.querySelector("#f-cover-url").value.trim();
    if (coverUrl) data.cover_url = coverUrl;

    const spotifyUri = root.querySelector("#f-spotify-uri").value.trim();
    if (spotifyUri) data.spotify_uri = spotifyUri;

    this._saveRecord(data);
  }

  _renderTable() {
    const root = this.shadowRoot;
    const tbody = root.querySelector("#tbody");
    const count = root.querySelector("#count");
    const records = this._sortedRecords();

    count.textContent = records.length + " record" + (records.length !== 1 ? "s" : "");

    root.querySelectorAll("#thead th[data-col]").forEach(th => {
      const isActive = th.dataset.col === this._sortCol;
      th.classList.toggle("active", isActive);
      th.querySelector(".arrow").textContent = isActive ? (this._sortDir === 1 ? " v" : " ^") : " -";
    });

    if (records.length === 0) {
      tbody.innerHTML = "<tr><td colspan=\"7\" class=\"empty\">No records found</td></tr>";
      return;
    }

    tbody.innerHTML = records.map(r =>
      "<tr>" +
      "<td class=\"cover-cell\">" + this._coverHTML(r.cover_url, 40) + "</td>" +
      "<td>" + this._esc(r.artist) + "</td>" +
      "<td>" + this._esc(r.album) + "</td>" +
      "<td>" + this._esc(r.year || "") + "</td>" +
      "<td>" + this._starsHTML(r.rating || 0) + "</td>" +
      "<td>" + this._esc(r.genre || "") + "</td>" +
      "<td class=\"actions\">" +
      (r.spotify_uri ? "<button class=\"icon-btn play-btn\" data-id=\"" + r.record_id + "\" data-action=\"play\" title=\"Play on Spotify\"><ha-icon icon=\"mdi:spotify\"></ha-icon></button>" : "") +
      "<button class=\"icon-btn\" data-id=\"" + r.record_id + "\" data-action=\"edit\" title=\"Edit\">" +
      "<ha-icon icon=\"mdi:pencil\"></ha-icon>" +
      "</button>" +
      "<button class=\"icon-btn\" data-id=\"" + r.record_id + "\" data-action=\"delete\" title=\"Delete\">" +
      "<ha-icon icon=\"mdi:delete\"></ha-icon>" +
      "</button>" +
      "</td>" +
      "</tr>"
    ).join("");

    tbody.querySelectorAll(".icon-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const rec = this._records.find(r => r.record_id === id);
        if (btn.dataset.action === "edit") {
          if (rec) this._openDialog(rec);
        } else if (btn.dataset.action === "play") {
          if (rec) this._openPlayPicker(rec);
        } else {
          this._openDeleteDialog(id);
        }
      });
    });
  }

  _updateSpotifyBtn() {
    const root = this.shadowRoot;
    const btn = root.querySelector("#spotify-search-btn");
    if (!btn) return;
    const artist = root.querySelector("#f-artist").value.trim();
    const album = root.querySelector("#f-album").value.trim();
    btn.disabled = !(artist && album);
  }

  _getMediaPlayers() {
    if (!this._hass) return [];
    return Object.entries(this._hass.states)
      .filter(([id]) => id.startsWith("media_player."))
      .map(([id, state]) => ({ entity_id: id, name: state.attributes.friendly_name || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _doSpotifySearch() {
    const root = this.shadowRoot;
    const artist = root.querySelector("#f-artist").value.trim();
    const album = root.querySelector("#f-album").value.trim();
    const query = [artist, album].filter(Boolean).join(" ");
    if (!query) {
      this._spotifyError = "Enter an artist and album first.";
      this._spotifyResults = [];
      this._renderSpotifyResults();
      return;
    }

    let entityId = (() => { try { return localStorage.getItem("vinyl_spotify_entity") || ""; } catch(_) { return ""; } })();
    if (!entityId) {
      const spotifyPlayers = this._getSpotifyPlayers();
      entityId = spotifyPlayers.length ? spotifyPlayers[0].entity_id : "";
    }
    if (!entityId) {
      this._spotifyError = "No Spotify media player found.";
      this._spotifyResults = [];
      this._spotifySearching = false;
      this._renderSpotifyResults();
      return;
    }

    this._spotifySearching = true;
    this._renderSpotifyResults();

    try {
      const result = await this._hass.callWS({
        type: "media_player/search_media",
        entity_id: entityId,
        search_query: query,
      });

      const items = result.result || result.children || [];
      const albums = items.filter(i => i.media_class === "album");
      this._spotifyResults = (albums.length ? albums : items).slice(0, 8);
      this._spotifyError = items.length === 0
        ? "No results. Check the media player selected is your Spotify player."
        : null;
    } catch (err) {
      this._spotifyResults = [];
      this._spotifyError = err.message || "Search failed.";
    }

    this._spotifySearching = false;
    this._renderSpotifyResults();
  }

  _renderSpotifyResults() {
    const container = this.shadowRoot.querySelector("#spotify-results");
    if (!container) return;

    if (this._spotifySearching) {
      container.innerHTML =
        "<div style=\"display:flex;align-items:center;gap:8px;padding:12px;color:var(--secondary-text-color);font-size:13px;\">" +
        "<div class=\"spinner\" style=\"width:16px;height:16px;border-width:2px;\"></div>Searching Spotify...</div>";
      container.style.display = "block";
      return;
    }

    if (!this._spotifyResults.length) {
      if (this._spotifyError) {
        container.innerHTML = "<div style=\"padding:12px;font-size:13px;color:var(--secondary-text-color);\">" + this._esc(this._spotifyError) + "</div>";
        container.style.display = "block";
      } else {
        container.style.display = "none";
      }
      return;
    }

    container.innerHTML = this._spotifyResults.map((r, i) =>
      "<div class=\"spotify-result\" data-index=\"" + i + "\">" +
      "<div style=\"flex-shrink:0;\">" + (r.thumbnail
        ? "<img src=\"" + this._esc(r.thumbnail) + "\" width=\"48\" height=\"48\" style=\"border-radius:4px;object-fit:cover;display:block;\"/>"
        : "<ha-icon icon=\"mdi:music\" style=\"width:48px;height:48px;color:var(--secondary-text-color);\"></ha-icon>") + "</div>" +
      "<div class=\"spotify-info\">" +
      "<div class=\"spotify-title\">" + this._esc(r.title || "") + "</div>" +
      "<div class=\"spotify-meta\">" + this._esc(r.media_content_id || "") + "</div>" +
      "</div></div>"
    ).join("");
    container.style.display = "block";

    container.querySelectorAll(".spotify-result").forEach(el => {
      el.addEventListener("click", () => this._applySpotifyResult(this._spotifyResults[parseInt(el.dataset.index)]));
    });
  }

  _applySpotifyResult(result) {
    const root = this.shadowRoot;
    const uri = result.media_content_id || "";
    root.querySelector("#f-spotify-uri").value = uri;
    this._spotifyResults = [];
    this._spotifyError = null;
    this._renderSpotifyResults();
    this._showSpotifyLinked(root);
    this._updateSpotifyBtn();
  }

  _showSpotifyLinked(root) {
    const saved = root || this.shadowRoot;
    const el = saved.querySelector("#spotify-saved");
    if (el) {
      el.innerHTML = "<ha-icon icon=\"mdi:spotify\" style=\"color:#1DB954;flex-shrink:0;\"></ha-icon>" +
        "<span>This record has been linked to Spotify. Playback enabled.</span>";
      el.style.display = "flex";
    }
  }

  _openPlayPicker(record) {
    this._playPickerRecord = record;
    const list = this.shadowRoot.querySelector("#entity-list");
    const players = this._getMediaPlayers();
    const lastUsed = (() => { try { return localStorage.getItem("vinyl_spotify_entity") || ""; } catch(_) { return ""; } })();

    if (!players.length) {
      list.innerHTML = "<div style=\"padding:12px;color:var(--secondary-text-color);font-size:13px;\">No media player entities found.</div>";
    } else {
      list.innerHTML = players.map(p =>
        "<div class=\"entity-item" + (p.entity_id === lastUsed ? " last-used" : "") + "\" data-entity=\"" + this._esc(p.entity_id) + "\">" +
        "<ha-icon icon=\"mdi:speaker\" style=\"width:20px;height:20px;flex-shrink:0;\"></ha-icon>" +
        this._esc(p.name) + "</div>"
      ).join("");
      list.querySelectorAll(".entity-item").forEach(el => {
        el.addEventListener("click", () => {
          this._playRecord(el.dataset.entity, this._playPickerRecord);
          this._closePlayPicker();
        });
      });
    }
    this.shadowRoot.querySelector("#play-picker-overlay").classList.add("open");
  }

  _closePlayPicker() {
    this.shadowRoot.querySelector("#play-picker-overlay").classList.remove("open");
    this._playPickerRecord = null;
  }

  _playRecord(entityId, record) {
    try { localStorage.setItem("vinyl_spotify_entity", entityId); } catch(_) {}
    const uri = record.spotify_uri || "";
    const contentType = uri.startsWith("spotify:album:") || uri.startsWith("library://album/") ? "album"
      : uri.startsWith("spotify:track:") || uri.startsWith("library://track/") ? "track"
      : uri.startsWith("spotify:playlist:") || uri.startsWith("library://playlist/") ? "playlist"
      : uri.startsWith("spotify:artist:") || uri.startsWith("library://artist/") ? "artist"
      : "music";
    this._hass.callService("media_player", "play_media", {
      entity_id: entityId,
      media_content_id: uri,
      media_content_type: contentType,
    });
  }

  _esc(str) {
    const d = document.createElement("div");
    d.textContent = String(str != null ? str : "");
    return d.innerHTML;
  }
}

customElements.define("vinyl-collection-card", VinylCollectionCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "vinyl-collection-card",
  name: "Vinyl Collection",
  description: "Search and manage your vinyl record collection.",
});