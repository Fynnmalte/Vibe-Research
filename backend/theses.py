"""Thesis-Tracking + Research-Journal je Aktie — der Kern, den Broker nicht bieten.

Der Nutzer hält zu einer Aktie eine These fest (Freitext) plus überprüfbare Bedingungen
(z.B. „KGV < 25", „52W-Position < 60"). Das Backend wertet die Bedingungen DETERMINISTISCH
gegen Live-Daten aus (wstock) — hält / verletzt, ohne KI, ohne Halluzination. Zusätzlich ein
datiertes Journal je Aktie (KI-Briefings, Auto-Checks, eigene Notizen).

Speicherung: lokal in .cache/theses.json (privat, gitignored, wie portfolio.py). Kein Upload.
Compliance: nur objektive Auswertung der vom Nutzer selbst gesetzten Bedingungen, keine Empfehlung.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone, timedelta

import wstock

HERE = os.path.dirname(os.path.abspath(__file__))
_FILE = os.path.join(HERE, ".cache", "theses.json")
_LOCK = threading.Lock()

# Auswertbare Kennzahlen → Zugriff auf das wstock.stock()-Dict.
# week52_pos = Position in der 52-Wochen-Spanne in Prozent (0 = Tief, 100 = Hoch).
_METRICS = {
    "price": "Kurs",
    "change_pct": "Tagesveränderung %",
    "pe": "KGV (TTM)",
    "forward_pe": "Forward-KGV",
    "eps": "EPS",
    "mcap": "Marktkapitalisierung",
    "week52_pos": "52W-Position %",
}
_OPS = {"<", "<=", ">", ">=", "==", "!="}


def _now() -> str:
    return datetime.now(timezone(timedelta(hours=2))).strftime("%Y-%m-%d %H:%M")


def _load() -> dict:
    try:
        with open(_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save(d: dict) -> None:
    os.makedirs(os.path.dirname(_FILE), exist_ok=True)
    tmp = _FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _FILE)


def _week52_pos(data: dict):
    lo, hi, p = data.get("week52_low"), data.get("week52_high"), data.get("price")
    if lo is None or hi is None or p is None or hi <= lo:
        return None
    return round((p - lo) / (hi - lo) * 100, 1)


def _metric_value(data: dict, metric: str):
    if metric == "week52_pos":
        return _week52_pos(data)
    return data.get(metric)


def _cmp(actual, op: str, target: float) -> bool:
    if op == "<":
        return actual < target
    if op == "<=":
        return actual <= target
    if op == ">":
        return actual > target
    if op == ">=":
        return actual >= target
    if op == "==":
        return actual == target
    if op == "!=":
        return actual != target
    return False


def _clean_conditions(raw: list) -> list[dict]:
    """Nur valide Bedingungen behalten: bekannte Kennzahl, erlaubter Operator, numerischer Wert."""
    out = []
    for c in raw or []:
        metric = str(c.get("metric", ""))
        op = str(c.get("op", ""))
        if metric not in _METRICS or op not in _OPS:
            continue
        try:
            value = float(c.get("value"))
        except (TypeError, ValueError):
            continue
        out.append({"metric": metric, "op": op, "value": value})
    return out


def get_thesis(symbol: str) -> dict | None:
    return _load().get(symbol.strip().upper())


def save_thesis(symbol: str, text: str, conditions: list) -> dict:
    sym = symbol.strip().upper()
    with _LOCK:
        d = _load()
        existing = d.get(sym, {})
        d[sym] = {
            "symbol": sym,
            "text": text.strip(),
            "conditions": _clean_conditions(conditions),
            "created": existing.get("created", _now()),
            "updated": _now(),
            "journal": existing.get("journal", []),
        }
        _save(d)
    return d[sym]


def delete_thesis(symbol: str) -> bool:
    sym = symbol.strip().upper()
    with _LOCK:
        d = _load()
        if sym in d:
            del d[sym]
            _save(d)
            return True
    return False


def add_journal(symbol: str, kind: str, content: str) -> dict | None:
    sym = symbol.strip().upper()
    with _LOCK:
        d = _load()
        t = d.get(sym)
        if not t:
            return None
        t.setdefault("journal", []).insert(0, {
            "ts": _now(), "kind": kind[:40], "content": content.strip(),
        })
        t["journal"] = t["journal"][:100]
        _save(d)
    return t


def evaluate(symbol: str) -> dict:
    """Bedingungen der These gegen Live-Daten prüfen. Rein deterministisch."""
    sym = symbol.strip().upper()
    t = get_thesis(sym)
    if not t:
        return {"exists": False}
    try:
        data = wstock.stock(sym)
    except Exception:
        data = {}
    checks = []
    held = 0
    for c in t.get("conditions", []):
        actual = _metric_value(data, c["metric"]) if data else None
        ok = None if not isinstance(actual, (int, float)) else _cmp(actual, c["op"], c["value"])
        if ok:
            held += 1
        checks.append({
            "metric": c["metric"], "label": _METRICS.get(c["metric"], c["metric"]),
            "op": c["op"], "value": c["value"],
            "actual": round(actual, 2) if isinstance(actual, (int, float)) else None,
            "ok": ok,
        })
    total = len(checks)
    return {
        "exists": True, "checks": checks, "held": held, "total": total,
        "all_ok": total > 0 and held == total,
        "price": data.get("price"), "currency": data.get("currency"), "as_of": _now(),
    }


def metrics_catalog() -> dict:
    """Für das Frontend: welche Kennzahlen + Operatoren wählbar sind."""
    return {"metrics": _METRICS, "ops": sorted(_OPS)}
