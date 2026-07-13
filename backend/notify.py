"""Telegram-Benachrichtigung — schlank, ohne Extra-Abhängigkeit (nur requests).

Konfiguration über .env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID. Ohne beides ist der Versand
inaktiv (configured() = False), der Agent läuft trotzdem und schreibt ins Journal.
"""

from __future__ import annotations

import os

import requests

_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
_CHAT = os.environ.get("TELEGRAM_CHAT_ID", "").strip()


def configured() -> bool:
    return bool(_TOKEN and _CHAT)


def send(text: str) -> bool:
    """Nachricht an den konfigurierten Chat. False, wenn nicht konfiguriert / Fehler."""
    if not configured():
        return False
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{_TOKEN}/sendMessage",
            json={"chat_id": _CHAT, "text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": True},
            timeout=12,
        )
        return r.status_code == 200
    except Exception:
        return False
