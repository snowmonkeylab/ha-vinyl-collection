/**
 * Vinyl Collection Card
 * Single-view: search bar + add button + data table + edit/delete per row
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
    if (!this._rendered) { this._render(); this._rendered = true; this._search(""); }
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
      this._closeModal();
      const q = this.shadowRoot.getElementById("search-input").value;
      this._search(q);
    } catch (e) {
      const el = this.shadowRoot.getElementById("modal-error");
      if (el) { el.textContent = "Save failed: " + e.message; el.style.display = "block"; }
    }
  }

  async _deleteRecord(id) {
    if (!confirm("Remove this record from your collection?")) return;
    await this._call("remove_record", { record_id: id });
    const q = this.shadowRoot.getElementById("search-input").value;
    this._search(q);
  }

  _openModal(record) {
    this._modalRecord = record || {};
    this._modalRating = record ? (record.rating || 0) : 0;
    this._renderModal();
    this.shadowRoot.getElementById("modal-overlay").style.display = "flex";
  }

  _closeModal() {
    this.shadowRoot.getElementById("modal-overlay").style.display = "none";
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

  _stars(n, interactive) {
    let html = '<span class="stars"' + (interactive ? ' id="star-display"' : "") + ">";
    for (let i = 1; i <= 5; i++) {
      if (interactive) {
        html += `<span class="star${i <= n ? " on" : ""}" data-v="${i}">★</span>`;
      } else {
        html += `<span class="star${i <= n ? " on" : ""}" aria-hidden="true">★</span>`;
      }
    }
    return html + "</span>";
  }

  _render() {
    const root = this.shadowRoot;
    root.innerHTML = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
:host{display:block;font-family:inherit}
ha-card{padding:16px 20px}
.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:14px}
.toolbar input{flex:1;padding:8px 12px;border-radius:8px;border:0.5px solid var(--divider-color,#ccc);background:var(--card-background-color);color:var(--primary-text-color);font-size:14px}
.add-btn{display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:0.5px solid var(--primary-color);background:var(--primary-color);color:#fff;font-size:14px;cursor:pointer;white-space:nowrap}
.count{font-size:12px;color:var(--secondary-text-color);margin-bottom:8px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{text-align:left;padding:6px 8px;font-size:12px;color:var(--secondary-text-color);border-bottom:0.5px solid var(--divider-color,#ccc);cursor:pointer;user-select:none;white-space:nowrap}
thead th:hover{color:var(--primary-text-color)}
thead th .sort-arrow{margin-left:3px;opacity:0.4;font-size:10px}
thead th.active .sort-arrow{opacity:1}
tbody tr{border-bottom:0.5px solid var(--divider-color,#eee)}
tbody tr:hover{background:var(--secondary-background-color,rgba(0,0,0,0.04))}
td{padding:7px 8px;vertical-align:middle}
td.actions{white-space:nowrap;text-align:right}
.act-btn{background:none;border:none;cursor:pointer;padding:4px;border-radius:4px;font-size:16px;line-height:1;opacity:0.6}
.act-btn:hover{opacity:1}
.act-btn.edit{color:var(--primary-color)}
.act-btn.del{color:var(--error-color,#db4437)}
.stars{color:var(--secondary-text-color,#ccc);font-size:14px;letter-spacing:1px}
.stars .star.on{color:#f4a820}
.empty{text-align:center;padding:24px;color:var(--secondary-text-color);font-size:13px}
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center}
.modal{background:var(--card-background-color,#fff);border-radius:12px;padding:20px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;position:relative}
.modal h3{font-size:16px;font-weight:500;margin-bottom:16px}
.modal label{display:block;font-size:12px;color:var(--secondary-text-color);margin-bottom:3px;margin-top:10px}
.modal label:first-of-type{margin-top:0}
.modal input,.modal select,.modal textarea{width:100%;padding:7px 10px;border-radius:6px;border:0.5px solid var(--divider-color,#ccc);background:var(--card-background-color);color:var(--primary-text-color);font-size:14px}
.modal textarea{resize:vertical;min-height:60px}
.row2{display:flex;gap:10px}
.row2>*{flex:1}
.star-pick{display:flex;gap:4px;margin-top:4px}
.star-pick .star{font-size:24px;cursor:pointer;color:var(--secondary-text-color,#ccc);line-height:1}
.star-pick .star.on{color:#f4a820}
.modal-actions{display:flex;gap:8px;margin-top:16px}
.btn-save{flex:1;padding:9px;border-radius:8px;border:none;background:var(--primary-color);color:#fff;font-size:14px;cursor:pointer;font-weight:500}
.btn-cancel{padding:9px 16px;border-radius:8px;border:0.5px solid var(--divider-color,#ccc);background:none;color:var(--primary-text-color);font-size:14px;cursor:pointer}
.modal-error{display:none;margin-top:8px;font-size:13px;color:var(--error-color,#db4437)}
.close-x{position:absolute;top:14px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:var(--secondary-text-color);line-height:1}
</style>
<ha-card>
  <div class="toolbar">
    <input type="text" id="search-input" placeholder="Search artist, album, genre…" autocomplete="off"/>
    <button class="add-btn" id="add-btn">＋ Add record</button>
  </div>
  <div class="count" id="count"></div>
  <div class="table-wrap">
    <table>
      <thead id="thead">
        <tr>
          <th data-col="artist">Artist<span class="sort-arrow">↕</span></th>
          <th data-col="album">Album<span class="sort-arrow">↕</span></th>
          <th data-col="year">Year<span class="sort-arrow">↕</span></th>
          <th data-col="format">Format<span class="sort-arrow">↕</span></th>
          <th data-col="condition">Condition<span class="sort-arrow">↕</span></th>
          <th data-col="rating">Rating<span class="sort-arrow">↕</span></th>
          <th data-col="genre">Genre<span class="sort-arrow">↕</span></th>
          <th data-col="notes">Notes<span class="sort-arrow">↕</span></th>
          <th></th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
</ha-card>
<div class="overlay" id="modal-overlay">
  <div class="modal" id="modal-inner">
    <button class="close-x" id="modal-close">✕</button>
    <div id="modal-content"></div>
  </div>
</div>`;

    root.getElementById("search-input").addEventListener("input", e => this._onSearchInput(e.target.value));
    root.getElementById("add-btn").addEventListener("click", () => this._openModal(null));
    root.getElementById("modal-close").addEventListener("click", () => this._closeModal());
    root.getElementById("modal-overlay").addEventListener("click", e => {
      if (e.target === root.getElementById("modal-overlay")) this._closeModal();
    });

    root.getElementById("thead").querySelectorAll("th[data-col]").forEach(th => {
      th.addEventListener("click", () => this._setSort(th.dataset.col));
    });
  }

  _renderTable() {
    const tbody = this.shadowRoot.getElementById("tbody");
    const count = this.shadowRoot.getElementById("count");
    const thead = this.shadowRoot.getElementById("thead");
    const records = this._sortedRecords();

    count.textContent = `${records.length} record${records.length !== 1 ? "s" : ""}`;

    thead.querySelectorAll("th[data-col]").forEach(th => {
      th.classList.toggle("active", th.dataset.col === this._sortCol);
      const arrow = th.querySelector(".sort-arrow");
      if (th.dataset.col === this._sortCol) {
        arrow.textContent = this._sortDir === 1 ? "↑" : "↓";
      } else {
        arrow.textContent = "↕";
      }
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
  <td>${this._stars(r.rating || 0, false)}</td>
  <td>${this._esc(r.genre || "")}</td>
  <td>${this._esc(r.notes || "")}</td>
  <td class="actions">
    <button class="act-btn edit" data-id="${r.record_id}" title="Edit">✎</button>
    <button class="act-btn del" data-id="${r.record_id}" title="Delete">✕</button>
  </td>
</tr>`).join("");

    tbody.querySelectorAll(".act-btn.edit").forEach(btn => {
      btn.addEventListener("click", () => {
        const rec = this._records.find(r => r.record_id === btn.dataset.id);
        if (rec) this._openModal(rec);
      });
    });
    tbody.querySelectorAll(".act-btn.del").forEach(btn => {
      btn.addEventListener("click", () => this._deleteRecord(btn.dataset.id));
    });
  }

  _renderModal() {
    const r = this._modalRecord || {};
    const isEdit = !!r.record_id;
    const content = this.shadowRoot.getElementById("modal-content");
    const fmtOpts = FORMATS.map(f => `<option value="${f}"${r.format===f?" selected":""}>${f}</option>`).join("");
    const condOpts = CONDITIONS.map(c => `<option value="${c}"${r.condition===c?" selected":""}>${c}</option>`).join("");

    content.innerHTML = `
<h3>${isEdit ? "Edit record" : "Add record"}</h3>
<label>Artist *</label>
<input id="f-artist" type="text" value="${this._esc(r.artist||"")}" required/>
<label>Album *</label>
<input id="f-album" type="text" value="${this._esc(r.album||"")}"/>
<div class="row2">
  <div>
    <label>Year</label>
    <input id="f-year" type="number" min="1900" max="2100" value="${r.year||""}"/>
  </div>
  <div>
    <label>Format</label>
    <select id="f-format"><option value="">—</option>${fmtOpts}</select>
  </div>
</div>
<label>Condition</label>
<select id="f-condition"><option value="">—</option>${condOpts}</select>
<label>Genre</label>
<input id="f-genre" type="text" value="${this._esc(r.genre||"")}"/>
<label>Rating</label>
<div class="star-pick" id="star-pick">
  ${[1,2,3,4,5].map(i=>`<span class="star${i<=this._modalRating?" on":""}" data-v="${i}">★</span>`).join("")}
</div>
<label>Notes</label>
<textarea id="f-notes">${this._esc(r.notes||"")}</textarea>
<div class="modal-actions">
  <button class="btn-cancel" id="modal-cancel">Cancel</button>
  <button class="btn-save" id="modal-save">${isEdit ? "Save changes" : "Add to collection"}</button>
</div>
<div class="modal-error" id="modal-error"></div>`;

    content.querySelectorAll("#star-pick .star").forEach(s => {
      s.addEventListener("click", () => {
        const v = parseInt(s.dataset.v);
        this._modalRating = this._modalRating === v ? 0 : v;
        content.querySelectorAll("#star-pick .star").forEach(st => {
          st.classList.toggle("on", parseInt(st.dataset.v) <= this._modalRating);
        });
      });
    });

    content.getElementById("modal-cancel").addEventListener("click", () => this._closeModal());
    content.getElementById("modal-save").addEventListener("click", () => {
      const artist = content.getElementById("f-artist").value.trim();
      const album = content.getElementById("f-album").value.trim();
      if (!artist || !album) {
        const err = content.getElementById("modal-error");
        err.textContent = "Artist and Album are required.";
        err.style.display = "block";
        return;
      }
      const data = { artist, album };
      if (r.record_id) data.record_id = r.record_id;
      const year = content.getElementById("f-year").value;
      if (year) data.year = parseInt(year);
      const fmt = content.getElementById("f-format").value;
      if (fmt) data.format = fmt;
      const cond = content.getElementById("f-condition").value;
      if (cond) data.condition = cond;
      const genre = content.getElementById("f-genre").value.trim();
      if (genre) data.genre = genre;
      if (this._modalRating) data.rating = this._modalRating;
      const notes = content.getElementById("f-notes").value.trim();
      if (notes) data.notes = notes;
      this._saveRecord(data);
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