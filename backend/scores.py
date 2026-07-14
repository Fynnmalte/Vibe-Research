"""Profi-Bilanz-Scores aus SEC-XBRL-Jahresdaten (US) — brauchen Mehrjahres-Fundamentaldaten,
die CNBC/FMP nicht geben:

  • Piotroski F-Score (0–9)  — Bilanzqualität/-verbesserung (Profitabilität, Verschuldung,
    Effizienz). ≥7 = stark, ≤2 = schwach.
  • Altman Z-Score            — Pleite-/Distress-Frühwarnung. >2,99 sicher, 1,81–2,99 grau,
    <1,81 Distress. (Klassische Z-Formel; bei Nicht-Industrie grob.)

Quelle: data.sec.gov XBRL companyfacts (kein Key). Nur US-Titel. Rein objektive Kennzahlen
aus den Geschäftsberichten — keine Empfehlung, keine Prognose.
"""

from __future__ import annotations

import threading
import time

import requests

import altdata
import wstock

_UA = altdata._UA
_TTL = 6 * 3600.0
_lock = threading.Lock()
_facts: dict[str, tuple] = {}     # cik -> (ts, us-gaap facts)
_cache: dict[str, tuple] = {}     # sym -> (ts, result)


def _companyfacts(cik: str) -> dict | None:
    with _lock:
        hit = _facts.get(cik)
        if hit and time.time() - hit[0] < _TTL:
            return hit[1]
    try:
        j = requests.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", headers=_UA, timeout=25).json()
        g = j["facts"]["us-gaap"]
    except Exception:
        return None
    with _lock:
        _facts[cik] = (time.time(), g)
    return g


def _annual(g: dict, tags: list[str], n: int = 2) -> list[float] | None:
    """Letzte n Jahres-Werte (10-K, FY) für den ersten passenden Tag, älteste→neueste."""
    for t in tags:
        if t not in g:
            continue
        for rows in g[t]["units"].values():
            fy: dict[str, float] = {}
            for r in rows:
                if r.get("form") == "10-K" and r.get("fp") == "FY" and r.get("val") is not None:
                    fy[r["end"][:4]] = r["val"]
            if len(fy) >= n:
                ys = sorted(fy)[-n:]
                return [fy[y] for y in ys]
    return None


