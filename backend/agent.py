"""Überwachungs-Agent: prüft periodisch alle Aktien mit These und meldet Änderungen.

Für jede These:
  - Thesis-Bedingungen neu auswerten (theses.evaluate) → welche kippen von „hält" auf „verletzt"?
  - Fundamentale Risiko-Ampel (wstock.fundamentals) → neue Risiko-Flags?
  - Nächster Earnings-Termin innerhalb 7 Tagen?

Gemeldet wird NUR, was sich seit dem letzten Lauf geändert hat (Zustand in .cache/agent_state.json).
Jede Meldung geht per Telegram raus (falls konfiguriert) UND ins Research-Journal der These.

Compliance: nur objektive Schwellen-/Zustandsänderungen, keine Empfehlung.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, date

import theses
import wstock
import notify

HERE = os.path.dirname(os.path.abspath(__file__))
_STATE = os.path.join(HERE, ".cache", "agent_state.json")


def _load_state() -> dict:
    try:
        with open(_STATE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_state(d: dict) -> None:
    os.makedirs(os.path.dirname(_STATE), exist_ok=True)
    tmp = _STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _STATE)


def _days_to(dstr: str | None):
    if not dstr:
        return None
    try:
        return (datetime.strptime(dstr, "%Y-%m-%d").date() - date.today()).days
    except ValueError:
        return None


def _check_symbol(sym: str, prev: dict) -> tuple[list[str], dict]:
    """Gibt (Meldezeilen, neuer Zustand) für ein Symbol zurück."""
    lines: list[str] = []

    ev = theses.evaluate(sym)
    # Verletzte Bedingungen (Text je Check)
    now_violated = [f"{c['label']} {c['op']} {c['value']} (aktuell {c['actual']})"
                    for c in ev.get("checks", []) if c.get("ok") is False]
    prev_violated = set(prev.get("violated", []))
    for v in now_violated:
        if v not in prev_violated:
            lines.append(f"⚠️ These-Annahme verletzt: {v}")

    # Fundamentale Risiko-Flags
    fund = wstock.fundamentals(sym)
    now_flags = [f["text"] for f in fund.get("risk", {}).get("flags", [])] if fund.get("available") else []
    prev_flags = set(prev.get("flags", []))
    for f in now_flags:
        if f not in prev_flags:
            lines.append(f"🚩 Neues Risiko: {f}")

    # Earnings in <= 7 Tagen (einmal melden)
    nxt = fund.get("next_earnings") if fund.get("available") else None
    d = _days_to(nxt)
    if d is not None and 0 <= d <= 7 and prev.get("earnings_alerted") != nxt:
        lines.append(f"📅 Earnings in {d} Tag(en) am {nxt}")
        earnings_alerted = nxt
    else:
        earnings_alerted = prev.get("earnings_alerted") if (d is None or d > 7 or d < 0) else nxt

    state = {"violated": now_violated, "flags": now_flags, "earnings_alerted": earnings_alerted}
    return lines, state


def run_once() -> dict:
    """Ein Überwachungslauf über alle Thesen. Gibt eine Zusammenfassung zurück."""
    book = theses._load()  # {symbol: thesis}
    state = _load_state()
    all_alerts: dict[str, list[str]] = {}

    for sym in list(book.keys()):
        prev = state.get(sym, {})
        try:
            lines, new_state = _check_symbol(sym, prev)
        except Exception as e:  # noqa: BLE001 — ein Symbol darf den Lauf nicht kippen
            lines, new_state = [], prev
            new_state["error"] = str(e)[:120]
        state[sym] = new_state
        if lines:
            all_alerts[sym] = lines
            for ln in lines:
                theses.add_journal(sym, "Agent", ln)

    _save_state(state)

    sent = False
    if all_alerts:
        parts = [f"<b>Vibe-Research · {len(all_alerts)} Aktie(n) mit Neuigkeiten</b>"]
        for sym, lines in all_alerts.items():
            name = (book.get(sym, {}) or {}).get("symbol", sym)
            parts.append(f"\n<b>{name}</b>")
            parts.extend(lines)
        sent = notify.send("\n".join(parts))

    return {
        "checked": len(book),
        "with_alerts": len(all_alerts),
        "alerts": all_alerts,
        "telegram_configured": notify.configured(),
        "telegram_sent": sent,
    }
