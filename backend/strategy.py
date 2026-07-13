"""Fundamental-getriebene Positionierungs-Strategie — transparentes Multi-Faktor-Modell.

Kombiniert fünf akademisch etablierte Faktoren zu einer mechanischen Einordnung
Long / Neutral / Short:
    Value (günstig)          – KGV / Forward-KGV / PEG / KBV / EV-EBITDA / Dividende
    Quality (profitabel)     – ROE / Netto- / Bruttomarge
    Financial Health (solide)– Debt/Equity / Current Ratio
    Growth (Wachstum)        – Umsatz- / Gewinnwachstum
    Momentum (Trend)         – aus quant.py (3M-Rendite, Lage zu SMA50/200)

Jeder Faktor 0–100 (höher = bullischer). Der Gesamtwert und feste Schwellen ergeben
eine Positionierung samt benanntem Strategie-Archetyp (GARP / Deep Value / Quality-
Momentum / Distress-Short / Überbewertet …) mit voll sichtbaren Pro-/Contra-Punkten.

⚠️ Rein mechanische Regelausgabe aus öffentlichen Fundamentaldaten — keine Prognose,
keine Anlageberatung. Schwellen sind bewusst simpel und transparent, kein Backtest-Fit.
"""

from __future__ import annotations

import quant
import wstock


def _clamp(x) -> int:
    return int(max(0, min(100, round(x))))


def _avg(pts: list[int]):
    return _clamp(sum(pts) / len(pts)) if pts else None


# --- Einzelfaktoren: Kennzahl → 0–100 (höher = bullischer), plus lesbare Treiber ---

def _f_value(f: dict) -> tuple[int | None, list[str]]:
    v, d = f.get("valuation", {}), f.get("dividend", {})
    pts, drv = [], []
    use_pe = v.get("forward_pe") or v.get("pe")
    if isinstance(use_pe, (int, float)) and use_pe > 1:   # KGV < 1 = fehlerhafte Datenquelle, ignorieren
        pts.append(_clamp(100 - (use_pe - 15) * 4)); drv.append(f"KGV {round(use_pe, 1)}")   # 15→100, 40→0
    if isinstance(v.get("peg"), (int, float)) and v["peg"] > 0:
        pts.append(_clamp(100 - (v["peg"] - 1) * 50)); drv.append(f"PEG {round(v['peg'], 2)}")
    if isinstance(v.get("price_to_book"), (int, float)) and v["price_to_book"] > 0:
        pts.append(_clamp(100 - (v["price_to_book"] - 1.5) * 18)); drv.append(f"KBV {round(v['price_to_book'], 2)}")
    if isinstance(v.get("ev_ebitda"), (int, float)) and v["ev_ebitda"] > 0:
        pts.append(_clamp(100 - (v["ev_ebitda"] - 10) * 6)); drv.append(f"EV/EBITDA {round(v['ev_ebitda'], 1)}")
    if isinstance(d.get("yield"), (int, float)) and d["yield"] > 0:
        pts.append(_clamp(50 + d["yield"] * 8)); drv.append(f"Div-Rendite {round(d['yield'], 2)}%")
    return _avg(pts), drv


def _f_quality(f: dict) -> tuple[int | None, list[str]]:
    p = f.get("profitability", {})
    pts, drv = [], []
    if isinstance(p.get("roe"), (int, float)):
        pts.append(_clamp(p["roe"] * 2.5)); drv.append(f"ROE {round(p['roe'], 1)}%")           # 40%→100
    if isinstance(p.get("profit_margin"), (int, float)):
        pts.append(_clamp(50 + p["profit_margin"] * 2.0)); drv.append(f"Nettomarge {round(p['profit_margin'], 1)}%")
    if isinstance(p.get("gross_margin"), (int, float)):
        pts.append(_clamp(p["gross_margin"])); drv.append(f"Bruttomarge {round(p['gross_margin'], 1)}%")
    return _avg(pts), drv


def _f_health(f: dict) -> tuple[int | None, list[str]]:
    b = f.get("balance", {})
    pts, drv = [], []
    if isinstance(b.get("debt_to_equity"), (int, float)):
        pts.append(_clamp(100 - b["debt_to_equity"] * 0.6)); drv.append(f"Debt/Equity {round(b['debt_to_equity'], 0)}%")  # 100%→40
    if isinstance(b.get("current_ratio"), (int, float)):
        pts.append(_clamp((b["current_ratio"] - 0.5) * 66)); drv.append(f"Current Ratio {round(b['current_ratio'], 2)}")
    return _avg(pts), drv


def _f_growth(f: dict) -> tuple[int | None, list[str]]:
    p = f.get("profitability", {})
    pts, drv = [], []
    if isinstance(p.get("revenue_growth"), (int, float)):
        pts.append(_clamp(50 + p["revenue_growth"] * 2.5)); drv.append(f"Umsatzwachstum {round(p['revenue_growth'], 1)}%")
    if isinstance(p.get("earnings_growth"), (int, float)):
        pts.append(_clamp(50 + p["earnings_growth"] * 1.5)); drv.append(f"Gewinnwachstum {round(p['earnings_growth'], 1)}%")
    return _avg(pts), drv


