# ha-vinyl-collection

A Home Assistant custom integration for tracking your vinyl record collection
locally — add records manually, search them instantly (e.g. while browsing in
a record shop, to avoid buying duplicates), and manage everything from a
custom Lovelace card.

No cloud account, no API key required for v1. Discogs lookup is planned for v2.

## Features

- Local-only storage (Home Assistant's built-in `Store`, no external DB)
- Manual record entry: artist, album, year, format, condition, genre, label,
  catalog number, notes
- Instant search across artist/album/label/genre/catalog number
- "You already own this" warning for exact artist+album matches
- A sensor showing total record count, with a breakdown by format
- A custom Lovelace card for search-as-you-type and adding records on the go
- Services usable from automations/scripts: `add_record`, `remove_record`,
  `update_record`, `search`

## Installation

### Via HACS (custom repository)

1. HACS → Integrations → ⋮ → Custom repositories
2. Add `https://github.com/snowmonkeylab/ha-vinyl-collection`, category: Integration
3. Install "Vinyl Collection", restart Home Assistant
4. Settings → Devices & Services → Add Integration → "Vinyl Collection"

### Manual

Copy `custom_components/vinyl_collection` into your `config/custom_components/`
directory, restart Home Assistant, then add the integration via the UI.

## Lovelace Card Setup

1. Copy `www/vinyl-collection-card.js` to `config/www/vinyl-collection-card.js`
   (HACS does this for you automatically if installed via HACS)
2. Settings → Dashboards → Resources → Add Resource:
   - URL: `/local/vinyl-collection-card.js`
   - Type: JavaScript Module
3. Add a card to your dashboard:
   ```yaml
   type: custom:vinyl-collection-card
   ```

## Services

| Service | Description |
|---|---|
| `vinyl_collection.add_record` | Add a record (artist, album required) |
| `vinyl_collection.remove_record` | Remove a record by `record_id` |
| `vinyl_collection.update_record` | Update fields on an existing record |
| `vinyl_collection.search` | Search the collection; returns `results`, `count`, `exact_match` |

All services support response data — useful for calling from scripts/automations,
not just the Lovelace card.

## Roadmap

- v2: Discogs API integration for barcode/search-based record lookup,
  auto-filling artist/album/year/cover art when adding a record