def _piotroski(g: dict) -> dict:
    A = lambda tags: _annual(g, tags)  # noqa: E731
    assets = A(["Assets"]); ni = A(["NetIncomeLoss"]); cfo = A(["NetCashProvidedByUsedInOperatingActivities"])
    ltd = A(["LongTermDebtNoncurrent", "LongTermDebt"]); ca = A(["AssetsCurrent"]); cl = A(["LiabilitiesCurrent"])
    sh = A(["WeightedAverageNumberOfDilutedSharesOutstanding", "CommonStockSharesOutstanding"])
    gp = A(["GrossProfit"]); rev = A(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"])

    tests = []
    def t(name, ok, detail):
        tests.append({"name": name, "pass": bool(ok) if ok is not None else None, "detail": detail})

    roa0 = roa1 = None
    if ni and assets:
        roa0, roa1 = ni[0] / assets[0], ni[1] / assets[1]
    t("ROA positiv", (roa1 > 0) if roa1 is not None else None, f"{round(roa1*100,1)}%" if roa1 is not None else "—")
    t("Operativer Cashflow positiv", (cfo[1] > 0) if cfo else None, f"{round(cfo[1]/1e9,1)} Mrd." if cfo else "—")
    t("ROA steigend", (roa1 > roa0) if roa0 is not None else None, f"{round(roa0*100,1)}→{round(roa1*100,1)}%" if roa0 is not None else "—")
    t("Cashflow > Gewinn (Ertragsqualität)", (cfo[1] > ni[1]) if (cfo and ni) else None, "" )
    lev0 = lev1 = None
    if ltd and assets:
        lev0, lev1 = ltd[0] / assets[0], ltd[1] / assets[1]
    t("Verschuldung sinkend", (lev1 < lev0) if lev0 is not None else None, f"{round(lev0*100,0)}→{round(lev1*100,0)}%" if lev0 is not None else "—")
    cr0 = cr1 = None
    if ca and cl:
        cr0, cr1 = ca[0] / cl[0], ca[1] / cl[1]
    t("Liquidität steigend (Current Ratio)", (cr1 > cr0) if cr0 is not None else None, f"{round(cr0,2)}→{round(cr1,2)}" if cr0 is not None else "—")
    t("Keine Verwässerung", (sh[1] <= sh[0] * 1.001) if sh else None, "")
    gm0 = gm1 = None
    if gp and rev:
        gm0, gm1 = gp[0] / rev[0], gp[1] / rev[1]
    t("Bruttomarge steigend", (gm1 > gm0) if gm0 is not None else None, f"{round(gm0*100,1)}→{round(gm1*100,1)}%" if gm0 is not None else "—")
    at0 = at1 = None
    if rev and assets:
        at0, at1 = rev[0] / assets[0], rev[1] / assets[1]
    t("Kapitalumschlag steigend", (at1 > at0) if at0 is not None else None, f"{round(at0,2)}→{round(at1,2)}" if at0 is not None else "—")

    scored = [x for x in tests if x["pass"] is not None]
    passed = sum(1 for x in scored if x["pass"])
    return {"score": passed, "max": len(scored), "tests": tests}


def _altman(g: dict, mcap: float | None) -> dict:
    A = lambda tags: _annual(g, tags, 1)  # noqa: E731  (nur aktuelles Jahr)
    assets = A(["Assets"]); liab = A(["Liabilities"]); ca = A(["AssetsCurrent"]); cl = A(["LiabilitiesCurrent"])
    re_ = A(["RetainedEarningsAccumulatedDeficit"]); ebit = A(["OperatingIncomeLoss"])
    rev = A(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"])
    if not (assets and liab and ca and cl and ebit and rev and mcap):
        return {"available": False}
    ta = assets[0]
    x1 = (ca[0] - cl[0]) / ta
    x2 = (re_[0] / ta) if re_ else 0.0
    x3 = ebit[0] / ta
    x4 = mcap / liab[0] if liab[0] else 0.0
    x5 = rev[0] / ta
    z = round(1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5, 2)
    zone = "safe" if z > 2.99 else ("grey" if z >= 1.81 else "distress")
    return {"available": True, "z": z, "zone": zone,
            "components": {"WC/TA": round(x1, 2), "RE/TA": round(x2, 2), "EBIT/TA": round(x3, 2),
                           "MktCap/Liab": round(x4, 2), "Sales/TA": round(x5, 2)}}


def analyze(symbol: str) -> dict:
    """Piotroski + Altman für ein US-Symbol aus SEC-XBRL. {available: False} bei Nicht-US/keine Daten."""
    sym = symbol.strip().upper()
    if not altdata._is_us(sym):
        return {"available": False, "reason": "SEC-Bilanz-Scores nur für US-Titel."}
    with _lock:
        hit = _cache.get(sym)
        if hit and time.time() - hit[0] < _TTL:
            return hit[1]

    cik = altdata._cik_of(sym)
    g = _companyfacts(cik) if cik else None
    if not g:
        return {"available": False}

    try:
        mcap = (wstock.stock(sym) or {}).get("mcap")
    except Exception:
        mcap = None

    piotroski = _piotroski(g)
    altman = _altman(g, mcap)
    out = {
        "available": True, "symbol": sym,
        "piotroski": piotroski, "altman": altman,
        "disclaimer": "Piotroski F-Score & Altman Z-Score aus SEC-XBRL-Jahresdaten (10-K). "
                      "Mechanische Kennzahlen, keine Empfehlung, keine Prognose.",
    }
    with _lock:
        _cache[sym] = (time.time(), out)
    return out
