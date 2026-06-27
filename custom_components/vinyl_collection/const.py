"""Constants for the Vinyl Collection integration."""

DOMAIN = "vinyl_collection"
STORAGE_KEY = "vinyl_collection_records"
STORAGE_VERSION = 1

CONF_NAME = "name"
CONF_DISCOGS_TOKEN = "discogs_token"
CONF_DISCOGS_ENABLED = "discogs_enabled"
CONF_SPOTIFY_ENABLED = "spotify_enabled"
DEFAULT_NAME = "Vinyl Collection"

# Service names
SERVICE_ADD_RECORD = "add_record"
SERVICE_REMOVE_RECORD = "remove_record"
SERVICE_UPDATE_RECORD = "update_record"
SERVICE_SEARCH = "search"
SERVICE_LOOKUP_DISCOGS = "lookup_discogs"
SERVICE_GET_CONFIG = "get_config"

# Record fields
ATTR_RECORD_ID = "record_id"
ATTR_ARTIST = "artist"
ATTR_ALBUM = "album"
ATTR_YEAR = "year"
ATTR_FORMAT = "format"
ATTR_CONDITION = "condition"
ATTR_GENRE = "genre"
ATTR_LABEL = "label"
ATTR_CATALOG_NUMBER = "catalog_number"
ATTR_NOTES = "notes"
ATTR_RATING = "rating"
ATTR_DISCOGS_ID = "discogs_id"
ATTR_COVER_URL = "cover_url"
ATTR_SPOTIFY_URI = "spotify_uri"
ATTR_DATE_ADDED = "date_added"
ATTR_IS_WISHLIST = "is_wishlist"
ATTR_QUERY = "query"

EVENT_RECORD_ADDED = f"{DOMAIN}_record_added"
EVENT_RECORD_REMOVED = f"{DOMAIN}_record_removed"
EVENT_RECORD_UPDATED = f"{DOMAIN}_record_updated"