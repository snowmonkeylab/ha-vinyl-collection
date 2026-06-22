"""Sensor platform for Vinyl Collection."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.components.sensor import SensorEntity

from .const import DOMAIN
from .store import VinylCollectionStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the count sensor."""
    store: VinylCollectionStore = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([VinylCollectionCountSensor(hass, store, entry)])


class VinylCollectionCountSensor(SensorEntity):
    """Sensor reporting the total number of records in the collection."""

    _attr_icon = "mdi:album"
    _attr_native_unit_of_measurement = "records"
    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_name = "Total Records"

    def __init__(
        self, hass: HomeAssistant, store: VinylCollectionStore, entry: ConfigEntry
    ) -> None:
        self._hass = hass
        self._store = store
        self._attr_unique_id = f"{entry.entry_id}_total_records"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="Snow Monkey Lab",
            model="Vinyl Collection",
        )

    @property
    def native_value(self) -> int:
        return self._store.count

    @property
    def extra_state_attributes(self) -> dict:
        # Small breakdown by format, useful at a glance on a dashboard
        formats: dict[str, int] = {}
        for record in self._store.records.values():
            fmt = record.get("format") or "Unknown"
            formats[fmt] = formats.get(fmt, 0) + 1
        return {"by_format": formats}

    async def async_added_to_hass(self) -> None:
        """Subscribe to the data-updated event fired by services."""
        self.async_on_remove(
            self._hass.bus.async_listen(
                f"{DOMAIN}_data_updated", self._handle_data_updated
            )
        )

    @callback
    def _handle_data_updated(self, event) -> None:
        self.async_write_ha_state()
