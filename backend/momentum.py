"""Momentum-Kennzahlen — die drei Klassiker für Momentum-Screening (alle aus vorhandener Historie):

  1. Relativstärke (RS)      — Aktienrendite minus Index-Rendite (1M / 3M). Positiv = schlägt
     den Markt; hält an roten Tagen. Führt die nächste Aufwärtsbewegung an.
  2. 52-Wochen-Hoch-Nähe     — % unter dem 52W-Hoch + Breakout-Flag. Momentum läuft an Hochs.
  3. Relatives Volumen       — heutiges Volumen / 20-Tage-Schnitt. Ausbruch ohne Volumen = Falle.

Plus ein transparenter Momentum-Score (0–100). Rein mechanisch, keine Empfehlung/Prognose.
"""

from __future__ import annotations

import wstock


def _index_for(sym: str) -> str:
    s = sym.upper()
    if s.endswith(".DE"):
        return "^GDAXI"
    if s.endswith(".HK"):
        return "^HSI"
    return "^GSPC"   # US + Rest → S&P 500


def _ret(bars: list[dict], days: int):
    if len(bars) <= days:
        return None
    old = bars[-days - 1]["close"]
    new = bars[-1]["close"]
    return round((new / old - 1) * 100, 2) if old else None


def _clamp(x) -> int:
    return int(max(0, min(100, round(x))))


def metrics(symbol: str) -> dict:
    """RS + 52W-Hoch-Nähe + relatives Volumen + Momentum-Score. {available: False} ohne Historie."""
    sym = symbol.strip().upper()
    bars = wstock.cnbc_history(sym, "1Y")
    if len(bars) < 30:
        return {"available": False}

    # --- Relativstärke: Aktie minus Index ---
    idx = wstock.cnbc_history(_index_for(sym), "1Y")
    r1, r3 = _ret(bars, 21), _ret(bars, 63)          # ~1M, ~3M Handelstage
    ir1, ir3 = _ret(idx, 21), _ret(idx, 63)
    rs1 = round(r1 - ir1, 2) if (r1 is not None and ir1 is not None) else None
    rs3 = round(r3 - ir3, 2) if (r3 is not None and ir3 is not None) else None

    # --- 52-Wochen-Hoch-Nähe ---
    highs = [(b.get("high") or b.get("close")) for b in bars[-252:] if (b.get("high") or b.get("close"))]
    w52h = max(highs) if highs else None
    price = bars[-1]["close"]
    pct_from_high = round((price / w52h - 1) * 100, 1) if w52h else None   # 0 = am Hoch, negativ = darunter
    breakout = bool(pct_from_high is not None and pct_from_high >= -2)      # innerhalb 2 % vom Hoch

    # --- relatives Volumen (heute vs. 20-Tage-Schnitt) ---
    vols = [b.get("volume") for b in bars if b.get("volume")]
    rel_vol = None
    if len(vols) >= 21:
        avg20 = sum(vols[-21:-1]) / 20
        rel_vol = round(vols[-1] / avg20, 2) if avg20 else None

    # --- Momentum-Score 0–100 (transparent gewichtet) ---
    parts = []
    if rs3 is not None:
        parts.append(_clamp(50 + rs3 * 2.5))          # +20 % RS → 100
    if pct_from_high is not None:
        parts.append(_clamp(100 + pct_from_high * 3))  # am Hoch → 100, 33 % drunter → 0
    if rel_vol is not None:
        parts.append(_clamp(40 + (rel_vol - 1) * 40))  # RelVol 1 → 40, 2,5 → 100
    score = _clamp(sum(parts) / len(parts)) if parts else None

    return {
        "available": True, "symbol": sym,
        "ret_1m": r1, "ret_3m": r3,
        "rs_1m": rs1, "rs_3m": rs3,
        "pct_from_high": pct_from_high, "breakout": breakout,
        "rel_volume": rel_vol,
        "score": score,
    }
