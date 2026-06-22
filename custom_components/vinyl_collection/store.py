"""Storage layer for the Vinyl Collection integration."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)


class VinylCollectionStore:
    """Manages persistence of the vinyl record collection."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._records: dict[str, dict[str, Any]] = {}
        self.loaded = False

    async def async_load(self) -> None:
        """Load records from disk."""
        data = await self._store.async_load()
        self._records = data or {}
        self.loaded = True
        _LOGGER.debug("Loaded %d records from storage", len(self._records))

    async def async_save(self) -> None:
        """Persist records to disk."""
        await self._store.async_save(self._records)

    @property
    def records(self) -> dict[str, dict[str, Any]]:
        return self._records

    @property
    def count(self) -> int:
        return len(self._records)

    async def async_add_record(self, record: dict[str, Any]) -> dict[str, Any]:
        """Add a new record and return it (including generated id)."""
        record_id = str(uuid.uuid4())
        record = dict(record)
        record["record_id"] = record_id
        record["date_added"] = datetime.now().isoformat()
        self._records[record_id] = record
        await self.async_save()
        return record

    async def async_remove_record(self, record_id: str) -> bool:
        """Remove a record by id. Returns True if it existed."""
        if record_id not in self._records:
            return False
        del self._records[record_id]
        await self.async_save()
        return True

    async def async_update_record(
        self, record_id: str, updates: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Update fields on an existing record."""
        if record_id not in self._records:
            return None
        self._records[record_id].update(updates)
        await self.async_save()
        return self._records[record_id]

    def search(self, query: str) -> list[dict[str, Any]]:
        """Case-insensitive search across artist, album, label, genre, catalog number."""
        if not query:
            return list(self._records.values())

        q = query.lower().strip()
        results = []
        for record in self._records.values():
            haystack = " ".join(
                str(record.get(field, ""))
                for field in (
                    "artist",
                    "album",
                    "label",
                    "genre",
                    "catalog_number",
                    "notes",
                )
            ).lower()
            if q in haystack:
                results.append(record)

        # Sort by artist, then album for predictable browsing
        results.sort(key=lambda r: (r.get("artist", "").lower(), r.get("album", "").lower()))
        return results

    def find_by_artist_album(self, artist: str, album: str) -> dict[str, Any] | None:
        """Exact-ish lookup used to flag possible duplicates while shopping."""
        artist_l = artist.lower().strip()
        album_l = album.lower().strip()
        for record in self._records.values():
            if (
                record.get("artist", "").lower().strip() == artist_l
                and record.get("album", "").lower().strip() == album_l
            ):
                return record
        return None
