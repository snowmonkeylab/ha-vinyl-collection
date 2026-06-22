/**
 * Vinyl Collection Card
 *
 * A custom Lovelace card for searching your vinyl collection
 * (e.g. while browsing in a record shop, to avoid duplicate buys)
 * and adding new records.
 *
 * Install: copy to /config/www/vinyl-collection-card.js
 * Then add as a resource:
 *   url: /local/vinyl-collection-card.js
 *   type: module
 */

class VinylCollectionCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._searchTimeout = null;
    this._results = [];
    this._exactMatch = null;
    this._mode = "search"; // "search" | "add"
  }

  setConfig(config) {
    this._config = config || {};
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._render();
      this._rendered = true;
    }
  }

  getCardSize() {
    return 6;
  }

  async _callService(service, data) {
    return this._hass.callService("vinyl_collection", service, data, undefined, true, true);
  }

  async _doSearch(query) {
    if (!this._hass) return;
    try {
      const response = await this._callService("search", { query });
      this._results = response.response.results || [];
      this._exactMatch = response.response.exact_match || null;
    } catch (err) {
      console.error("Vinyl Collection search failed", err);
      this._results = [];
      this._exactMatch = null;
    }
    this._renderResults();
  }

  _onSearchInput(value) {
    clearTimeout(this._searchTimeout);
    this._searchTimeout = setTimeout(() => this._doSearch(value), 250);
  }

  async _onAddRecord(formData) {
    const statusEl = this.shadowRoot.getElementById("add-status");
    try {
      await this._callService("add_record", formData);
      statusEl.textContent = "Added to collection.";
      statusEl.className = "status success";
      this.shadowRoot.getElementById("add-form").reset();
    } catch (err) {
      statusEl.textContent = "Failed to add record: " + err.message;
      statusEl.className = "status error";
    }
  }

  async _onRemoveRecord(recordId) {
    await this._callService("remove_record", { record_id: recordId });
    const query = this.shadowRoot.getElementById("search-input").value;
    this._doSearch(query);
  }

  _switchMode(mode) {
    this._mode = mode;
    this._render();
  }

  _render() {
    const root = this.shadowRoot;
    root.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          padding: 16px;
        }
        .tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
          border-bottom: 1px solid var(--divider-color, #444);
        }
        .tab {
          padding: 8px 16px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          color: var(--secondary-text-color);
          font-weight: 500;
        }
        .tab.active {
          color: var(--primary-color);
          border-bottom-color: var(--primary-color);
        }
        input, select, textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 8px;
          margin-bottom: 8px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #555);
          background: var(--card-background-color, #1c1c1c);
          color: var(--primary-text-color, #fff);
          font-size: 14px;
        }
        label {
          font-size: 12px;
          color: var(--secondary-text-color);
          display: block;
          margin-bottom: 2px;
        }
        .search-input {
          font-size: 18px;
          padding: 12px;
        }
        .exact-match {
          background: var(--error-color, #db4437);
          color: white;
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 12px;
          font-weight: 600;
        }
        .result-count {
          color: var(--secondary-text-color);
          font-size: 13px;
          margin-bottom: 8px;
        }
        .record {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid var(--divider-color, #333);
        }
        .record-info .title {
          font-weight: 600;
        }
        .record-info .meta {
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .remove-btn {
          background: none;
          border: none;
          color: var(--error-color, #db4437);
          cursor: pointer;
          font-size: 13px;
        }
        button.submit-btn {
          background: var(--primary-color);
          color: white;
          border: none;
          padding: 10px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          width: 100%;
        }
        .status {
          margin-top: 8px;
          font-size: 13px;
        }
        .status.success { color: var(--success-color, #43a047); }
        .status.error { color: var(--error-color, #db4437); }
        .row {
          display: flex;
          gap: 8px;
        }
        .row > * { flex: 1; }
      </style>
      <ha-card>
        <div class="tabs">
          <div class="tab ${this._mode === "search" ? "active" : ""}" id="tab-search">Search</div>
          <div class="tab ${this._mode === "add" ? "active" : ""}" id="tab-add">Add Record</div>
        </div>
        <div id="content"></div>
      </ha-card>
    `;

    root.getElementById("tab-search").addEventListener("click", () => this._switchMode("search"));
    root.getElementById("tab-add").addEventListener("click", () => this._switchMode("add"));

    if (this._mode === "search") {
      this._renderSearchMode();
    } else {
      this._renderAddMode();
    }
  }

  _renderSearchMode() {
    const content = this.shadowRoot.getElementById("content");
    content.innerHTML = `
      <input
        type="text"
        id="search-input"
        class="search-input"
        placeholder="Search artist, album, label, genre..."
        autocomplete="off"
      />
      <div id="results"></div>
    `;
    const input = this.shadowRoot.getElementById("search-input");
    input.addEventListener("input", (e) => this._onSearchInput(e.target.value));
    // Show full collection on open
    this._doSearch("");
  }

  _renderResults() {
    const resultsEl = this.shadowRoot.getElementById("results");
    if (!resultsEl) return;

    let html = "";

    if (this._exactMatch) {
      html += `<div class="exact-match">⚠️ You already own this: ${this._escape(
        this._exactMatch.artist
      )} - ${this._escape(this._exactMatch.album)}</div>`;
    }

    html += `<div class="result-count">${this._results.length} record(s)</div>`;

    if (this._results.length === 0) {
      html += `<div style="color: var(--secondary-text-color); padding: 16px 0;">No matches. You probably don't own this one.</div>`;
    } else {
      for (const r of this._results) {
        html += `
          <div class="record">
            <div class="record-info">
              <div class="title">${this._escape(r.artist)} - ${this._escape(r.album)}</div>
              <div class="meta">${this._escape(r.year || "")} ${this._escape(
          r.format || ""
        )} ${r.condition ? "· " + this._escape(r.condition) : ""}</div>
            </div>
            <button class="remove-btn" data-id="${r.record_id}">Remove</button>
          </div>
        `;
      }
    }

    resultsEl.innerHTML = html;
    resultsEl.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (confirm("Remove this record from your collection?")) {
          this._onRemoveRecord(e.target.dataset.id);
        }
      });
    });
  }

  _renderAddMode() {
    const content = this.shadowRoot.getElementById("content");
    content.innerHTML = `
      <form id="add-form">
        <label>Artist *</label>
        <input type="text" name="artist" required />
        <label>Album *</label>
        <input type="text" name="album" required />
        <div class="row">
          <div>
            <label>Year</label>
            <input type="number" name="year" min="1900" max="2100" />
          </div>
          <div>
            <label>Format</label>
            <select name="format">
              <option value="LP">LP</option>
              <option value="12&quot;">12"</option>
              <option value="10&quot;">10"</option>
              <option value="7&quot;">7"</option>
              <option value="Box Set">Box Set</option>
              <option value="Picture Disc">Picture Disc</option>
            </select>
          </div>
        </div>
        <label>Condition</label>
        <select name="condition">
          <option value="Mint (M)">Mint (M)</option>
          <option value="Near Mint (NM)">Near Mint (NM)</option>
          <option value="Very Good Plus (VG+)" selected>Very Good Plus (VG+)</option>
          <option value="Very Good (VG)">Very Good (VG)</option>
          <option value="Good (G)">Good (G)</option>
          <option value="Fair">Fair</option>
        </select>
        <label>Genre</label>
        <input type="text" name="genre" />
        <label>Label</label>
        <input type="text" name="label" />
        <label>Catalog Number</label>
        <input type="text" name="catalog_number" />
        <label>Notes</label>
        <textarea name="notes" rows="2"></textarea>
        <button type="submit" class="submit-btn">Add to Collection</button>
        <div id="add-status" class="status"></div>
      </form>
    `;

    const form = this.shadowRoot.getElementById("add-form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = {};
      for (const [key, value] of fd.entries()) {
        if (value === "") continue;
        data[key] = key === "year" ? parseInt(value, 10) : value;
      }
      this._onAddRecord(data);
    });
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
  }
}

customElements.define("vinyl-collection-card", VinylCollectionCard);

// Register with the card picker
window.customCards = window.customCards || [];
window.customCards.push({
  type: "vinyl-collection-card",
  name: "Vinyl Collection Card",
  description: "Search and manage your vinyl record collection.",
});
