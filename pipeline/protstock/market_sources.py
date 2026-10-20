"""Public VCI/KBS contracts shared by day, minute, directory and event collectors."""
from datetime import date, datetime, time, timedelta, timezone
from math import isfinite
import re

from .market_http import SourceUnavailable, request_json

VN = timezone(timedelta(hours=7))
VCI_BASE = "https://trading.vietcap.com.vn/api"
VCI_CHART = VCI_BASE + "/chart/OHLCChart/gap-chart"
VCI_EVENTS = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/events"
KBS_BASE = "https://kbbuddywts.kbsec.com.vn/iis-server/investment"


def local_timestamp(value) -> datetime:
    stamp = float(value)
    if stamp > 1e12:
        stamp /= 1000
    return datetime.fromtimestamp(stamp, VN)


def vci_candles(symbol: str, start: date, end: date, *, minute: bool = False) -> list[dict]:
    """Page backwards within short windows; never silently accept a server cap."""
    if start > end:
        raise ValueError("start must be on or before end")
    symbol = symbol.upper()
    if not re.fullmatch(r"[A-Z0-9]{2,20}", symbol):
        raise ValueError("Invalid market symbol")
    output = {}
    first = start
    while first <= end:
        last = min(end, first + timedelta(days=1 if minute else 364))
        lower = int(datetime.combine(first, time.min, VN).timestamp())
        cursor = int(datetime.combine(last + timedelta(days=1), time.min, VN).timestamp())
        count = 1000 if minute else min(1000, (last - first).days + 5)
        for page in range(200):
            payload = request_json("POST", VCI_CHART, json={"timeFrame": "ONE_MINUTE" if minute else "ONE_DAY",
                "symbols": [symbol], "to": cursor, "countBack": count})
            blocks = payload.get("data") if isinstance(payload, dict) else payload
            if not isinstance(blocks, list):
                raise SourceUnavailable(f"VCI chart contract changed: {symbol}")
            if not blocks:
                break
            matches = [item for item in blocks if isinstance(item, dict) and str(item.get("symbol", "")).upper() == symbol]
            if len(matches) != 1:
                raise SourceUnavailable(f"VCI chart returned the wrong symbol: {symbol}")
            block = matches[0]
            fields = ("t", "o", "h", "l", "c", "v")
            if any(not isinstance(block.get(key), list) for key in fields) or len({len(block[key]) for key in fields}) != 1:
                raise SourceUnavailable(f"VCI chart arrays are inconsistent: {symbol}")
            if not block["t"]:
                break
            stamps = []
            for index in range(len(block["t"])):
                stamp = local_timestamp(block["t"][index])
                seconds = int(stamp.timestamp())
                stamps.append(seconds)
                values = {key: float(block[key][index]) for key in fields[1:]}
                if not all(isfinite(value) for value in values.values()):
                    raise SourceUnavailable(f"VCI chart non-finite values: {symbol}")
                if first <= stamp.date() <= last:
                    key = stamp.isoformat() if minute else stamp.date().isoformat()
                    row = {"t": stamp.isoformat(), **values}
                    if key in output and output[key] != row:
                        raise SourceUnavailable(f"VCI conflicting candle: {symbol} {key}")
                    output[key] = row
            earliest = min(stamps)
            if earliest <= lower:
                break
            if earliest >= cursor:
                raise SourceUnavailable(f"VCI pagination did not advance: {symbol}")
            cursor = earliest - 1
        else:
            raise SourceUnavailable(f"VCI pagination budget exceeded: {symbol}")
        first = last + timedelta(days=1)
    return [output[key] for key in sorted(output)]


def directory(source: str = "VCI") -> list[dict]:
    url = VCI_BASE + "/price/symbols/getAll" if source == "VCI" else KBS_BASE + "/stock/search/data"
    payload = request_json("GET", url)
    records = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(records, list) or not records:
        raise SourceUnavailable(f"{source} directory is empty or malformed")
    result = []
    for row in records:
        exchange = str(row.get("board") or row.get("exchange") or "").upper()
        if exchange == "HSX":
            exchange = "HOSE"
        if str(row.get("type", "STOCK")).upper() == "STOCK" and exchange in {"HOSE", "HNX", "UPCOM"}:
            result.append({"symbol": str(row["symbol"]).upper(), "exchange": exchange,
                           "company_name": row.get("organName") or row.get("name"), "source": source})
    if not result or len({row["symbol"] for row in result}) != len(result):
        raise SourceUnavailable(f"{source} directory has no stocks or duplicate symbols")
    return result


def vci_events(symbol: str, start: date, end: date) -> list[dict]:
    result, seen = [], set()
    for page in range(100):
        payload = request_json("GET", VCI_EVENTS, params={"ticker": symbol,
            "fromDate": start.strftime("%Y%m%d"), "toDate": end.strftime("%Y%m%d"),
            "eventCode": "DIV,ISS", "page": page, "size": 100})
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict) or not isinstance(data.get("content"), list):
            raise SourceUnavailable(f"VCI event contract changed: {symbol}")
        for item in data["content"]:
            identity = item.get("id")
            if not identity or identity in seen:
                raise SourceUnavailable(f"VCI event pagination did not advance: {symbol}")
            seen.add(identity)
            row = {re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower(): value for key, value in item.items()}
            for key, value in list(row.items()):
                if "date" in key and isinstance(value, (int, float)):
                    row[key] = local_timestamp(value).date().isoformat()
            result.append(row)
        if data.get("last") is True or len(data["content"]) < 100:
            return result
    raise SourceUnavailable(f"VCI event pagination budget exceeded: {symbol}")
