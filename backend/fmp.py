"""FMP-Datenlayer (Financial Modeling Prep, /stable/ API).

Primaerquelle fuer US-Fundamentaldaten + US-OHLC-Historie. Deckt den kaputten
CNBC-OHLC-Fallback ab und ergaenzt die gedrosselte Yahoo-Fundamental-Kette.

Nur US: FMP-Free liefert Nicht-US (Xetra/HK/KR) nur als 402 Premium -> dort
gibt this_module.available_for()==False zurueck, Aufrufer faellt auf Yahoo zurueck.

Key: FMP_API_KEY aus der Umgebung. Nie im Code, nie im Log.
Cool-down bei 429/402 wie in wstock.py, damit ein totes Kontingent nicht jeden
Request verzoegert.

Compliance: nur objektive Daten, keine Empfehlung, keine Prognose.
"""

from __future__ import annotations

import os
import ssl
import time
import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone

try:
    import certifi
    _CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _CTX = ssl.create_default_context()

_KEY = os.environ.get("FMP_API_KEY", "").strip()
_BASE = "https://financialmodelingprep.com/stable"
_UA = "vibe-research/0.1 (+fmp)"
_TTL = 300.0
_COOLDOWN_UNTIL = [0.0]          # 429/402 -> ganze Quelle kurz ruhen lassen
_COOLDOWN_SECS = 10 * 60.0
_cache: dict[str, tuple[float, object]] = {}


def enabled() -> bool:
    """FMP nutzbar? (Key vorhanden und nicht im Cool-down.)"""
    return bool(_KEY) and time.time() >= _COOLDOWN_UNTIL[0]


# 402-gesperrte Symbole merken: der FMP-Gratisplan gibt für die meisten Symbole
# 402 („symbol not available under your current subscription") — ohne Merken würde
# jeder Seitenaufruf erneut einen Call ans 250/Tag-Limit verschwenden. Pro Symbol
# einmal probieren, dann eine Weile überspringen (greift wieder, wenn Plan aufgewertet).
_blocked: dict[str, float] = {}
_BLOCK_SECS = 6 * 3600.0


def _get(ep: str, **params):
    """Ein /stable/-Call. Gibt geparstes JSON oder None. Setzt Cool-down bei 429,
    merkt 402-Symbole (nicht im Plan) und überspringt sie danach."""
    if not enabled():
        return None
    sym = str(params.get("symbol", "")).upper()
    if sym and _blocked.get(sym, 0.0) > time.time():
        return None                           # Symbol nicht im Plan → gar nicht erst anfragen
    params["apikey"] = _KEY
    url = f"{_BASE}/{ep}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=20, context=_CTX) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:                     # Tageskontingent erschoepft → ganze Quelle ruht
            _COOLDOWN_UNTIL[0] = time.time() + _COOLDOWN_SECS
        elif e.code == 402 and sym:           # Symbol nicht im (Gratis-)Plan → für dieses Symbol pausieren
            _blocked[sym] = time.time() + _BLOCK_SECS
        return None
    except Exception:
        return None


def _cached(key: str, build):
    hit = _cache.get(key)
    now = time.time()
    if hit and now - hit[0] < _TTL:
        return hit[1]
    val = build()
    if val is not None:
        _cache[key] = (now, val)
    return val


def _first(x):
    return x[0] if isinstance(x, list) and x else None


def _num(x):
    return x if isinstance(x, (int, float)) else None


def _pct(x):
    return round(x * 100, 2) if isinstance(x, (int, float)) else None


# ------------------------------------------------------------------ Fundamentals

