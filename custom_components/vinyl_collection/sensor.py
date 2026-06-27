"""Sensor platform for Vinyl Collection."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.sensor import SensorEntity

from .const import DOMAIN
from .store import VinylCollectionStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the count sensors."""
    store: VinylCollectionStore = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([
        VinylCollectionCountSensor(hass, store, entry),
        VinylCollectionWishlistSensor(hass, store, entry),
    ])


class _VinylSensorBase(SensorEntity):
    """Shared base for Vinyl Collection sensors."""

    _attr_icon = "mdi:album"
    _attr_native_unit_of_measurement = "records"
    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(
        self, hass: HomeAssistant, store: VinylCollectionStore, entry: ConfigEntry
    ) -> None:
        self._hass = hass
        self._store = store
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="Snow Monkey Lab",
            model="Vinyl Collection",
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self._hass.bus.async_listen(
                f"{DOMAIN}_data_updated", self._handle_data_updated
            )
        )

    @callback
    def _handle_data_updated(self, event) -> None:
        self.async_write_ha_state()


class VinylCollectionCountSensor(_VinylSensorBase):
    """Sensor reporting the total number of records in the collection."""

    _attr_name = "Total Records"

    def __init__(self, hass: HomeAssistant, store: VinylCollectionStore, entry: ConfigEntry) -> None:
        super().__init__(hass, store, entry)
        self._attr_unique_id = f"{entry.entry_id}_total_records"

    @property
    def native_value(self) -> int:
        return sum(1 for r in self._store.records.values() if not r.get("is_wishlist"))

    @property
    def extra_state_attributes(self) -> dict:
        return {"total_including_wishlist": self._store.count}


class VinylCollectionWishlistSensor(_VinylSensorBase):
    """Sensor reporting the number of records on the wish list."""

    _attr_name = "Wish List"
    _attr_icon = "mdi:heart"

    def __init__(self, hass: HomeAssistant, store: VinylCollectionStore, entry: ConfigEntry) -> None:
        super().__init__(hass, store, entry)
        self._attr_unique_id = f"{entry.entry_id}_wishlist"

    @property
    def native_value(self) -> int:
        return sum(1 for r in self._store.records.values() if r.get("is_wishlist"))
