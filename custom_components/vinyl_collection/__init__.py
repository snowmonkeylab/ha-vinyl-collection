"""The Vinyl Collection integration."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

import aiohttp
import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    ATTR_ALBUM,
    ATTR_ARTIST,
    ATTR_CATALOG_NUMBER,
    ATTR_COVER_URL,
    ATTR_DISCOGS_ID,
    ATTR_GENRE,
    ATTR_IS_NEXT_BUY,
    ATTR_IS_WISHLIST,
    ATTR_LABEL,
    ATTR_OWNED_BY,
    ATTR_QUERY,
    ATTR_RATING,
    ATTR_RECORD_ID,
    ATTR_SPOTIFY_URI,
    ATTR_YEAR,
    CONF_DISCOGS_ENABLED,
    CONF_DISCOGS_TOKEN,
    CONF_SPOTIFY_ENABLED,
    DISCOGS_IDENTITY_URL,
    DISCOGS_USER_AGENT,
    DOMAIN,
    EVENT_RECORD_ADDED,
    EVENT_RECORD_REMOVED,
    EVENT_RECORD_UPDATED,
    SERVICE_ADD_RECORD,
    SERVICE_GET_CONFIG,
    SERVICE_GET_DISCOGS_TRACKS,
    SERVICE_IMPORT_DISCOGS_COLLECTION,
    SERVICE_LOOKUP_DISCOGS,
    SERVICE_REMOVE_RECORD,
    SERVICE_SEARCH,
    SERVICE_UPDATE_RECORD,
)
from .store import VinylCollectionStore

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor"]
CARD_URL = "/vinyl_collection_frontend/vinyl-collection-card.js"
CARD_PATH = Path(__file__).parent / "vinyl-collection-card.js"

DISCOGS_SEARCH_URL = "https://api.discogs.com/database/search"
DISCOGS_RELEASE_URL = "https://api.discogs.com/releases/{}"
DISCOGS_MASTER_URL = "https://api.discogs.com/masters/{}"
DISCOGS_COLLECTION_URL = "https://api.discogs.com/users/{}/collection/folders/0/releases"

# Shared between handle_lookup_discogs and handle_import_discogs_collection -
# a release counts as vinyl if it has no non-vinyl format, or has both.
NON_VINYL_FORMATS = {"CD", "CDr", "DVD", "Blu-ray", "Cassette", "File", "Digital Media", "SACD", "VHS"}
VINYL_FORMATS = {"LP", "12\"", "10\"", "7\"", "EP", "Vinyl", "Flexi-disc", "Shellac", "Picture Disc", "Acetate"}

GET_DISCOGS_TRACKS_SCHEMA = vol.Schema({
    vol.Required(ATTR_DISCOGS_ID): cv.string,
    vol.Optional("resource_type", default="release"): cv.string,
})
IMPORT_DISCOGS_COLLECTION_SCHEMA = vol.Schema({})


def _valid_cover_url(value: Any) -> str:
    """Validate an http(s) URL that's also safe to embed in an HTML attribute.

    cv.url only checks the scheme - it does not reject characters like
    " or < that would let a stored cover_url break out of the
    double-quoted src="..." attribute the card renders it into.
    """
    url = cv.url(value)
    if any(char in url for char in ('"', "'", "<", ">")):
        raise vol.Invalid("cover_url contains unsafe characters")
    return url


ADD_RECORD_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ARTIST): cv.string,
        vol.Required(ATTR_ALBUM): cv.string,
        vol.Optional(ATTR_YEAR): cv.positive_int,
        vol.Optional(ATTR_GENRE): cv.string,
        vol.Optional(ATTR_LABEL): cv.string,
        vol.Optional(ATTR_CATALOG_NUMBER): cv.string,
        vol.Optional(ATTR_DISCOGS_ID): cv.string,
        vol.Optional(ATTR_COVER_URL): _valid_cover_url,
        vol.Optional(ATTR_SPOTIFY_URI): cv.string,
        vol.Optional(ATTR_RATING): vol.All(vol.Coerce(int), vol.Range(min=1, max=5)),
        vol.Optional(ATTR_IS_WISHLIST, default=False): cv.boolean,
        vol.Optional(ATTR_IS_NEXT_BUY, default=False): cv.boolean,
        vol.Optional(ATTR_OWNED_BY, default=[]): [cv.string],
    }
)

REMOVE_RECORD_SCHEMA = vol.Schema({vol.Required(ATTR_RECORD_ID): cv.string})

UPDATE_RECORD_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_RECORD_ID): cv.string,
        vol.Optional(ATTR_ARTIST): cv.string,
        vol.Optional(ATTR_ALBUM): cv.string,
        vol.Optional(ATTR_YEAR): cv.positive_int,
        vol.Optional(ATTR_GENRE): cv.string,
        vol.Optional(ATTR_LABEL): cv.string,
        vol.Optional(ATTR_CATALOG_NUMBER): cv.string,
        vol.Optional(ATTR_DISCOGS_ID): cv.string,
        vol.Optional(ATTR_COVER_URL): _valid_cover_url,
        vol.Optional(ATTR_SPOTIFY_URI): cv.string,
        vol.Optional(ATTR_RATING): vol.All(vol.Coerce(int), vol.Range(min=1, max=5)),
        vol.Optional(ATTR_IS_WISHLIST): cv.boolean,
        vol.Optional(ATTR_IS_NEXT_BUY): cv.boolean,
        vol.Optional(ATTR_OWNED_BY): [cv.string],
    }
)

SEARCH_SCHEMA = vol.Schema({vol.Optional(ATTR_QUERY, default=""): cv.string})
LOOKUP_DISCOGS_SCHEMA = vol.Schema({vol.Required(ATTR_QUERY): cv.string})
GET_CONFIG_SCHEMA = vol.Schema({})


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Vinyl Collection from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    frontend_data = hass.data.setdefault(f"{DOMAIN}_frontend", {})
    if not frontend_data.get("registered"):
        try:
            from homeassistant.components.http import StaticPathConfig
            await hass.http.async_register_static_paths(
                [StaticPathConfig(CARD_URL, str(CARD_PATH), cache_headers=False)]
            )
        except (ImportError, AttributeError):
            hass.http.register_static_path(CARD_URL, str(CARD_PATH), cache_headers=False)

        frontend_data["registered"] = True

    async def _async_register_lovelace_resource(_event=None) -> None:
        """Add the card to Lovelace resources via the in-memory collection."""
        try:
            lovelace = hass.data.get("lovelace")
            if not lovelace:
                return
            resources = (
                lovelace.get("resources")
                if isinstance(lovelace, dict)
                else getattr(lovelace, "resources", None)
            )
            if resources is None:
                return
            if hasattr(resources, "async_load"):
                await resources.async_load()
            existing = resources.async_items() if hasattr(resources, "async_items") else []
            if any(r.get("url") == CARD_URL for r in existing):
                return
            await resources.async_create_item({"res_type": "module", "url": CARD_URL})
            _LOGGER.info("Vinyl Collection: registered card as Lovelace resource")
        except (AttributeError, KeyError, TypeError) as err:
            # Expected if Lovelace's internal resource-collection shape changes.
            _LOGGER.warning(
                "Vinyl Collection: could not auto-register card — add %s manually as a module resource (%s)",
                CARD_URL, err,
            )
        except Exception:
            # Anything else is unexpected - log it loudly rather than
            # swallowing it into the same one-line warning as above, but
            # still don't let a cosmetic dashboard step fail the whole
            # integration setup.
            _LOGGER.exception(
                "Vinyl Collection: unexpected error auto-registering card — add %s manually as a module resource",
                CARD_URL,
            )

    if hass.is_running:
        await _async_register_lovelace_resource()
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _async_register_lovelace_resource)

    store = VinylCollectionStore(hass)
    try:
        await store.async_load()
    except Exception:
        _LOGGER.exception(
            "Failed to load vinyl collection storage; starting with empty collection"
        )

    hass.data[DOMAIN][entry.entry_id] = store

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    if not hass.services.has_service(DOMAIN, SERVICE_ADD_RECORD):
        _register_services(hass, entry)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
        if not hass.data[DOMAIN]:
            for service in (
                SERVICE_ADD_RECORD,
                SERVICE_REMOVE_RECORD,
                SERVICE_UPDATE_RECORD,
                SERVICE_SEARCH,
                SERVICE_LOOKUP_DISCOGS,
                SERVICE_GET_DISCOGS_TRACKS,
                SERVICE_GET_CONFIG,
                SERVICE_IMPORT_DISCOGS_COLLECTION,
            ):
                hass.services.async_remove(DOMAIN, service)
    return unload_ok


def _get_discogs_token(entry: ConfigEntry) -> str | None:
    """Get Discogs token — check options first, then data."""
    token = entry.options.get(CONF_DISCOGS_TOKEN) or entry.data.get(CONF_DISCOGS_TOKEN)
    return token if token else None


def _is_discogs_enabled(entry: ConfigEntry) -> bool:
    """Return True if Discogs integration is toggled on."""
    return bool(
        entry.options.get(CONF_DISCOGS_ENABLED, entry.data.get(CONF_DISCOGS_ENABLED, False))
    )


def _is_spotify_enabled(entry: ConfigEntry) -> bool:
    """Return True if Spotify integration is toggled on."""
    return bool(
        entry.options.get(CONF_SPOTIFY_ENABLED, entry.data.get(CONF_SPOTIFY_ENABLED, False))
    )


async def async_import_discogs_collection(
    hass: HomeAssistant, store: VinylCollectionStore, token: str
) -> dict[str, int]:
    """Import a Discogs collection into the given store, skipping duplicates by discogs_id.

    Standalone (no ConfigEntry dependency) so it can run both from the
    import_discogs_collection service (an entry, and its store, already
    exist) and from config_flow (no entry exists yet during initial setup,
    so the caller passes a fresh VinylCollectionStore instead) - callers are
    responsible for passing the *live* store when one is already running, to
    avoid writing through a second, out-of-sync store instance (exactly the
    class of bug fixed for reloads: two store objects backed by the same
    file, only one of which anything else is actually looking at).
    """
    headers = {"User-Agent": DISCOGS_USER_AGENT, "Authorization": f"Discogs token={token}"}
    session = async_get_clientsession(hass)

    try:
        async with session.get(
            DISCOGS_IDENTITY_URL, headers=headers, timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            if resp.status != 200:
                raise HomeAssistantError(
                    f"Discogs API returned status {resp.status} while resolving identity"
                )
            identity = await resp.json()
    except aiohttp.ClientError as err:
        raise HomeAssistantError(f"Failed to reach Discogs API: {err}") from err
    username = identity.get("username")
    if not username:
        raise HomeAssistantError("Could not resolve Discogs username for this token")

    imported = 0
    skipped_duplicates = 0
    skipped_non_vinyl = 0
    skipped_invalid = 0
    total_found = 0

    url = DISCOGS_COLLECTION_URL.format(username)
    page = 1
    while True:
        try:
            async with session.get(
                url,
                headers=headers,
                params={"per_page": 100, "page": page},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    raise HomeAssistantError(
                        f"Discogs API returned status {resp.status} while fetching collection"
                    )
                data = await resp.json()
        except aiohttp.ClientError as err:
            raise HomeAssistantError(f"Failed to reach Discogs API: {err}") from err

        releases = data.get("releases", [])
        total_found += len(releases)

        # Re-read from the store each page rather than snapshotting once
        # upfront - a concurrent add_record call (e.g. from an automation)
        # while this page was in flight would otherwise go unnoticed and
        # risk a duplicate.
        existing_discogs_ids = {
            r.get("discogs_id") for r in store.records.values() if r.get("discogs_id")
        }
        pending: list[dict[str, Any]] = []

        for item in releases:
            info = item.get("basic_information", {})
            discogs_id = str(info.get("id") or "")
            if not discogs_id:
                skipped_invalid += 1
                continue
            if discogs_id in existing_discogs_ids:
                skipped_duplicates += 1
                continue

            format_strings: set[str] = set()
            for fmt in info.get("formats", []):
                if fmt.get("name"):
                    format_strings.add(fmt["name"])
                format_strings.update(fmt.get("descriptions", []))
            has_non_vinyl = bool(format_strings & NON_VINYL_FORMATS)
            has_vinyl = bool(format_strings & VINYL_FORMATS)
            if has_non_vinyl and not has_vinyl:
                skipped_non_vinyl += 1
                continue

            artists = info.get("artists", [])
            artist = (artists[0].get("name") or "").strip() if artists else ""
            album = (info.get("title") or "").strip()
            if not artist or not album:
                skipped_invalid += 1
                continue

            record: dict[str, Any] = {
                "artist": artist,
                "album": album,
                "discogs_id": discogs_id,
                # Collection items are always releases, never masters - safe
                # to record even though this branch's schema doesn't surface
                # it yet (store.py has no field allowlist).
                "discogs_resource_type": "release",
            }
            year = info.get("year")
            if year:
                record["year"] = year
            labels = info.get("labels", [])
            if labels:
                if labels[0].get("name"):
                    record["label"] = labels[0]["name"]
                if labels[0].get("catno"):
                    record["catalog_number"] = labels[0]["catno"]
            genres = info.get("genres") or info.get("styles") or []
            if genres:
                record["genre"] = genres[0]
            cover_url = info.get("cover_image") or info.get("thumb")
            if cover_url:
                try:
                    record["cover_url"] = _valid_cover_url(cover_url)
                except vol.Invalid:
                    pass  # skip just the cover, not the whole record

            pending.append(record)
            existing_discogs_ids.add(discogs_id)
            imported += 1

        if pending:
            # One save per page instead of one per record - importing a
            # thousand-record collection would otherwise mean a thousand
            # full-collection disk writes.
            await store.async_add_records_bulk(pending)

        pagination = data.get("pagination", {})
        if page >= pagination.get("pages", 1):
            break
        page += 1
        await asyncio.sleep(1)  # stay comfortably under Discogs' 60 req/min

    if imported:
        _refresh_sensors(hass)

    return {
        "imported": imported,
        "skipped_duplicates": skipped_duplicates,
        "skipped_non_vinyl": skipped_non_vinyl,
        "skipped_invalid": skipped_invalid,
        "total_found": total_found,
    }


def _register_services(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register all vinyl_collection services.

    Handlers look up the store from hass.data on every call rather than
    closing over a captured instance, since services are only registered
    once (guarded by has_service) but a reload replaces the store object
    each time async_setup_entry runs.
    """

    def _store() -> VinylCollectionStore:
        return hass.data[DOMAIN][entry.entry_id]

    async def handle_add_record(call: ServiceCall) -> ServiceResponse:
        try:
            record = await _store().async_add_record(dict(call.data))
        except Exception as err:
            _LOGGER.exception("Failed to add record")
            raise HomeAssistantError(f"Failed to add record: {err}") from err
        hass.bus.async_fire(EVENT_RECORD_ADDED, {"record": record})
        _refresh_sensors(hass)
        return {"record": record}

    async def handle_remove_record(call: ServiceCall) -> ServiceResponse:
        record_id = call.data[ATTR_RECORD_ID]
        try:
            removed = await _store().async_remove_record(record_id)
        except Exception as err:
            _LOGGER.exception("Failed to remove record %s", record_id)
            raise HomeAssistantError(f"Failed to remove record: {err}") from err
        if not removed:
            raise HomeAssistantError(f"Record not found: {record_id}")
        hass.bus.async_fire(EVENT_RECORD_REMOVED, {"record_id": record_id})
        _refresh_sensors(hass)
        return {"removed": removed}

    async def handle_update_record(call: ServiceCall) -> ServiceResponse:
        data = dict(call.data)
        record_id = data.pop(ATTR_RECORD_ID)
        try:
            record = await _store().async_update_record(record_id, data)
        except Exception as err:
            _LOGGER.exception("Failed to update record %s", record_id)
            raise HomeAssistantError(f"Failed to update record: {err}") from err
        if record is None:
            raise HomeAssistantError(f"Record not found: {record_id}")
        hass.bus.async_fire(EVENT_RECORD_UPDATED, {"record": record})
        _refresh_sensors(hass)
        return {"record": record}

    async def handle_search(call: ServiceCall) -> ServiceResponse:
        query = call.data.get(ATTR_QUERY, "")
        try:
            results = _store().search(query)
        except Exception as err:
            _LOGGER.exception("Search failed for query: %s", query)
            raise HomeAssistantError(f"Search failed: {err}") from err

        exact_match = None
        if query:
            parts = query.split(" - ", 1)
            if len(parts) == 2:
                exact_match = _store().find_by_artist_album(parts[0], parts[1])

        return {
            "results": results,
            "count": len(results),
            "exact_match": exact_match,
        }

    async def handle_get_config(call: ServiceCall) -> ServiceResponse:
        """Return integration config state — no outbound calls."""
        token = _get_discogs_token(entry)
        return {
            "has_discogs_token": token is not None,
            "discogs_enabled": _is_discogs_enabled(entry),
            "spotify_enabled": _is_spotify_enabled(entry),
        }

    async def handle_lookup_discogs(call: ServiceCall) -> ServiceResponse:
        """Search Discogs for a release and return top results."""
        if not _is_discogs_enabled(entry):
            raise HomeAssistantError("Discogs integration is disabled")
        query = call.data[ATTR_QUERY]
        token = _get_discogs_token(entry)

        headers = {"User-Agent": DISCOGS_USER_AGENT}
        if token:
            headers["Authorization"] = f"Discogs token={token}"

        params = {"q": query, "per_page": 15, "page": 1}
        session = async_get_clientsession(hass)

        try:
            async with session.get(
                DISCOGS_SEARCH_URL,
                headers=headers,
                params=params,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    raise HomeAssistantError(f"Discogs API returned status {resp.status}")
                data = await resp.json()
        except aiohttp.ClientError as err:
            raise HomeAssistantError(f"Failed to reach Discogs API: {err}") from err

        _VALID_TYPES = {"master", "release"}

        results = []
        for item in data.get("results", []):
            if item.get("type") not in _VALID_TYPES:
                continue
            item_formats = set(item.get("format", []))
            has_non_vinyl = bool(item_formats & NON_VINYL_FORMATS)
            has_vinyl = bool(item_formats & VINYL_FORMATS)
            if has_non_vinyl and not has_vinyl:
                continue
            year = None
            raw_year = item.get("year")
            if raw_year:
                try:
                    year = int(raw_year)
                except ValueError:
                    pass

            formats = item.get("format", [])
            fmt = formats[0] if formats else None
            labels = item.get("label", [])
            label = labels[0] if labels else None
            catalog = item.get("catno")
            cover_url = item.get("cover_image") or item.get("thumb")
            genres = item.get("genre", [])
            styles = item.get("style", [])
            genre = genres[0] if genres else (styles[0] if styles else None)

            title_raw = item.get("title", "")
            if " - " in title_raw:
                parts = title_raw.split(" - ", 1)
                artist = parts[0].strip()
                album = parts[1].strip()
            else:
                artist = ""
                album = title_raw.strip()

            results.append({
                "discogs_id": str(item.get("id", "")),
                "resource_type": item.get("type", "release"),
                "artist": artist,
                "album": album,
                "year": year,
                "format": fmt,
                "label": label,
                "catalog_number": catalog,
                "cover_url": cover_url,
                "genre": genre,
                "country": item.get("country"),
                "spotify_uri": None,
            })

        return {"results": results, "count": len(results), "has_token": token is not None}

    hass.services.async_register(
        DOMAIN, SERVICE_ADD_RECORD, handle_add_record,
        schema=ADD_RECORD_SCHEMA, supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_REMOVE_RECORD, handle_remove_record,
        schema=REMOVE_RECORD_SCHEMA, supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_RECORD, handle_update_record,
        schema=UPDATE_RECORD_SCHEMA, supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SEARCH, handle_search,
        schema=SEARCH_SCHEMA, supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_GET_CONFIG, handle_get_config,
        schema=GET_CONFIG_SCHEMA, supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_LOOKUP_DISCOGS, handle_lookup_discogs,
        schema=LOOKUP_DISCOGS_SCHEMA, supports_response=SupportsResponse.ONLY,
    )

    async def handle_get_discogs_tracks(call: ServiceCall) -> ServiceResponse:
        """Fetch tracklist for a Discogs release or master."""
        if not _is_discogs_enabled(entry):
            raise HomeAssistantError("Discogs integration is disabled")
        discogs_id = call.data[ATTR_DISCOGS_ID]
        resource_type = call.data.get("resource_type", "release")
        token = _get_discogs_token(entry)
        headers = {"User-Agent": DISCOGS_USER_AGENT}
        if token:
            headers["Authorization"] = f"Discogs token={token}"
        url = (DISCOGS_MASTER_URL if resource_type == "master" else DISCOGS_RELEASE_URL).format(discogs_id)
        session = async_get_clientsession(hass)
        try:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    raise HomeAssistantError(f"Discogs API returned status {resp.status}")
                data = await resp.json()
        except aiohttp.ClientError as err:
            raise HomeAssistantError(f"Failed to reach Discogs API: {err}") from err
        tracks = [
            {"position": t.get("position", ""), "title": t.get("title", ""), "duration": t.get("duration", "")}
            for t in data.get("tracklist", [])
            if t.get("type_", "track") == "track"
        ]
        return {"tracks": tracks, "count": len(tracks)}

    hass.services.async_register(
        DOMAIN, SERVICE_GET_DISCOGS_TRACKS, handle_get_discogs_tracks,
        schema=GET_DISCOGS_TRACKS_SCHEMA, supports_response=SupportsResponse.ONLY,
    )

    async def handle_import_discogs_collection(call: ServiceCall) -> ServiceResponse:
        """Import the user's existing Discogs collection, skipping duplicates by discogs_id."""
        if not _is_discogs_enabled(entry):
            raise HomeAssistantError("Discogs integration is disabled")
        token = _get_discogs_token(entry)
        if not token:
            raise HomeAssistantError("Discogs token is not set")
        return await async_import_discogs_collection(hass, _store(), token)

    hass.services.async_register(
        DOMAIN, SERVICE_IMPORT_DISCOGS_COLLECTION, handle_import_discogs_collection,
        schema=IMPORT_DISCOGS_COLLECTION_SCHEMA, supports_response=SupportsResponse.ONLY,
    )


def _refresh_sensors(hass: HomeAssistant) -> None:
    """Notify sensor entities that the underlying data changed."""
    hass.bus.async_fire(f"{DOMAIN}_data_updated")