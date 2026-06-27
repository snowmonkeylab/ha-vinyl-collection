"""The Vinyl Collection integration."""
from __future__ import annotations

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
    ATTR_LABEL,
    ATTR_QUERY,
    ATTR_RATING,
    ATTR_RECORD_ID,
    ATTR_SPOTIFY_URI,
    ATTR_YEAR,
    CONF_DISCOGS_ENABLED,
    CONF_DISCOGS_TOKEN,
    CONF_SPOTIFY_ENABLED,
    DOMAIN,
    EVENT_RECORD_ADDED,
    EVENT_RECORD_REMOVED,
    EVENT_RECORD_UPDATED,
    SERVICE_ADD_RECORD,
    SERVICE_GET_CONFIG,
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
DISCOGS_USER_AGENT = "ha-vinyl-collection/1.0 +https://github.com/snowmonkeylab/ha-vinyl-collection"

ADD_RECORD_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ARTIST): cv.string,
        vol.Required(ATTR_ALBUM): cv.string,
        vol.Optional(ATTR_YEAR): cv.positive_int,
        vol.Optional(ATTR_GENRE): cv.string,
        vol.Optional(ATTR_LABEL): cv.string,
        vol.Optional(ATTR_CATALOG_NUMBER): cv.string,
        vol.Optional(ATTR_DISCOGS_ID): cv.string,
        vol.Optional(ATTR_COVER_URL): cv.string,
        vol.Optional(ATTR_SPOTIFY_URI): cv.string,
        vol.Optional(ATTR_RATING): vol.All(vol.Coerce(int), vol.Range(min=1, max=5)),
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
        vol.Optional(ATTR_COVER_URL): cv.string,
        vol.Optional(ATTR_SPOTIFY_URI): cv.string,
        vol.Optional(ATTR_RATING): vol.All(vol.Coerce(int), vol.Range(min=1, max=5)),
    }
)

SEARCH_SCHEMA = vol.Schema({vol.Optional(ATTR_QUERY, default=""): cv.string})
LOOKUP_DISCOGS_SCHEMA = vol.Schema({vol.Required(ATTR_QUERY): cv.string})
GET_CONFIG_SCHEMA = vol.Schema({})


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Vinyl Collection from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    if not hass.data[DOMAIN].get("_frontend_registered"):
        try:
            from homeassistant.components.http import StaticPathConfig
            await hass.http.async_register_static_paths(
                [StaticPathConfig(CARD_URL, str(CARD_PATH), cache_headers=False)]
            )
        except (ImportError, AttributeError):
            hass.http.register_static_path(CARD_URL, str(CARD_PATH), cache_headers=False)

        hass.data[DOMAIN]["_frontend_registered"] = True

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
        except Exception as err:
            _LOGGER.warning(
                "Vinyl Collection: could not auto-register card — add %s manually as a module resource (%s)",
                CARD_URL, err,
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
        _register_services(hass, store, entry)

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
                SERVICE_GET_CONFIG,
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


def _register_services(
    hass: HomeAssistant, store: VinylCollectionStore, entry: ConfigEntry
) -> None:
    """Register all vinyl_collection services."""

    async def handle_add_record(call: ServiceCall) -> ServiceResponse:
        try:
            record = await store.async_add_record(dict(call.data))
        except Exception as err:
            _LOGGER.exception("Failed to add record")
            raise HomeAssistantError(f"Failed to add record: {err}") from err
        hass.bus.async_fire(EVENT_RECORD_ADDED, {"record": record})
        _refresh_sensors(hass)
        return {"record": record}

    async def handle_remove_record(call: ServiceCall) -> ServiceResponse:
        record_id = call.data[ATTR_RECORD_ID]
        try:
            removed = await store.async_remove_record(record_id)
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
            record = await store.async_update_record(record_id, data)
        except Exception as err:
            _LOGGER.exception("Failed to update record %s", record_id)
            raise HomeAssistantError(f"Failed to update record: {err}") from err
        if record is None:
            raise HomeAssistantError(f"Record not found: {record_id}")
        hass.bus.async_fire(EVENT_RECORD_UPDATED, {"record": record})
        return {"record": record}

    async def handle_search(call: ServiceCall) -> ServiceResponse:
        query = call.data.get(ATTR_QUERY, "")
        try:
            results = store.search(query)
        except Exception as err:
            _LOGGER.exception("Search failed for query: %s", query)
            raise HomeAssistantError(f"Search failed: {err}") from err

        exact_match = None
        if query:
            parts = query.split(" - ", 1)
            if len(parts) == 2:
                exact_match = store.find_by_artist_album(parts[0], parts[1])

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

        params = {"q": query, "type": "master", "per_page": 8, "page": 1}
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

        results = []
        for item in data.get("results", []):
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


def _refresh_sensors(hass: HomeAssistant) -> None:
    """Notify sensor entities that the underlying data changed."""
    hass.bus.async_fire(f"{DOMAIN}_data_updated")