def _classify(val, qual, health, growth, mom, comp) -> tuple[str, str, str]:
    """Feste, transparente Schwellen → (signal, stance, archetype). Fehlende Faktoren = 50 neutral."""
    v = val if val is not None else 50
    q = qual if qual is not None else 50
    h = health if health is not None else 50
    m = mom if mom is not None else 50
    c = comp if comp is not None else 50

    # Short-Lean: fragile Bilanz kombiniert mit schwachem Trend oder teurer Bewertung.
    if h < 30 and (m < 40 or v < 30):
        return "short", "Short-Kandidat", "Distress-Short (schwache Bilanz + schwacher Trend/teuer)"
    if v < 25 and m < 40 and c < 42:
        return "short", "Short-Kandidat", "Überbewertet-Short (teuer + kein Momentum)"

    # Long-Lean: solide Bilanz plus überdurchschnittlicher Gesamtwert.
    if c >= 60 and h >= 45:
        if q >= 65 and v >= 50:
            arch = "Quality-Value / GARP (profitabel + fair bewertet)"
        elif v >= 70:
            arch = "Deep Value (sehr günstig)"
        elif q >= 65 and m >= 60:
            arch = "Quality-Momentum (profitabel + Aufwärtstrend)"
        elif m >= 65:
            arch = "Momentum-Long (starker Trend)"
        else:
            arch = "Solide-Long (breit überdurchschnittlich)"
        return "long", "Long-Kandidat (Halten / Aufbauen)", arch

    return "neutral", "Neutral", "Gemischtes Bild — kein klares Signal"


def analyze(symbol: str) -> dict:
    """Multi-Faktor-Positionierung für ein Symbol. {available: False} wenn keine Fundamentaldaten."""
    sym = symbol.strip().upper()
    f = wstock.fundamentals(sym)
    if not f.get("available"):
        return {"available": False}
    q = quant.analyze(sym)
    qf = q.get("factors", {}) if q.get("available") else {}

    val, val_d = _f_value(f)
    qual, qual_d = _f_quality(f)
    health, health_d = _f_health(f)
    growth, growth_d = _f_growth(f)

    mom_s = qf.get("momentum", {}).get("score")
    trend_s = qf.get("trend", {}).get("score")
    mom_pts = [x for x in (mom_s, trend_s) if isinstance(x, int)]
    momentum = _avg(mom_pts)
    mom_d = []
    if q.get("available"):
        ind = q.get("indicators", {})
        if ind.get("ret_3m") is not None:
            mom_d.append(f"3M-Rendite {ind['ret_3m']}%")
        mom_d.append(qf.get("trend", {}).get("driver", ""))
    mom_d = [x for x in mom_d if x]

    factors = [
        {"key": "value",    "label": "Value (günstig)",          "score": val,      "drivers": val_d},
        {"key": "quality",  "label": "Quality (profitabel)",     "score": qual,     "drivers": qual_d},
        {"key": "health",   "label": "Financial Health (solide)","score": health,   "drivers": health_d},
        {"key": "growth",   "label": "Growth (Wachstum)",        "score": growth,   "drivers": growth_d},
        {"key": "momentum", "label": "Momentum (Trend)",         "score": momentum, "drivers": mom_d},
    ]
    scored = [x["score"] for x in factors if x["score"] is not None]
    composite = _avg(scored)

    signal, stance, archetype = _classify(val, qual, health, growth, momentum, composite)

    # Transparente Pro-/Contra-Punkte (nur wo Datenlage klar).
    bull, bear = [], []
    if val is not None:
        if val >= 60:   bull.append(f"günstig bewertet ({', '.join(val_d[:2])})")
        elif val <= 30: bear.append(f"teuer bewertet ({', '.join(val_d[:2])})")
    if qual is not None:
        if qual >= 65:   bull.append(f"hohe Profitabilität ({', '.join(qual_d[:2])})")
        elif qual <= 30: bear.append(f"schwache Profitabilität ({', '.join(qual_d[:2])})")
    if health is not None:
        if health >= 60:   bull.append(f"solide Bilanz ({', '.join(health_d[:2])})")
        elif health <= 30: bear.append(f"fragile Bilanz ({', '.join(health_d[:2])})")
    if momentum is not None:
        if momentum >= 60:   bull.append(f"Aufwärtstrend ({', '.join(mom_d[:1])})")
        elif momentum <= 35: bear.append(f"Abwärtstrend ({', '.join(mom_d[:1])})")

    # Überzeugung: Abstand des Gesamtwerts von neutral (50), skaliert.
    conviction = _clamp(abs((composite or 50) - 50) * 2) if composite is not None else 0

    return {
        "available": True,
        "symbol": sym,
        "signal": signal,               # long | short | neutral
        "stance": stance,
        "archetype": archetype,
        "conviction": conviction,       # 0–100
        "composite": composite,
        "factors": factors,
        "bull_points": bull,
        "bear_points": bear,
        "disclaimer": "Mechanisches Multi-Faktor-Modell (Value / Quality / Financial Health / "
                      "Growth / Momentum) aus öffentlichen Fundamentaldaten. Feste, transparente "
                      "Schwellen — keine Prognose, keine Anlageberatung. Selbst prüfen, eigenständig entscheiden.",
    }
