"""SSI FastConnect WebSocket trades for live Radar."""
from datetime import datetime, time
from enum import Enum
import gzip
import json
import os

from .market_radar_tape import Match, integer
from .market_sources import VN

SYMBOLS = {"HDB": "HOSE", "SHS": "HNX", "BVB": "UPCOM"}
LIVE_BUCKET = "market-radar-live"
SSI_TAPE_SOURCE = "SSI WebSocket"


def closed_capture_key(day):
    return f"{LIVE_BUCKET}/closed/{day.weekday()}.json.gz"


def read_closed_capture(db, day):
    url = f"{db._settings.supabase_url}/storage/v1/object/{closed_capture_key(day)}"
    response = db._get(url)
    if response.status_code == 404:
        return {}
    response.raise_for_status()
    data = json.loads(gzip.decompress(response.content))
    return data["symbols"] if data["day"] == day.isoformat() else {}


def trade_record(message, day=None):
    stamp = str(message.trading_time).strip()
    try:
        at = datetime.fromisoformat(stamp.replace("/", "-"))
    except ValueError:
        if day is None:
            raise
        at = datetime.combine(day, time.fromisoformat(stamp))
    at = at.astimezone(VN) if at.tzinfo else at.replace(tzinfo=VN)
    quantity, price, cumulative = map(integer, (message.quantity, message.price, message.total_volume))
    if not price or not quantity or cumulative < quantity:
        raise ValueError("Invalid matched price or volume")
    side = message.side.value if isinstance(message.side, Enum) else message.side
    direction = {"B": "b", "BUY": "b", "S": "s", "SELL": "s"}.get(str(side).upper(), "unknown")
    return Match(at, price, quantity, cumulative, direction)


def ssi_config():
    from ssi_sdk import Config
    key = os.getenv("SSI_API_KEY")
    secret = os.getenv("SSI_API_SECRET")
    if not key or not secret:
        raise ValueError("SSI Market Data credentials are required")
    return Config(client_id=os.getenv("SSI_CLIENT_ID", ""), api_key=key, api_secret=secret)
