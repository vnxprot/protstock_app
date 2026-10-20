"""Approve vnstock releases using real VCI data, then pin one release per EOD run."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from protstock.vnstock_auth import authenticate, require_ci_key

BASELINE = "5.1.0"
INDEX = "https://vnstocks.com/api/packages"
BUCKET = "database-archives"
APPROVED = "runtime/vnstock-approved.json"
HEALTH = "runtime/vnstock-health.json"


def storage(method: str, key: str, payload: dict | None = None) -> dict | None:
    url, secret = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not secret:
        return None
    headers = {"apikey": secret, "Authorization": f"Bearer {secret}"}
    with httpx.Client(timeout=60, headers=headers) as client:
        if method == "POST":
            bucket = client.get(f"{url}/storage/v1/bucket/{BUCKET}")
            if bucket.status_code == 404:
                created = client.post(f"{url}/storage/v1/bucket", json={"id": BUCKET, "name": BUCKET, "public": False})
                created.raise_for_status()
            else:
                bucket.raise_for_status()
                if bucket.json().get("public") is not False:
                    raise RuntimeError("Runtime release manifest requires a private bucket")
        route = "object/authenticated" if method == "GET" else "object"
        response = client.request(method, f"{url}/storage/v1/{route}/{BUCKET}/{key}",
                                  json=payload, headers={"x-upsert": "true"} if method == "POST" else {})
        if method == "GET" and response.status_code in {400, 404}:
            error = response.json()
            if response.status_code == 404 or str(error.get("statusCode")) == "404" or error.get("error") in {"not_found", "NoSuchKey"}:
                return None
        response.raise_for_status()
        return response.json() if method == "GET" else payload


def version(value: str) -> str:
    if not re.fullmatch(r"5\.\d+\.\d+", value):
        raise ValueError(f"Only stable generation 5 releases are eligible: {value}")
    return value


def install(release: str, target: str | None = None) -> None:
    command = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
               "--extra-index-url", INDEX, "--only-binary", "vnstock", f"vnstock=={version(release)}"]
    if target:
        command += ["--no-deps", "--target", target]
    subprocess.run(command, check=True, stdout=sys.stderr)


def fixtures() -> dict:
    end = (datetime.now(timezone(timedelta(hours=7))).date() - timedelta(days=1)).isoformat()
    result = {"end": end, "stocks": {}}
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return result
    with httpx.Client(base_url=url + "/rest/v1", headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30) as db:
        symbols = db.get("/symbols", params={"select": "id,symbol", "symbol": "in.(BIC,FPT,PC1)"})
        symbols.raise_for_status()
        for item in symbols.json():
            rows = db.get("/daily_prices", params={"select": "trading_date,open,high,low,close",
                "symbol_id": f"eq.{item['id']}", "source": "like.VCI%", "trading_date": f"lte.{end}",
                "quality_status": "eq.VALID", "order": "trading_date.desc", "limit": "5"})
            rows.raise_for_status()
            result["stocks"][item["symbol"]] = rows.json()
    return result


def probe(target: str, fixture_path: str) -> None:
    sys.path.insert(0, target)
    authenticate()
    import vnstock
    from vnstock import Market, __version__
    from math import isclose, isfinite
    from datetime import date
    reference = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    end = date.fromisoformat(reference["end"])
    # This is a contract/data check only: no strategy evaluation or backtest.
    samples = []
    for kind, symbol in (("index", "VNINDEX"), ("equity", "FPT"), ("equity", "BIC")):
        stored = reference["stocks"].get(symbol, [])
        start = min([end - timedelta(days=14)] + [date.fromisoformat(row["trading_date"]) for row in stored])
        frame = getattr(Market(), kind)(symbol).ohlcv(start=start.isoformat(), end=end.isoformat(), source="vci", floating=None)
        if frame.attrs.get("source") != "vci" or frame.empty:
            raise RuntimeError(f"{symbol}: empty data or wrong vendor")
        bars = {}
        for row in frame.to_dict(orient="records"):
            day = str(row["time"])[:10]
            prices = [float(row[field]) for field in ("open", "high", "low", "close")]
            if day in bars or not start.isoformat() <= day <= end.isoformat() or not all(isfinite(p) and p > 0 for p in prices):
                raise RuntimeError(f"{symbol}: invalid OHLCV contract")
            if float(row["high"]) < max(prices) or float(row["low"]) > min(prices) or float(row["volume"]) < 0:
                raise RuntimeError(f"{symbol}: invalid bar")
            bars[day] = row
        if (end - date.fromisoformat(max(bars))).days > 7:
            raise RuntimeError(f"{symbol}: stale sample")
        for old in stored:
            current = bars.get(old["trading_date"])
            if current is None or any(not isclose(float(old[field]), float(current[field]), rel_tol=.001, abs_tol=.01)
                                      for field in ("open", "high", "low", "close")):
                raise RuntimeError(f"{symbol}: VCI price basis changed on {old['trading_date']}; release needs review")
        samples.append({"symbol": symbol, "latest": max(bars), "bars": len(bars), "compared": len(stored)})
    release = (vnstock.status().get("release") or {})
    print(json.dumps({"version": __version__, "source": "vci", "samples": samples,
        "release": {key: release.get(key) for key in ("expires_on", "days_left")}}, default=str))


def validate(release: str, reference: dict) -> dict:
    with TemporaryDirectory(prefix="vnstock-contract-") as directory:
        install(release, directory)
        fixture_path = Path(directory) / "fixtures.json"
        fixture_path.write_text(json.dumps(reference), encoding="utf-8")
        result = subprocess.run([sys.executable, __file__, "probe", "--target", directory, "--fixtures", str(fixture_path)],
                                capture_output=True, text=True, timeout=240)
        if result.returncode:
            raise RuntimeError(f"vnstock {release} contract failed: {result.stderr[-700:]}")
        checked = json.loads(result.stdout.strip().splitlines()[-1])
        if checked["version"] != release:
            raise RuntimeError("Installed release does not match the requested version")
        return checked


def discover() -> str:
    result = subprocess.run([sys.executable, "-m", "pip", "index", "versions", "vnstock", "--extra-index-url", INDEX],
                            check=True, capture_output=True, text=True, timeout=90)
    releases = re.findall(r"\b5\.\d+\.\d+\b", result.stdout)
    if not releases:
        raise RuntimeError("Official package index returned no stable generation 5 release")
    return max(set(releases), key=lambda item: tuple(map(int, item.split("."))))


def notify_change(state: dict) -> None:
    previous = storage("GET", HEALTH)
    storage("POST", HEALTH, state)
    if previous == state:
        return
    token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if token and chat:
        response = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat,
            "text": "Prot Stock · vnstock source health\n" + json.dumps(state, ensure_ascii=False)}, timeout=30)
        response.raise_for_status()


def approve(reference: dict) -> dict:
    candidate = discover()
    checked = validate(candidate, reference)
    old = storage("GET", APPROVED) or {}
    approved = {"active": candidate, "standby": [item for item in [old.get("active"), *old.get("standby", [])]
                                               if item and item != candidate][:2],
                "source": "vci", "contract": "vendor-ohlcv-v1", "probe": checked}
    storage("POST", APPROVED, approved)
    return approved


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["select", "install", "health", "probe"])
    parser.add_argument("--version")
    parser.add_argument("--target", default="")
    parser.add_argument("--fixtures", default="")
    args = parser.parse_args()
    if args.mode == "probe":
        probe(args.target, args.fixtures)
        return
    if args.mode == "install":
        install(args.version)
        return
    require_ci_key()
    reference = fixtures()
    if args.mode == "health":
        try:
            approved = approve(reference)
            expiry = approved["probe"].get("release") or {}
            notify_change({"status": "EXPIRING" if expiry.get("days_left") is not None and expiry["days_left"] < 30 else "HEALTHY",
                           "active": approved["active"], "expires_on": expiry.get("expires_on")})
        except Exception as exc:
            notify_change({"status": "FAILED", "error": str(exc)[:300]})
            raise
        return
    approved = storage("GET", APPROVED) or {"active": BASELINE, "standby": []}
    chosen = None
    for release in dict.fromkeys([approved["active"], *approved.get("standby", []), BASELINE]):
        try:
            validate(version(release), reference)
            chosen = release
            break
        except Exception as exc:
            if "VNSTOCK_AUTH_FAILED" in str(exc):
                raise
            print(f"::warning::Approved vnstock {release} is unavailable: {exc}")
    if chosen is None:
        try:
            approved = approve(reference)
            chosen = approved["active"]
            notify_change({"status": "RECOVERED", "active": chosen})
        except Exception as exc:
            notify_change({"status": "FAILED", "error": str(exc)[:300]})
            raise
    install(chosen)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"version={chosen}\n")
    print(f"Pinned vnstock {chosen} with VCI contract verified for this EOD run")


if __name__ == "__main__":
    main()
