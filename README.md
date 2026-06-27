# ha-vinyl-collection

A Home Assistant custom integration for tracking your vinyl record collection
locally — add records manually or via Discogs lookup, search your collection
instantly while browsing a record shop, and play albums directly through
Spotify from your dashboard.

## Features

- **Local-only storage** — uses Home Assistant's built-in `Store`, no external database
- **Instant search** across artist, album, label, genre, and catalog number
- **Discogs integration** — search Discogs to auto-fill artist, album, year, label, catalog number, and cover art when adding a record
- **Spotify integration** — link records to Spotify and play them on any Music Assistant speaker with a single tap
- **Custom Lovelace card** — automatically registered on install, no manual resource setup needed
- **Sensor** showing total record count
- **Services** for use in automations and scripts: `add_record`, `remove_record`, `update_record`, `search`

## Installation

### Via HACS (recommended)

1. HACS → Integrations → ⋮ → Custom repositories
2. Add `https://github.com/snowmonkeylab/ha-vinyl-collection`, category: Integration
3. Install "Vinyl Collection", restart Home Assistant
4. Settings → Devices & Services → Add Integration → "Vinyl Collection"
5. Add a card to your dashboard:

   ```yaml
   type: custom:vinyl-collection-card
   ```

The Lovelace card is registered automatically — no manual resource setup required.

### Manual

Copy `custom_components/vinyl_collection` into your `config/custom_components/`
directory, restart Home Assistant, then add the integration via the UI.

## Configuration

During setup and via **Settings → Devices & Services → Vinyl Collection → Configure**:

| Option | Description |
| --- | --- |
| **Discogs API Token** | Optional. Generate a free personal token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers). Required when Discogs is enabled. |
| **Enable Discogs integration** | Allow the card to search Discogs for records and fetch cover art. |
| **Enable Spotify integration** | Allow the card to search Spotify and link records. Requires the [Home Assistant Spotify integration](https://www.home-assistant.io/integrations/spotify/). For speaker playback, [Music Assistant](https://music-assistant.io) must also be installed. |

## Using the Card

### Adding a record

1. Click **+ Add Record**
2. Optionally search Discogs to auto-fill fields — select a result to populate artist, album, year, label, catalog number, and cover art
3. Fill in or adjust artist, album, year, genre, and rating
4. If Spotify is enabled, click **Search Spotify** to link the record — this enables the play button in the table
5. Click **Add to Collection**

### Playing a record

Records linked to Spotify show a green Spotify icon in the table. Tap it to choose which Music Assistant speaker to play on. [Music Assistant](https://music-assistant.io) must be installed for speaker playback.

### Searching your collection

Use the search bar to filter across artist, album, label, genre, and catalog number in real time.

## Services

| Service | Description |
| --- | --- |
| `vinyl_collection.add_record` | Add a record (`artist`, `album` required) |
| `vinyl_collection.remove_record` | Remove a record by `record_id` |
| `vinyl_collection.update_record` | Update fields on an existing record |
| `vinyl_collection.search` | Search the collection; returns `results`, `count`, `exact_match` |
| `vinyl_collection.lookup_discogs` | Search Discogs for a release; returns metadata and cover art |
| `vinyl_collection.get_config` | Returns integration config state |

All services support response data, making them usable from scripts and automations.
