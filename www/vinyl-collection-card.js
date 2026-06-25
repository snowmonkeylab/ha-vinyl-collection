/**
 * Vinyl Collection Card
 */

const FORMATS = ["LP", "12\"", "10\"", "7\"", "Box Set", "Picture Disc"];
const CONDITIONS = [
  "Mint (M)", "Near Mint (NM)", "Very Good Plus (VG+)",
  "Very Good (VG)", "Good (G)", "Fair", "Poor"
];
const GENRES = [
  "Blues", "Classical", "Country", "Electronic", "Folk",
  "Hip-Hop", "Jazz", "Metal", "Pop", "Punk",
  "Reggae", "Rock", "Soul", "World"
];

class VinylCollectionCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._records = [];
    this._searchTimeout = null;
    this._modalRecord = null;
    this._modalRating = 0;
    this._sortCol = "artist";
    this._sortDir = 1;
    this._deleteId = null;
    this._loading = false;
    this._saving = false;
  }

  setConfig(config) { this._config = config || {}; }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._render();
      this._rendered = true;
      this._search("");
    }
  }

  getCardSize() { return 8; }

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
    if (btn) {
      btn.disabled = on;
      btn.style.opacity = on ? "0.6" : "1";
    }
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
    this._renderDialog();
    this.shadowRoot.querySelector("#dialog-overlay").classList.add("open");
  }

  _closeDialog() {
    this.shadowRoot.querySelector("#dialog-overlay").classList.remove("open");
    this.shadowRoot.querySelector("#artist-suggestions").style.display = "none";
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

  _formatOptions() {
    return FORMATS.map(f => "<option value=\"" + f + "\">" + f + "</option>").join("");
  }

  _conditionOptions() {
    return CONDITIONS.map(c => "<option value=\"" + c + "\">" + c + "</option>").join("");
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
      ".add-btn:hover { opacity: 0.9; }" +
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
      "td { padding: 8px; vertical-align: middle; }" +
      "td.actions { white-space: nowrap; text-align: right; }" +
      ".icon-btn { background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px; opacity: 0.7; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; }" +
      ".icon-btn:hover { opacity: 1; background: var(--secondary-background-color); }" +
      ".icon-btn.edit { color: var(--primary-color); }" +
      ".icon-btn.del { color: var(--error-color, #db4437); }" +
      ".stars { font-size: 14px; letter-spacing: 1px; color: var(--disabled-text-color, #ccc); }" +
      ".stars .star.on { color: #f4a820; }" +
      ".empty { text-align: center; padding: 32px; color: var(--secondary-text-color); font-size: 13px; }" +
      "@keyframes spin { to { transform: rotate(360deg); } }" +
      ".spinner { width: 24px; height: 24px; border: 3px solid var(--divider-color, #ccc); border-top-color: var(--primary-color); border-radius: 50%; animation: spin 0.7s linear infinite; }" +
      ".spinner-wrap { display: none; position: absolute; inset: 0; align-items: center; justify-content: center; background: var(--card-background-color, rgba(255,255,255,0.7)); z-index: 2; min-height: 60px; }" +
      ".spinner-inline { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; display: none; margin-left: 8px; vertical-align: middle; }" +
      ".overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9999; align-items: center; justify-content: center; }" +
      ".overlay.open { display: flex; }" +
      ".dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 12px; width: 90%; max-width: 460px; max-height: 90vh; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }" +
      ".dialog h3 { font-size: 18px; font-weight: 500; }" +
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
      "<th data-col=\"artist\">Artist<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"album\">Album<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"year\">Year<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"format\">Format<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"condition\">Condition<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"rating\">Rating<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"genre\">Genre<span class=\"arrow\">-</span></th>" +
      "<th data-col=\"notes\">Notes<span class=\"arrow\">-</span></th>" +
      "<th></th>" +
      "</tr></thead>" +
      "<tbody id=\"tbody\"></tbody>" +
      "</table>" +
      "</div>" +
      "</ha-card>" +
      "<div class=\"overlay\" id=\"dialog-overlay\">" +
      "<div class=\"dialog\">" +
      "<h3 id=\"dialog-title\">Add Record</h3>" +
      "<div><label>Artist *</label>" +
      "<div class=\"artist-wrap\">" +
      "<input type=\"text\" id=\"f-artist\" autocomplete=\"off\"/>" +
      "<div class=\"suggestions\" id=\"artist-suggestions\"></div>" +
      "</div></div>" +
      "<div><label>Album *</label><input type=\"text\" id=\"f-album\" autocomplete=\"off\"/></div>" +
      "<div class=\"row2\">" +
      "<div><label>Year</label><input type=\"number\" id=\"f-year\" min=\"1900\" max=\"2100\"/></div>" +
      "<div><label>Format</label><select id=\"f-format\"><option value=\"\">--</option>" + this._formatOptions() + "</select></div>" +
      "</div>" +
      "<div><label>Condition</label><select id=\"f-condition\"><option value=\"\">--</option>" + this._conditionOptions() + "</select></div>" +
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
      "<div><label>Notes</label><textarea id=\"f-notes\"></textarea></div>" +
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
    });
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

    root.querySelector("#f-artist").value = r.artist || "";
    root.querySelector("#f-album").value = r.album || "";
    root.querySelector("#f-year").value = r.year || "";
    root.querySelector("#f-notes").value = r.notes || "";
    root.querySelector("#f-format").value = r.format || "";
    root.querySelector("#f-condition").value = r.condition || "";

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

    const fmt = root.querySelector("#f-format").value;
    if (fmt) data.format = fmt;

    const cond = root.querySelector("#f-condition").value;
    if (cond) data.condition = cond;

    const genreSelect = root.querySelector("#f-genre-select").value;
    const genreCustom = root.querySelector("#f-genre-custom").value.trim();
    const genre = genreSelect === "__custom__" ? genreCustom : genreSelect;
    if (genre) data.genre = genre;

    if (this._modalRating) data.rating = this._modalRating;

    const notes = root.querySelector("#f-notes").value.trim();
    if (notes) data.notes = notes;

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
      tbody.innerHTML = "<tr><td colspan=\"9\" class=\"empty\">No records found</td></tr>";
      return;
    }

    tbody.innerHTML = records.map(r =>
      "<tr>" +
      "<td>" + this._esc(r.artist) + "</td>" +
      "<td>" + this._esc(r.album) + "</td>" +
      "<td>" + this._esc(r.year || "") + "</td>" +
      "<td>" + this._esc(r.format || "") + "</td>" +
      "<td>" + this._esc(r.condition || "") + "</td>" +
      "<td>" + this._starsHTML(r.rating || 0) + "</td>" +
      "<td>" + this._esc(r.genre || "") + "</td>" +
      "<td>" + this._esc(r.notes || "") + "</td>" +
      "<td class=\"actions\">" +
      "<button class=\"icon-btn edit\" data-id=\"" + r.record_id + "\" data-action=\"edit\" title=\"Edit\">" +
      "<ha-icon icon=\"mdi:pencil\"></ha-icon>" +
      "</button>" +
      "<button class=\"icon-btn del\" data-id=\"" + r.record_id + "\" data-action=\"delete\" title=\"Delete\">" +
      "<ha-icon icon=\"mdi:delete\"></ha-icon>" +
      "</button>" +
      "</td>" +
      "</tr>"
    ).join("");

    tbody.querySelectorAll(".icon-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (btn.dataset.action === "edit") {
          const rec = this._records.find(r => r.record_id === id);
          if (rec) this._openDialog(rec);
        } else {
          this._openDeleteDialog(id);
        }
      });
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