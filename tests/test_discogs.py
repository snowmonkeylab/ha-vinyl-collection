"""Tests for the Discogs lookup, tracklist and collection import."""
from unittest.mock import patch

import pytest
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.vinyl_collection import async_import_discogs_collection
from custom_components.vinyl_collection.const import DISCOGS_IDENTITY_URL, DOMAIN
from custom_components.vinyl_collection.store import VinylCollectionStore

COLLECTION_URL = "https://api.discogs.com/users/tester/collection/folders/0/releases"


def _release(rid, artist="Artist", title="Album", formats=None, **extra):
    info = {
        "id": rid,
        "title": title,
        "artists": [{"name": artist}],
        "formats": formats if formats is not None else [{"name": "Vinyl", "descriptions": ["LP"]}],
    }
    info.update(extra)
    return {"basic_information": info}


@pytest.fixture(autouse=True)
def no_sleep():
    with patch("custom_components.vinyl_collection.asyncio.sleep"):
        yield


@pytest.fixture
async def store(hass):
    store = VinylCollectionStore(hass)
    await store.async_load()
    return store


async def test_import_filters_and_counts(hass, store, aioclient_mock):
    aioclient_mock.get(DISCOGS_IDENTITY_URL, json={"username": "tester"})
    aioclient_mock.get(
        COLLECTION_URL,
        json={
            "pagination": {"pages": 1},
            "releases": [
                _release(1, "Miles Davis", "Kind of Blue", year=1959,
                         labels=[{"name": "Columbia", "catno": "CL 1355"}], genres=["Jazz"],
                         cover_image="https://img.example/1.jpg"),
                _release(2, formats=[{"name": "CD", "descriptions": []}]),
                _release(3, formats=[{"name": "CD"}, {"name": "Vinyl", "descriptions": ["LP"]}]),
                _release(4, artist="", title="No Artist"),
                {"basic_information": {"title": "No id", "artists": [{"name": "X"}]}},
                _release(1, "Miles Davis", "Kind of Blue"),
            ],
        },
    )

    result = await async_import_discogs_collection(hass, store, "tok")

    assert result == {
        "imported": 2,
        "skipped_duplicates": 1,
        "skipped_non_vinyl": 1,
        "skipped_invalid": 2,
        "total_found": 6,
    }
    miles = store.find_by_artist_album("Miles Davis", "Kind of Blue")
    assert miles["discogs_id"] == "1"
    assert miles["label"] == "Columbia"
    assert miles["catalog_number"] == "CL 1355"
    assert miles["genre"] == "Jazz"
    assert miles["year"] == 1959


async def test_import_skips_existing_discogs_ids(hass, store, aioclient_mock):
    await store.async_add_record({"artist": "A", "album": "B", "discogs_id": "1"})
    aioclient_mock.get(DISCOGS_IDENTITY_URL, json={"username": "tester"})
    aioclient_mock.get(
        COLLECTION_URL, json={"pagination": {"pages": 1}, "releases": [_release(1)]}
    )
    result = await async_import_discogs_collection(hass, store, "tok")
    assert result["imported"] == 0
    assert result["skipped_duplicates"] == 1
    assert store.count == 1


async def test_import_drops_unsafe_cover_but_keeps_record(hass, store, aioclient_mock):
    aioclient_mock.get(DISCOGS_IDENTITY_URL, json={"username": "tester"})
    aioclient_mock.get(
        COLLECTION_URL,
        json={
            "pagination": {"pages": 1},
            "releases": [_release(1, cover_image='https://x.example/a"b.jpg')],
        },
    )
    await async_import_discogs_collection(hass, store, "tok")
    assert "cover_url" not in next(iter(store.records.values()))


