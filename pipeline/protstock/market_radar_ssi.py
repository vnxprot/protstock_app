"""Read-only SSI FastConnect probe for Radar trading data and session totals."""
from argparse import ArgumentParser
from collections import Counter
from datetime import date, datetime
from enum import Enum
import json
import os
from threading import Lock

from .market_radar_tape import Match, classify, integer, tape_integrity
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


def sample_totals(session, trades, counters):
    results = []
    for symbol, exchange in SYMBOLS.items():
        tape = sorted(trades[symbol].values(), key=lambda match: (match.stamp, match.cumulative))
        volume, starts_at_open = tape_integrity(tape, exchange)
        groups = {category: values for method, category, _, values in classify(tape, exchange) if method == "continuous"}
        results.append({"symbol": symbol, "exchange": exchange, "session": session.isoformat(),
                        "matches": len(tape), "invalid_or_conflicting_ticks": counters[symbol],
                        "captured_volume": volume, "last_cumulative": tape[-1].cumulative if tape else None,
                        "unbroken_from_first_trade": bool(tape) and starts_at_open and not counters[symbol],
                        "groups_in_sample": groups})
    return results


def probe(reference_day, stream_seconds):
    from ssi_sdk import Auth, Config, Data, Stream
    from ssi_sdk.models.streaming import TradeMessage

    key = os.getenv("SSI_API_KEY")
    secret = os.getenv("SSI_API_SECRET")
    if not key or not secret:
        raise ValueError("SSI Market Data credentials are required")
    config = Config(client_id=os.getenv("SSI_CLIENT_ID", ""), api_key=key, api_secret=secret)
    with Auth(config) as auth:
        auth.authenticate()
        data = Data(auth)
        formatted = reference_day.strftime("%Y/%m/%d")
        for symbol, exchange in SYMBOLS.items():
            records = data.market_data.get_securities_summary_historical(symbol, formatted, formatted)
            matching = [row for row in records if row.symbol == symbol and row.trading_date[:10].replace("/", "-") == reference_day.isoformat()]
            if len(matching) != 1:
                print(json.dumps({"source": "SSI EOD", "symbol": symbol, "date": str(reference_day), "status": "missing"}))
                continue
            row = matching[0]
            print(json.dumps({"source": "SSI EOD", "symbol": symbol, "exchange": exchange, "date": str(reference_day),
                              "matched_volume": row.total_match, "matched_value": row.total_match_value,
                              "foreign_buy_volume": row.total_foreign_buy, "foreign_sell_volume": row.total_foreign_sell,
                              "foreign_buy_value": row.total_foreign_buy_value, "foreign_sell_value": row.total_foreign_sell_value}))
        if not stream_seconds:
            return
        session = datetime.now(VN).date()
        trades = {symbol: {} for symbol in SYMBOLS}
        counters = Counter()
        lock = Lock()

        def on_data(message):
            if not isinstance(message, TradeMessage) or message.symbol not in trades:
                return
            symbol = message.symbol
            with lock:
                try:
                    match = trade_record(message)
                except ValueError:
                    counters[symbol] += 1
                    return
                if match.stamp.date() != session:
                    return
                prior = trades[symbol].setdefault(match.cumulative, match)
                if prior != match:
                    counters[symbol] += 1

        with Stream(auth) as stream:
            stream.streaming.on_data = on_data
            stream.streaming.connect()
            stream.streaming.subscribe_symbol_trade(list(SYMBOLS))
            stream.streaming.wait(timeout_ms=stream_seconds * 1000)
        with lock:
            for sample in sample_totals(session, trades, counters):
                print(json.dumps(sample))


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--reference-date", type=date.fromisoformat, required=True)
    parser.add_argument("--stream-seconds", type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.stream_seconds <= 24_000:
        parser.error("Expected a sample duration between 0 and 24000 seconds")
    try:
        probe(args.reference_date, args.stream_seconds)
    except Exception as error:
        # SDK failures may include request metadata. Keep credentials and tokens out of logs.
        raise SystemExit(f"SSI probe failed: {type(error).__name__}") from None


if __name__ == "__main__":
    main()
