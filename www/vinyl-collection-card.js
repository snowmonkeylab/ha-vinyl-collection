/**
 * Vinyl Collection Card
 * Uses native Home Assistant web components for consistent UI
 */

const FORMATS = ["LP", '12"', '10"', '7"', "Box Set", "Picture Disc"];
const CONDITIONS = [
  "Mint (M)", "Near Mint (NM)", "Very Good Plus (VG+)",
  "Very Good (VG)", "Good (G)", "Fair", "Poor"
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
    try {
      const r = await this._call("search", { query });
      this._records = r.response.results || [];
    } catch (e) {
      this._records = [];
    }
    this._renderTable();
  }

  _onSearchInput(v) {
    clearTimeout(this._searchTimeout);
    this._searchTimeout = setTimeout(() => this._search(v), 220);
  }

  async _saveRecord(data) {
    try {
      if (data.record_id) {
        await this._call("update_record", data);
      } else {
        await this._call("add_record", data);
      }
      this._closeDialog();
      const q = this.shadowRoot.querySelector("#search-input").value;
      this._search(q);
    } catch (e) {
      const el = this.shadowRoot.querySelector("#modal-error");
      if (el) { el.textContent = "Save failed: " + e.message; el.style.display = "block"; }
    }
  }

  async _deleteRecord(id) {
    if (!confirm("Remove this record from your collection?")) return;
    await this._call("remove_record", { record_id: id });
    const q = this.shadowRoot.querySelector("#search-input").value;
    this._search(q);
  }

  _openDialog(record) {
    this._modalRecord = record || {};
    this._modalRating = record ? (record.rating || 0) : 0;
    this._renderDialogContent();
    const dialog = this.shadowRoot.querySelector("ha-dialog");
    dialog.open = true;
  }

  _closeDialog() {
    const dialog = this.shadowRoot.querySelector("ha-dialog");
    dialog.open = false;
  }

  _setSort(col) {
    if (this._sortCol === col) { this._sortDir *= -1; }
    else { this._sortCol = col; this._sortDir = 1; }
    this._renderTable();
  }

  _sortedRecords() {
    const col = this._sortCol;
    return [...this._records].sort((a, b) => {
      let av = a[col] ?? "", bv = b[col] ?? "";
      if (typeof av === "number" || typeof bv === "number") {
        av = Number(av) || 0; bv = Number(bv) || 0;
      } else {
        av = String(av).toLowerCase(); bv = String(bv).toLowerCase();
      }
      return av < bv ? -this._sortDir : av > bv ? this._sortDir : 0;
    });
  }

  _starsHTML(n) {
    let html = '<span class="stars">';
    for (let i = 1; i <= 5; i++) {
      html += `<span class="star${i <= n ? " on" : ""}">★</span>`;
    }
    return html + "</span>";
  }

  _render() {
    const root = this.shadowRoot;
    root.innerHTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :host { display: block; font-family: inherit; }

  ha-card { padding: 16px 20px; }

  .toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 16px;
  }

  .search-wrap {
    flex: 1;
  }

  .search-wrap ha-textfield {
    width: 100%;
  }

  .count {
    font-size: 12px;
    color: var(--secondary-text-color);
    margin-bottom: 8px;
  }

  .table-wrap { overflow-x: auto; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  thead th {
    text-align: left;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--secondary-text-color);
    border-bottom: 1px solid var(--divider-color);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }

  thead th:hover { color: var(--primary-text-color); }
  thead th .arrow { margin-left: 3px; opacity: 0.4; font-size: 10px; }
  thead th.active .arrow { opacity: 1; }

  tbody tr { border-bottom: 1px solid var(--divider-color); }
  tbody tr:hover { background: var(--secondary-background-color); }

  td {
    padding: 8px;
    vertical-align: middle;
  }

  td.actions {
    white-space: nowrap;
    text-align: right;
    padding-right: 4px;
  }

  .stars { color: var(--disabled-text-color); font-size: 14px; letter-spacing: 1px; }
  .stars .star.on { color: #f4a820; }

  .empty {
    text-align: center;
    padding: 32px;
    color: var(--secondary-text-color);
    font-size: 13px;
  }

  ha-dialog {
    --mdc-dialog-min-width: 360px;
    --mdc-dialog-max-width: 480px;
  }

  .dialog-title {
    font-size: 18px;
    font-weight: 500;
    padding: 20px 24px 0;
  }

  .dialog-body {
    padding: 8px 24px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .dialog-body ha-textfield,
  .dialog-body ha-select,
  .dialog-body ha-textarea {
    width: 100%;
  }

  .row2 { display: flex; gap: 12px; }
  .row2 > * { flex: 1; }

  .field-label {
    font-size: 12px;
    color: var(--secondary-text-color);
    margin-bottom: 4px;
  }

  .star-pick {
    display: flex;
    gap: 6px;
    padding: 4px 0;
  }

  .star-pick .star {
    font-size: 28px;
    cursor: pointer;
    color: var(--disabled-text-color);
    line-height: 1;
    transition: color 0.1s;
  }

  .star-pick .star.on { color: #f4a820; }
  .star-pick .star:hover { color: #f4a820; opacity: 0.7; }

  .dialog-error {
    display: none;
    font-size: 13px;
    color: var(--error-color);
    padding: 0 0 4px;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 16px 16px;
  }
</style>

<ha-card>
  <div class="toolbar">
    <div class="search-wrap">
      <ha-textfield
        id="search-input"
        placeholder="Search artist, album, genre…"
        icon="mdi:magnify"
        autocomplete="off"
      ></ha-textfield>
    </div>
    <mwc-button raised id="add-btn" label="Add Record" icon="mdi:plus"></mwc-button>
  </div>

  <div class="count" id="count"></div>

  <div class="table-wrap">
    <table>
      <thead id="thead">
        <tr>
          <th data-col="artist">Artist<span class="arrow">↕</span></th>
          <th data-col="album">Album<span class="arrow">↕</span></th>
          <th data-col="year">Year<span class="arrow">↕</span></th>
          <th data-col="format">Format<span class="arrow">↕</span></th>
          <th data-col="condition">Condition<span class="arrow">↕</span></th>
          <th data-col="rating">Rating<span class="arrow">↕</span></th>
          <th data-col="genre">Genre<span class="arrow">↕</span></th>
          <th data-col="notes">Notes<span class="arrow">↕</span></th>
          <th></th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
</ha-card>

<ha-dialog id="record-dialog" flexContent>
  <div class="dialog-title" id="dialog-title">Add Record</div>
  <div class="dialog-body" id="dialog-body">
    <ha-textfield id="f-artist" label="Artist *" autocomplete="off"></ha-textfield>
    <ha-textfield id="f-album" label="Album *" autocomplete="off"></ha-textfield>

    <div class="row2">
      <ha-textfield id="f-year" label="Year" type="number" min="1900" max="2100"></ha-textfield>
      <ha-select id="f-format" label="Format" naturalMenuWidth>
        <ha-list-item value="">—</ha-list-item>
        ${FORMATS.map(f => `<ha-list-item value="${f}">${f}</ha-list-item>`).join("")}
      </ha-select>
    </div>

    <ha-select id="f-condition" label="Condition" naturalMenuWidth>
      <ha-list-item value="">—</ha-list-item>
      ${CONDITIONS.map(c => `<ha-list-item value="${c}">${c}</ha-list-item>`).join("")}
    </ha-select>

    <ha-textfield id="f-genre" label="Genre" autocomplete="off"></ha-textfield>

    <div>
      <div class="field-label">Rating</div>
      <div class="star-pick" id="star-pick">
        ${[1,2,3,4,5].map(i => `<span class="star" data-v="${i}">★</span>`).join("")}
      </div>
    </div>

    <ha-textarea id="f-notes" label="Notes" autocomplete="off"></ha-textarea>

    <div class="dialog-error" id="dialog-error"></div>
  </div>

  <div class="dialog-actions">
    <mwc-button id="dialog-cancel" label="Cancel" dialogAction="close"></mwc-button>
    <mwc-button id="dialog-save" label="Save" raised></mwc-button>
  </div>
</ha-dialog>
`;

    root.querySelector("#search-input").addEventListener("input", e => this._onSearchInput(e.target.value));
    root.querySelector("#add-btn").addEventListener("click", () => this._openDialog(null));
    root.querySelector("#thead").querySelectorAll("th[data-col]").forEach(th => {
      th.addEventListener("click", () => this._setSort(th.dataset.col));
    });
    root.querySelectorAll("#star-pick .star").forEach(s => {
      s.addEventListener("click", () => this._onStarClick(parseInt(s.dataset.v)));
    });
    root.querySelector("#dialog-save").addEventListener("click", () => this._onSave());
    root.querySelector("#dialog-cancel").addEventListener("click", () => this._closeDialog());
  }

  _onStarClick(v) {
    this._modalRating = this._modalRating === v ? 0 : v;
    this._updateStars();
  }

  _updateStars() {
    this.shadowRoot.querySelectorAll("#star-pick .star").forEach(s => {
      s.classList.toggle("on", parseInt(s.dataset.v) <= this._modalRating);
    });
  }

  _renderDialogContent() {
    const r = this._modalRecord || {};
    const isEdit = !!r.record_id;
    const root = this.shadowRoot;

    root.querySelector("#dialog-title").textContent = isEdit ? "Edit Record" : "Add Record";
    root.querySelector("#dialog-save").label = isEdit ? "Save Changes" : "Add to Collection";
    root.querySelector("#dialog-error").style.display = "none";

    root.querySelector("#f-artist").value = r.artist || "";
    root.querySelector("#f-album").value = r.album || "";
    root.querySelector("#f-year").value = r.year || "";
    root.querySelector("#f-genre").value = r.genre || "";
    root.querySelector("#f-notes").value = r.notes || "";

    setTimeout(() => {
      root.querySelector("#f-format").value = r.format || "";
      root.querySelector("#f-condition").value = r.condition || "";
    }, 50);

    this._updateStars();
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

    const genre = root.querySelector("#f-genre").value.trim();
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

    count.textContent = `${records.length} record${records.length !== 1 ? "s" : ""}`;

    root.querySelectorAll("#thead th[data-col]").forEach(th => {
      th.classList.toggle("active", th.dataset.col === this._sortCol);
      const arrow = th.querySelector(".arrow");
      arrow.textContent = th.dataset.col === this._sortCol
        ? (this._sortDir === 1 ? "↑" : "↓")
        : "↕";
    });

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">No records found</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => `
      <tr>
        <td>${this._esc(r.artist)}</td>
        <td>${this._esc(r.album)}</td>
        <td>${this._esc(r.year || "")}</td>
        <td>${this._esc(r.format || "")}</td>
        <td>${this._esc(r.condition || "")}</td>
        <td>${this._starsHTML(r.rating || 0)}</td>
        <td>${this._esc(r.genre || "")}</td>
        <td>${this._esc(r.notes || "")}</td>
        <td class="actions">
          <ha-icon-button data-id="${r.record_id}" data-action="edit" title="Edit">
            <ha-icon icon="mdi:pencil"></ha-icon>
          </ha-icon-button>
          <ha-icon-button data-id="${r.record_id}" data-action="delete" title="Delete">
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("ha-icon-button").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (btn.dataset.action === "edit") {
          const rec = this._records.find(r => r.record_id === id);
          if (rec) this._openDialog(rec);
        } else {
          this._deleteRecord(id);
        }
      });
    });
  }

  _esc(str) {
    const d = document.createElement("div");
    d.textContent = String(str ?? "");
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