"""Config flow for Vinyl Collection."""
from __future__ import annotations

from typing import Any

import aiohttp
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import BooleanSelector

from .const import (
    CONF_DISCOGS_ENABLED,
    CONF_DISCOGS_TOKEN,
    CONF_NAME,
    CONF_SPOTIFY_ENABLED,
    DEFAULT_NAME,
    DISCOGS_IDENTITY_URL,
    DISCOGS_USER_AGENT,
    DOMAIN,
)

INTEGRATION_INFO = {
    "spotify": ("Spotify", "Lets the card search Spotify and link tracks to your records."),
    "music_assistant": ("Music Assistant", "Plays a linked record on your speakers."),
}


def _integration_status(hass: HomeAssistant, domain: str) -> str:
    """Build a status line reporting whether a given HA integration is set up, and why it matters."""
    label, why = INTEGRATION_INFO[domain]
    if hass.config_entries.async_entries(domain):
        return f"{label}: ✅ set up. {why}"
    return (
        f"{label}: ⚠️ not set up yet. {why} "
        f"[➜ Add {label}](/config/integrations/dashboard/add?domain={domain})"
    )


async def _async_validate_discogs_token(
    hass: HomeAssistant, token: str
) -> tuple[str | None, str | None]:
    """Check a Discogs token against the API.

    Returns (error_code_or_None, discogs_username_or_None).
    """
    session = async_get_clientsession(hass)
    headers = {"User-Agent": DISCOGS_USER_AGENT, "Authorization": f"Discogs token={token}"}
    try:
        async with session.get(
            DISCOGS_IDENTITY_URL,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status == 200:
                body = await resp.json()
                return None, body.get("username")
            if resp.status == 401:
                return "invalid_auth", None
            return "cannot_connect", None
    except (aiohttp.ClientError, TimeoutError):
        return "cannot_connect", None


class _VinylCollectionStepsMixin:
    """Shared wizard steps for both initial setup and Configure."""

    hass: HomeAssistant
    _data: dict[str, Any]
    _discogs_username: str | None

    def _finish(self) -> FlowResult:
        raise NotImplementedError

    async def async_step_name(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Step 1 of 3 - collect the collection name."""
        if user_input is not None:
            self._data[CONF_NAME] = user_input[CONF_NAME]
            return await self.async_step_discogs()

        data_schema = vol.Schema(
            {vol.Required(CONF_NAME, default=self._data[CONF_NAME]): str}
        )
        return self.async_show_form(step_id="name", data_schema=data_schema)

    async def async_step_discogs(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Step 2 of 3 - enable Discogs and (optionally) validate a token.

        Toggle and token field are both always on this one screen/step_id -
        HA forms can't reactively hide/show fields client-side, so rather
        than swap fields in and out between renders (which reads as the
        screen changing), both fields are simply always present together.
        A successful validation re-renders this same screen with a
        confirmation message; submitting again with the same token moves on.
        """
        errors: dict[str, str] = {}
        enabled = self._data[CONF_DISCOGS_ENABLED]
        token = self._data.get(CONF_DISCOGS_TOKEN, "")
        confirmed = False

        if user_input is not None:
            enabled = user_input[CONF_DISCOGS_ENABLED]
            token = user_input.get(CONF_DISCOGS_TOKEN, "").strip()
            self._data[CONF_DISCOGS_ENABLED] = enabled

            if not enabled:
                self._data[CONF_DISCOGS_TOKEN] = ""
                self._discogs_username = None
                return await self.async_step_spotify()

            if not token:
                errors[CONF_DISCOGS_TOKEN] = "token_required"
            elif token == self._data.get(CONF_DISCOGS_TOKEN) and self._discogs_username:
                # Already validated this exact token - user is clicking past
                # the confirmation message to continue.
                return await self.async_step_spotify()
            else:
                error, username = await _async_validate_discogs_token(self.hass, token)
                if error == "invalid_auth":
                    errors[CONF_DISCOGS_TOKEN] = error
                elif error:
                    errors["base"] = error
                else:
                    self._data[CONF_DISCOGS_TOKEN] = token
                    self._discogs_username = username
                    confirmed = True

        schema = vol.Schema(
            {
                vol.Optional(CONF_DISCOGS_ENABLED, default=enabled): BooleanSelector(),
                vol.Optional(CONF_DISCOGS_TOKEN, default=token): str,
            }
        )
        status = (
            f"✅ Connected as {self._discogs_username} — press Submit to continue."
            if confirmed
            else ""
        )
        return self.async_show_form(
            step_id="discogs",
            data_schema=schema,
            errors=errors,
            description_placeholders={"status": status},
        )

    async def async_step_spotify(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Step 3 of 3 - enable Spotify.

        A single static screen: the toggle is the only field, so it's the
        first thing on the screen. The live Spotify/Music Assistant status
        (with clickable add-integration links) sits underneath it as that
        field's own helper text, via description_placeholders substituted
        into data_description - same mechanism core integrations like
        tailwind/mqtt use for linked helper text.
        """
        if user_input is not None:
            self._data[CONF_SPOTIFY_ENABLED] = user_input[CONF_SPOTIFY_ENABLED]
            return self._finish()

        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_SPOTIFY_ENABLED, default=self._data[CONF_SPOTIFY_ENABLED]
                ): BooleanSelector(),
            }
        )
        return self.async_show_form(
            step_id="spotify",
            data_schema=schema,
            description_placeholders={
                "spotify_status": _integration_status(self.hass, "spotify"),
                "music_assistant_status": _integration_status(self.hass, "music_assistant"),
            },
        )


class VinylCollectionConfigFlow(
    _VinylCollectionStepsMixin, config_entries.ConfigFlow, domain=DOMAIN
):
    """Handle a config flow for Vinyl Collection."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        self._data = {
            CONF_NAME: DEFAULT_NAME,
            CONF_DISCOGS_ENABLED: False,
            CONF_DISCOGS_TOKEN: "",
            CONF_SPOTIFY_ENABLED: False,
        }
        self._discogs_username = None
        return await self.async_step_name()

    def _finish(self) -> FlowResult:
        return self.async_create_entry(title=self._data[CONF_NAME], data=self._data)

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        return VinylCollectionOptionsFlow()


class VinylCollectionOptionsFlow(_VinylCollectionStepsMixin, config_entries.OptionsFlow):
    """Options flow for Vinyl Collection - reuses the setup wizard steps."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        entry = self.config_entry
        self._data = {
            CONF_NAME: entry.title,
            CONF_DISCOGS_ENABLED: entry.options.get(
                CONF_DISCOGS_ENABLED, entry.data.get(CONF_DISCOGS_ENABLED, False)
            ),
            CONF_DISCOGS_TOKEN: entry.options.get(CONF_DISCOGS_TOKEN)
            or entry.data.get(CONF_DISCOGS_TOKEN, ""),
            CONF_SPOTIFY_ENABLED: entry.options.get(
                CONF_SPOTIFY_ENABLED, entry.data.get(CONF_SPOTIFY_ENABLED, False)
            ),
        }
        self._discogs_username = None
        return await self.async_step_name()

    def _finish(self) -> FlowResult:
        self.hass.config_entries.async_update_entry(
            self.config_entry, title=self._data[CONF_NAME]
        )
        return self.async_create_entry(
            title="",
            data={k: v for k, v in self._data.items() if k != CONF_NAME},
        )
