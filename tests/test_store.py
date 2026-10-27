"""Tests for VinylCollectionStore."""
import pytest

from custom_components.vinyl_collection.store import VinylCollectionStore


@pytest.fixture
async def store(hass):
    store = VinylCollectionStore(hass)
    await store.async_load()
    return store


async def test_add_assigns_id_and_date(store):
    record = await store.async_add_record({"artist": "Miles Davis", "album": "Kind of Blue"})
    assert record["record_id"] in store.records
    assert record["date_added"]
    assert store.count == 1


async def test_bulk_add(store):
    added = await store.async_add_records_bulk(
        [{"artist": "A", "album": "One"}, {"artist": "B", "album": "Two"}]
    )
    assert len(added) == 2
    assert len({r["record_id"] for r in added}) == 2
    assert store.count == 2


async def test_bulk_add_empty_is_noop(store):
    assert await store.async_add_records_bulk([]) == []


async def test_remove(store):
    record = await store.async_add_record({"artist": "A", "album": "B"})
    assert await store.async_remove_record(record["record_id"]) is True
    assert await store.async_remove_record(record["record_id"]) is False
    assert store.count == 0


async def test_update_unknown_returns_none(store):
    assert await store.async_update_record("nope", {"year": 1999}) is None


async def test_update_merges_fields(store):
    record = await store.async_add_record({"artist": "A", "album": "B", "is_wishlist": True})
    updated = await store.async_update_record(record["record_id"], {"year": 1959})
    assert updated["year"] == 1959
    assert updated["artist"] == "A"


async def test_next_buy_kept_on_wishlist(store):
    record = await store.async_add_record(
        {"artist": "A", "album": "B", "is_wishlist": True, "is_next_buy": True}
    )
    updated = await store.async_update_record(record["record_id"], {"year": 2000})
    assert updated["is_next_buy"] is True


async def test_next_buy_cleared_when_moved_to_collection(store):
    record = await store.async_add_record(
        {"artist": "A", "album": "B", "is_wishlist": True, "is_next_buy": True}
    )
    updated = await store.async_update_record(record["record_id"], {"is_wishlist": False})
    assert updated["is_next_buy"] is False


async def test_search_matches_fields_case_insensitively_and_sorts(store):
    await store.async_add_record({"artist": "Zed", "album": "Jazz Two", "genre": "Jazz"})
    await store.async_add_record({"artist": "Abe", "album": "Rock", "label": "Jazzy Records"})
    await store.async_add_record({"artist": "Cat", "album": "Pop"})
    results = store.search("JAZZ")
    assert [r["artist"] for r in results] == ["Abe", "Zed"]


async def test_search_empty_query_returns_all(store):
    await store.async_add_record({"artist": "A", "album": "B"})
    await store.async_add_record({"artist": "C", "album": "D"})
    assert len(store.search("")) == 2


async def test_find_by_artist_album(store):
    record = await store.async_add_record({"artist": "Miles Davis", "album": "Kind of Blue"})
    assert store.find_by_artist_album("  miles davis ", "KIND OF BLUE")["record_id"] == record["record_id"]
    assert store.find_by_artist_album("Miles Davis", "Bitches Brew") is None


async def test_persistence_roundtrip(hass, hass_storage):
    first = VinylCollectionStore(hass)
    await first.async_load()
    record = await first.async_add_record({"artist": "A", "album": "B"})

    second = VinylCollectionStore(hass)
    await second.async_load()
    assert record["record_id"] in second.records
