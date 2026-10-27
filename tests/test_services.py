"""Tests for the Vinyl Collection services."""
import pytest
import voluptuous as vol
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.vinyl_collection import _valid_cover_url
from custom_components.vinyl_collection.const import DOMAIN


@pytest.fixture
async def entry(hass):
    entry = MockConfigEntry(domain=DOMAIN, data={"name": "Vinyl Collection"})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _call(hass, service, data):
    return await hass.services.async_call(
        DOMAIN, service, data, blocking=True, return_response=True
    )


async def test_add_then_search(hass, entry):
    await _call(hass, "add_record", {"artist": "Miles Davis", "album": "Kind of Blue"})
    result = await _call(hass, "search", {"query": "miles"})
    assert result["count"] == 1


async def test_search_exact_match_for_duplicate_check(hass, entry):
    await _call(hass, "add_record", {"artist": "Miles Davis", "album": "Kind of Blue"})
    result = await _call(hass, "search", {"query": "Miles Davis - Kind of Blue"})
    assert result["exact_match"]["album"] == "Kind of Blue"
    result = await _call(hass, "search", {"query": "Miles Davis - Bitches Brew"})
    assert result["exact_match"] is None


async def test_add_defaults(hass, entry):
    result = await _call(hass, "add_record", {"artist": "A", "album": "B"})
    record = result["record"]
    assert record["is_wishlist"] is False
    assert record["is_next_buy"] is False
    assert record["owned_by"] == []


async def test_add_fires_event(hass, entry):
    events = []
    hass.bus.async_listen("vinyl_collection_record_added", events.append)
    await _call(hass, "add_record", {"artist": "A", "album": "B"})
    await hass.async_block_till_done()
    assert len(events) == 1


async def test_update_moves_wishlist_to_collection_clears_next_buy(hass, entry):
    added = await _call(
        hass, "add_record",
        {"artist": "A", "album": "B", "is_wishlist": True, "is_next_buy": True},
    )
    rid = added["record"]["record_id"]
    updated = await _call(hass, "update_record", {"record_id": rid, "is_wishlist": False})
    assert updated["record"]["is_next_buy"] is False


async def test_update_unknown_record_errors(hass, entry):
    with pytest.raises(HomeAssistantError):
        await _call(hass, "update_record", {"record_id": "nope", "year": 2000})


async def test_remove_record(hass, entry):
    added = await _call(hass, "add_record", {"artist": "A", "album": "B"})
    rid = added["record"]["record_id"]
    assert (await _call(hass, "remove_record", {"record_id": rid}))["removed"] is True
    with pytest.raises(HomeAssistantError):
        await _call(hass, "remove_record", {"record_id": rid})


@pytest.mark.parametrize("rating", [0, 6])
async def test_rating_out_of_range_rejected(hass, entry, rating):
    with pytest.raises(vol.Invalid):
        await _call(hass, "add_record", {"artist": "A", "album": "B", "rating": rating})


async def test_get_config_without_discogs(hass, entry):
    result = await _call(hass, "get_config", {})
    assert result == {
        "has_discogs_token": False,
        "discogs_enabled": False,
        "spotify_enabled": False,
    }


async def test_discogs_services_blocked_when_disabled(hass, entry):
    for service, data in (
        ("lookup_discogs", {"query": "x"}),
        ("get_discogs_tracks", {"discogs_id": "1"}),
        ("import_discogs_collection", {}),
    ):
        with pytest.raises(HomeAssistantError, match="disabled"):
            await _call(hass, service, data)


@pytest.mark.parametrize("url", ["https://example.com/a.jpg", "http://example.com/a.jpg"])
def test_cover_url_accepts_http(url):
    assert _valid_cover_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        'https://example.com/a.jpg"onerror="x',
        "https://example.com/<script>",
        "https://example.com/it's.jpg",
        "javascript:alert(1)",
    ],
)
def test_cover_url_rejects_unsafe(url):
    with pytest.raises(vol.Invalid):
        _valid_cover_url(url)