def fundamentals(symbol: str) -> dict:
    """US-Fundamentaldaten in derselben Form wie wstock.fundamentals().
    {available: False} wenn FMP nichts liefert (z.B. Nicht-US -> 402)."""
    sym = symbol.strip().upper()

    def build():
        prof = _first(_get("profile", symbol=sym))
        rt = _first(_get("ratios-ttm", symbol=sym))
        if not prof and not rt:
            return None
        # ratios-ttm ist das Herz der Fundamentals. Fehlt es (z.B. Nicht-US -> 402),
        # gilt FMP fuer dieses Symbol als nicht verfuegbar -> Aufrufer faellt auf Yahoo.
        if not rt:
            return None
        prof = prof or {}

        price = _num(prof.get("price"))
        beta = _num(prof.get("beta"))
        w52 = str(prof.get("range") or "")
        w52_high = None
        if "-" in w52:
            try:
                w52_high = float(w52.split("-")[1])
            except (ValueError, IndexError):
                w52_high = None

        pe = _num(rt.get("priceToEarningsRatioTTM"))
        fpe = _num(rt.get("forwardPriceToEarningsGrowthRatioTTM"))  # naeherung
        peg = _num(rt.get("priceToEarningsGrowthRatioTTM"))
        pb = _num(rt.get("priceToBookRatioTTM"))
        ev_ebitda = _num(rt.get("enterpriseValueMultipleTTM"))
        gross = rt.get("grossProfitMarginTTM")
        op = rt.get("operatingProfitMarginTTM")
        net = rt.get("netProfitMarginTTM")
        dte_ratio = _num(rt.get("debtToEquityRatioTTM"))          # als Verhaeltnis (0.79)
        dte = round(dte_ratio * 100, 1) if dte_ratio is not None else None  # UI erwartet %-Skala
        cr = _num(rt.get("currentRatioTTM"))
        fcf_ps = _num(rt.get("freeCashFlowPerShareTTM"))
        dy = _num(rt.get("dividendYieldTTM"))
        payout = _num(rt.get("dividendPayoutRatioTTM"))
        # ROE via DuPont: Nettomarge * Asset-Turnover * Financial-Leverage
        roe = None
        try:
            at = rt.get("assetTurnoverTTM"); fl = rt.get("financialLeverageRatioTTM")
            if all(isinstance(v, (int, float)) for v in (net, at, fl)):
                roe = net * at * fl
        except Exception:
            roe = None

        flags = []
        def flag(cond, sev, text):
            if cond:
                flags.append({"severity": sev, "text": text})
        flag(isinstance(pe, (int, float)) and pe > 30, "warn", f"Hohe Bewertung: KGV {round(pe,1)}")
        flag(isinstance(peg, (int, float)) and peg > 2, "warn", f"PEG {round(peg,2)} > 2 - Wachstum teuer bezahlt")
        flag(isinstance(dte, (int, float)) and dte > 100, "high", f"Hohe Verschuldung: Debt/Equity {round(dte,0)}")
        flag(isinstance(cr, (int, float)) and cr < 1, "high", f"Duenne Liquiditaet: Current Ratio {round(cr,2)}")
        flag(isinstance(beta, (int, float)) and beta > 1.3, "warn", f"Hohe Marktsensitivitaet: Beta {round(beta,2)}")
        flag(isinstance(price, (int, float)) and isinstance(w52_high, (int, float)) and w52_high and price >= 0.97 * w52_high,
             "warn", "Nahe 52-Wochen-Hoch")
        flag(isinstance(dy, (int, float)) and dy > 0.08, "warn", f"Auffaellig hohe Dividendenrendite {_pct(dy)}% (Ausschuettungsrisiko)")

        return {
            "available": True,
            "symbol": sym,
            "valuation": {"pe": pe, "forward_pe": fpe, "peg": peg,
                          "price_to_book": pb, "ev_ebitda": ev_ebitda},
            "profitability": {
                "roe": _pct(roe), "roa": None,
                "gross_margin": _pct(gross), "operating_margin": _pct(op),
                "profit_margin": _pct(net),
                "revenue_growth": None, "earnings_growth": None,
            },
            "balance": {"debt_to_equity": dte, "current_ratio": cr,
                        "total_cash": None,
                        "free_cashflow": fcf_ps},
            "analyst": {"recommendation": None, "count": None,
                        "target_mean": None, "target_high": None, "target_low": None,
                        "price": price},
            "dividend": {"yield": _pct(dy), "payout": _pct(payout)},
            "risk": {"beta": beta, "flags": flags},
            "next_earnings": None,
            "disclaimer": "Objektive Fundamentaldaten (FMP). Risiko-Ampel = mechanische Schwellenwerte, keine Empfehlung.",
        }

    val = _cached(f"fund:{sym}", build)
    return val if val else {"available": False}


# --------------------------------------------------------------------- OHLC

def history(symbol: str) -> list[dict]:
    """Tages-OHLCV-Historie (US), Form wie wstock.cnbc_history():
    Liste {time, open, high, low, close, volume}, aelteste zuerst. [] bei Fehler."""
    sym = symbol.strip().upper()

    def build():
        rows = _get("historical-price-eod/full", symbol=sym)
        if not isinstance(rows, list) or not rows:
            return None
        out = []
        for b in rows:
            c = _num(b.get("close"))
            if c is None:
                continue
            out.append({
                "time": b.get("date"),
                "open": _num(b.get("open")), "high": _num(b.get("high")),
                "low": _num(b.get("low")), "close": c,
                "volume": b.get("volume"),
            })
        out.sort(key=lambda r: r["time"] or "")   # aelteste zuerst (Backtest erwartet das)
        return out

    val = _cached(f"hist:{sym}", build)
    return val or []
