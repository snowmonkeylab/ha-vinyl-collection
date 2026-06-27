"""Config flow for Vinyl Collection."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.selector import BooleanSelector

from .const import CONF_DISCOGS_ENABLED, CONF_DISCOGS_TOKEN, CONF_NAME, CONF_SPOTIFY_ENABLED, DEFAULT_NAME, DOMAIN


class VinylCollectionConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Vinyl Collection."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial setup step."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(
                title=user_input[CONF_NAME], data=user_input
            )

        data_schema = vol.Schema(
            {
                vol.Required(CONF_NAME, default=DEFAULT_NAME): str,
                vol.Optional(CONF_DISCOGS_TOKEN, default=""): str,
                vol.Optional(CONF_DISCOGS_ENABLED, default=False): BooleanSelector(),
                vol.Optional(CONF_SPOTIFY_ENABLED, default=False): BooleanSelector(),
            }
        )
        return self.async_show_form(
            step_id="user",
            data_schema=data_schema,
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        return VinylCollectionOptionsFlow()


class VinylCollectionOptionsFlow(config_entries.OptionsFlow):
    """Options flow for updating the Discogs token."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current_token = (
            self.config_entry.options.get(CONF_DISCOGS_TOKEN)
            or self.config_entry.data.get(CONF_DISCOGS_TOKEN, "")
        )
        current_discogs_enabled = self.config_entry.options.get(
            CONF_DISCOGS_ENABLED,
            self.config_entry.data.get(CONF_DISCOGS_ENABLED, False),
        )
        current_spotify_enabled = self.config_entry.options.get(
            CONF_SPOTIFY_ENABLED,
            self.config_entry.data.get(CONF_SPOTIFY_ENABLED, False),
        )

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_DISCOGS_TOKEN, default=current_token): str,
                    vol.Optional(CONF_DISCOGS_ENABLED, default=current_discogs_enabled): BooleanSelector(),
                    vol.Optional(CONF_SPOTIFY_ENABLED, default=current_spotify_enabled): BooleanSelector(),
                }
            ),
        )