async def test_import_follows_pagination(hass, store, aioclient_mock):
    aioclient_mock.get(DISCOGS_IDENTITY_URL, json={"username": "tester"})
    aioclient_mock.get(
        COLLECTION_URL,
        json={"pagination": {"pages": 2}, "releases": [_release(1)]},
    )
    result = await async_import_discogs_collection(hass, store, "tok")
    # same mocked page returned twice: second copy is a duplicate by discogs_id
    assert result["imported"] == 1
    assert result["skipped_duplicates"] == 1
    assert aioclient_mock.call_count == 3


async def test_import_identity_failure(hass, store, aioclient_mock):
    aioclient_mock.get(DISCOGS_IDENTITY_URL, status=401)
    with pytest.raises(HomeAssistantError, match="401"):
        await async_import_discogs_collection(hass, store, "bad")


async def test_import_collection_failure(hass, store, aioclient_mock):
    aioclient_mock.get(DISCOGS_IDENTITY_URL, json={"username": "tester"})
    aioclient_mock.get(COLLECTION_URL, status=500)
    with pytest.raises(HomeAssistantError, match="500"):
        await async_import_discogs_collection(hass, store, "tok")


@pytest.fixture
async def discogs_entry(hass):
    entry = MockConfigEntry(
        domain=DOMAIN, data={"name": "V", "discogs_enabled": True, "discogs_token": "tok"}
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _call(hass, service, data):
    return await hass.services.async_call(
        DOMAIN, service, data, blocking=True, return_response=True
    )


async def test_lookup_parses_and_filters(hass, discogs_entry, aioclient_mock):
    aioclient_mock.get(
        "https://api.discogs.com/database/search",
        json={
            "results": [
                {"id": 10, "type": "master", "title": "Miles Davis - Kind of Blue",
                 "year": "1959", "format": ["Vinyl", "LP"], "label": ["Columbia"],
                 "genre": ["Jazz"], "catno": "CL 1355", "thumb": "https://i.example/t.jpg"},
                {"id": 11, "type": "release", "title": "CD Only", "format": ["CD"]},
                {"id": 12, "type": "artist", "title": "Someone"},
                {"id": 13, "type": "release", "title": "No Separator", "year": "n/a",
                 "format": ["LP"], "style": ["Bop"]},
            ]
        },
    )
    result = await _call(hass, "lookup_discogs", {"query": "kind of blue"})
    assert result["count"] == 2
    first, second = result["results"]
    assert (first["artist"], first["album"], first["year"]) == ("Miles Davis", "Kind of Blue", 1959)
    assert first["resource_type"] == "master"
    assert first["cover_url"] == "https://i.example/t.jpg"
    assert (second["artist"], second["album"], second["year"]) == ("", "No Separator", None)
    assert second["genre"] == "Bop"
    assert result["has_token"] is True


async def test_get_tracks_skips_headings(hass, discogs_entry, aioclient_mock):
    aioclient_mock.get(
        "https://api.discogs.com/releases/99",
        json={
            "tracklist": [
                {"type_": "heading", "title": "Side A"},
                {"type_": "track", "position": "A1", "title": "So What", "duration": "9:22"},
                {"position": "A2", "title": "Freddie Freeloader"},
            ]
        },
    )
    result = await _call(hass, "get_discogs_tracks", {"discogs_id": "99"})
    assert result["count"] == 2
    assert result["tracks"][0] == {"position": "A1", "title": "So What", "duration": "9:22"}


async def test_get_tracks_uses_master_url(hass, discogs_entry, aioclient_mock):
    aioclient_mock.get("https://api.discogs.com/masters/5", json={"tracklist": []})
    result = await _call(
        hass, "get_discogs_tracks", {"discogs_id": "5", "resource_type": "master"}
    )
    assert result["count"] == 0


async def test_lookup_api_error(hass, discogs_entry, aioclient_mock):
    aioclient_mock.get("https://api.discogs.com/database/search", status=429)
    with pytest.raises(HomeAssistantError, match="429"):
        await _call(hass, "lookup_discogs", {"query": "x"})
