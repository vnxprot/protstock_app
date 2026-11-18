"""SSI FastConnect WebSocket trades for live Radar."""
from datetime import datetime
from enum import Enum
import os

from .market_radar_tape import Match, integer
from .market_sources import VN

SYMBOLS = {"HDB": "HOSE", "SHS": "HNX", "BVB": "UPCOM"}


def trade_record(message):
    at = datetime.strptime(message.trading_time, "%Y/%m/%d %H:%M:%S").replace(tzinfo=VN)
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
