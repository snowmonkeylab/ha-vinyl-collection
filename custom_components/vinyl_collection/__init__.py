"""The Vinyl Collection integration."""
from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_ALBUM,
    ATTR_ARTIST,
    ATTR_CATALOG_NUMBER,
    ATTR_CONDITION,
    ATTR_COVER_URL,
    ATTR_DISCOGS_ID,
    ATTR_FORMAT,
    ATTR_GENRE,
    ATTR_LABEL,
    ATTR_NOTES,
    ATTR_QUERY,
    ATTR_RECORD_ID,
    ATTR_YEAR,
    DOMAIN,
    EVENT_RECORD_ADDED,
    EVENT_RECORD_REMOVED,
    EVENT_RECORD_UPDATED,
    SERVICE_ADD_RECORD,
    SERVICE_REMOVE_RECORD,
    SERVICE_SEARCH,
    SERVICE_UPDATE_RECORD,
)
from .store import VinylCollectionStore

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor"]

ADD_RECORD_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ARTIST): cv.string,
        vol.Required(ATTR_ALBUM): cv.string,
        vol.Optional(ATTR_YEAR): cv.positive_int,
        vol.Optional(ATTR_FORMAT): cv.string,
        vol.Optional(ATTR_CONDITION): cv.string,
        vol.Optional(ATTR_GENRE): cv.string,
        vol.Optional(ATTR_LABEL): cv.string,
        vol.Optional(ATTR_CATALOG_NUMBER): cv.string,
        vol.Optional(ATTR_NOTES): cv.string,
        vol.Optional(ATTR_DISCOGS_ID): cv.string,
        vol.Optional(ATTR_COVER_URL): cv.string,
    }
)

REMOVE_RECORD_SCHEMA = vol.Schema({vol.Required(ATTR_RECORD_ID): cv.string})

UPDATE_RECORD_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_RECORD_ID): cv.string,
        vol.Optional(ATTR_ARTIST): cv.string,
        vol.Optional(ATTR_ALBUM): cv.string,
        vol.Optional(ATTR_YEAR): cv.positive_int,
        vol.Optional(ATTR_FORMAT): cv.string,
        vol.Optional(ATTR_CONDITION): cv.string,
        vol.Optional(ATTR_GENRE): cv.string,
        vol.Optional(ATTR_LABEL): cv.string,
        vol.Optional(ATTR_CATALOG_NUMBER): cv.string,
        vol.Optional(ATTR_NOTES): cv.string,
    }
)

SEARCH_SCHEMA = vol.Schema({vol.Optional(ATTR_QUERY, default=""): cv.string})


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Vinyl Collection from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    store = VinylCollectionStore(hass)
    await store.async_load()
    hass.data[DOMAIN][entry.entry_id] = store

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Services are global (not per-entry) since this is a single-instance integration
    if not hass.services.has_service(DOMAIN, SERVICE_ADD_RECORD):
        _register_services(hass, store)

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
            ):
                hass.services.async_remove(DOMAIN, service)
    return unload_ok


def _register_services(hass: HomeAssistant, store: VinylCollectionStore) -> None:
    """Register all vinyl_collection services."""

    async def handle_add_record(call: ServiceCall) -> ServiceResponse:
        record = await store.async_add_record(dict(call.data))
        hass.bus.async_fire(EVENT_RECORD_ADDED, {"record": record})
        _refresh_sensors(hass)
        return {"record": record}

    async def handle_remove_record(call: ServiceCall) -> ServiceResponse:
        record_id = call.data[ATTR_RECORD_ID]
        removed = await store.async_remove_record(record_id)
        if removed:
            hass.bus.async_fire(EVENT_RECORD_REMOVED, {"record_id": record_id})
            _refresh_sensors(hass)
        return {"removed": removed}

    async def handle_update_record(call: ServiceCall) -> ServiceResponse:
        data = dict(call.data)
        record_id = data.pop(ATTR_RECORD_ID)
        record = await store.async_update_record(record_id, data)
        if record:
            hass.bus.async_fire(EVENT_RECORD_UPDATED, {"record": record})
        return {"record": record}

    async def handle_search(call: ServiceCall) -> ServiceResponse:
        query = call.data.get(ATTR_QUERY, "")
        results = store.search(query)

        # Flag exact artist+album matches so the shopping-mode UI can
        # warn "you already own this" prominently.
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

    hass.services.async_register(
        DOMAIN,
        SERVICE_ADD_RECORD,
        handle_add_record,
        schema=ADD_RECORD_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_REMOVE_RECORD,
        handle_remove_record,
        schema=REMOVE_RECORD_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_UPDATE_RECORD,
        handle_update_record,
        schema=UPDATE_RECORD_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SEARCH,
        handle_search,
        schema=SEARCH_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )


def _refresh_sensors(hass: HomeAssistant) -> None:
    """Notify sensor entities that the underlying data changed."""
    hass.bus.async_fire(f"{DOMAIN}_data_updated")
