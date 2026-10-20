"""Operational notification is independent of optional signal alerts."""
import json
import os
from pathlib import Path

import httpx


def message(results: dict, day: str, link: str) -> str:
    stages = ", ".join(f"{name}={value['result']}" for name, value in results.items())
    source_ready = results.get("ingest", {}).get("outputs", {}).get("source_ready")
    if results.get("ingest", {}).get("result") == "failure" and source_ready != "success":
        detail = "Lỗi kiểm tra nguồn công khai VCI/KBS; hai lô chưa tải dữ liệu. Xem bước Check direct public sources and their KBS fallback."
    elif all(results.get(name, {}).get("result") == "success" for name in ("preflight", "check-universe", "ingest", "finalize")):
        detail = "Hai lô và bước xuất bản đã hoàn tất."
    else:
        detail = "EOD chưa hoàn tất; xem bước lỗi trong workflow. Dữ liệu thiếu chưa được xác nhận đã khắc phục."
    return f"Prot Stock · EOD {day}\n{detail}\n{stages}\n{link}"


def main():
    link = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    text = message(json.loads(os.environ["EOD_RESULTS"]), os.getenv("TRADING_DATE") or "chưa xác định", link)
    print(text, flush=True)
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as output:
        output.write(text + "\n")
    token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if token and chat:
        response = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat, "text": text}, timeout=30)
        # Do not include a credential-bearing Telegram URL in exception output.
        if response.status_code != 200 or not response.json().get("ok"):
            raise RuntimeError(f"Telegram EOD report failed (HTTP {response.status_code})")


if __name__ == "__main__":
    main()
