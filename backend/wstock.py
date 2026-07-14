"""US / EU / HK Marktdaten für den Tagesrückblick.

Drei Quellen für dieselben Yahoo-Daten, in dieser Reihenfolge:
  1. RapidAPI (wenn YH_RAPIDAPI_KEY gesetzt): authentifiziert → kein IP-Limit,
     Batch bis ~50 Symbole/Call, deckt US + Xetra (SAP.DE in EUR) + Hongkong (0700.HK)
     + Indizes (^GDAXI). Endpoint `/market/get-quotes`. Achtung: BASIC-Plan hat nur
     500 Requests/Monat — nach 429 (Kontingent) 6 h Cool-down.
  2. Yahoo `/v7/finance/quote` mit Cookie+Crumb (ohne Key, gratis): dieselbe API, die
     RapidAPI intern wrappt. Batch wie RapidAPI, braucht nur Session-Cookie + Crumb.
  3. Anonymes Yahoo `spark` (letzte Stufe): funktioniert ohne Crumb, drosselt aber pro
     IP aggressiv (HTTP 429) und deckelt bei 20 Symbolen/Request.

Quellen-Cool-down: liefert eine Quelle 429, wird sie eine Weile nicht mehr angefasst —
sonst verlängert jeder Dashboard-Load/Scheduler-Tick die Yahoo-IP-Sperre nur weiter.

Warum überhaupt Yahoo-Daten: Eastmoney liefert Namen nur chinesisch und kennt keine
nativen Xetra-Kurse (SAP nur als NYSE-ADR). Yahoo hat longName, Originalwährung, Xetra.

Compliance: nur objektive Marktdaten, keine Empfehlung, keine Prognose.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

import requests

# ---- Primärquelle: RapidAPI (Yahoo-Daten mit Key) ----------------------------
_RAPID_KEY = os.environ.get("YH_RAPIDAPI_KEY", "").strip()
_RAPID_HOST = os.environ.get("YH_RAPIDAPI_HOST", "yahoo-finance-real-time1.p.rapidapi.com").strip()
_RAPID_CHUNK = 40    # ein Call liefert problemlos ≥50 Symbole; 40 lässt Luft
_RAPID_CREDIT_NOTE = "RapidAPI zählt pro Request, nicht pro Symbol → Batch ist günstig"

# ---- Primaerquelle US: FMP (Fundamentals + OHLC). Nicht-US -> available:False,
#      dann greift automatisch die bestehende Yahoo/CNBC-Kette unten. ----------
try:
    import fmp as _fmp
except Exception:
    _fmp = None

# ---- Fallback: anonymes Yahoo spark (ohne Key) -------------------------------
_HOSTS = ("query1.finance.yahoo.com", "query2.finance.yahoo.com")
_SPARK_PATH = "/v7/finance/spark"
_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"}
_SPARK_CHUNK = 20    # Yahoo lehnt >20 Symbole mit HTTP 400 ab
_TTL = 300.0         # Sekunden; großzügig cachen (schont RapidAPI-Kontingent + Yahoo-Limit)

# Quellen-Cool-down (Unix-Zeit, bis wann die Quelle ruht). "yahoo" gilt gemeinsam für
# crumb-quote und spark — die IP-Drossel unterscheidet nicht nach Endpoint.
_COOLDOWN = {"rapid": 0.0, "cnbc": 0.0, "yahoo": 0.0}
_RAPID_COOLDOWN = 6 * 3600.0   # Monatskontingent erschöpft — frühestens in Stunden neu probieren
_YAHOO_COOLDOWN = 15 * 60.0    # IP-Drossel braucht Ruhe, um abzuklingen
_CNBC_COOLDOWN = 5 * 60.0      # sehr tolerant; nur bei echtem Fehler kurz pausieren


def _parse_quotes(res: list) -> dict[str, dict]:
    """quoteResponse.result (RapidAPI und crumb-quote identisch) in unser Format."""
    out: dict[str, dict] = {}
    for q in res:
        sym = q.get("symbol")
        price = q.get("regularMarketPrice")
        if not sym or not isinstance(price, (int, float)):
            continue
        chg = q.get("regularMarketChangePercent")
        # shortName bei Xetra mit Kürzeln aufgefüllt ("SAP SE   I") → longName bevorzugen
        out[sym] = {
            "symbol": sym,
            "name": (q.get("longName") or q.get("shortName") or sym).strip(),
            "price": price,
            "prev_close": q.get("regularMarketPreviousClose"),
            "change_pct": round(chg, 2) if isinstance(chg, (int, float)) else None,
            "currency": q.get("currency"),
            "exchange": q.get("fullExchangeName"),
        }
    return out


# ---- Primäre Gratis-Quelle: CNBC quote-webservice (kein Key, kein IP-Limit-Problem) ----
# Deckt US-Ticker, Indizes und internationale Börsen. Eigenes Symbol-Schema, daher Mapping
# von/zu Yahoo-Symbolen (die die App durchgängig nutzt).
_CNBC_URL = ("https://quote.cnbc.com/quote-html-webservice/restQuote/"
             "symbolType/symbol")
_CNBC_INDEX = {  # Yahoo-Index → CNBC (^GSPC ist der Sonderfall, Rest folgt ^X→.X)
    "^GSPC": ".SPX", "^IXIC": ".IXIC", "^DJI": ".DJI",
    "^GDAXI": ".GDAXI", "^STOXX50E": ".STOXX50E", "^HSI": ".HSI",
}


def _to_cnbc(sym: str) -> str:
    """Yahoo-Symbol → CNBC-Symbol."""
    if sym in _CNBC_INDEX:
        return _CNBC_INDEX[sym]
    if sym.startswith("^"):
        return "." + sym[1:]
    if sym.endswith(".HK"):                      # 0700.HK → 700-HK (führende Nullen weg)
        return sym[:-3].lstrip("0") + "-HK"
    if "." in sym:                               # SAP.DE → SAP-DE, 005930.KS → 005930-KS
        base, suf = sym.rsplit(".", 1)
        return f"{base}-{suf}"
    return sym                                   # reiner US-Ticker unverändert


_CNBC_TO_Y = {v: k for k, v in _CNBC_INDEX.items()}


def _from_cnbc(sym: str) -> str:
    """CNBC-Symbol → Yahoo-Symbol (Rückabbildung fürs Merge unter Yahoo-Key)."""
    if sym in _CNBC_TO_Y:
        return _CNBC_TO_Y[sym]
    if sym.endswith("-HK"):
        return sym[:-3].zfill(4) + ".HK" if sym[:-3].isdigit() else sym[:-3] + ".HK"
    if sym.startswith("."):
        return "^" + sym[1:]
    if "-" in sym:
        base, suf = sym.rsplit("-", 1)
        return f"{base}.{suf}"
    return sym


def _cnbc_num(s):
    """CNBC-Zahlenstring ('7,575.39', '+0.42%', 'UNCH', '') → float | None."""
    if s is None:
        return None
    t = str(s).strip().replace(",", "").rstrip("%")
    if not t or t.upper() == "UNCH":
        return 0.0 if str(s).strip().upper() == "UNCH" else None
    try:
        return float(t)
    except ValueError:
        return None


def _cnbc_fetch(symbols: list[str]) -> dict[str, dict]:
    """CNBC-Batch (pipe-getrennt). Leeres dict bei Fehler/Cool-down."""
    if not symbols or time.time() < _COOLDOWN["cnbc"]:
        return {}
    mapped = "|".join(_to_cnbc(s) for s in symbols)
    _throttle("cnbc")
    try:
        r = requests.get(_CNBC_URL, params={
            "symbols": mapped, "requestMethod": "itv", "fund": "1", "output": "json",
        }, headers=_UA, timeout=12)
        if not r.ok:
            _COOLDOWN["cnbc"] = time.time() + _CNBC_COOLDOWN
            return {}
        q = (r.json().get("FormattedQuoteResult") or {}).get("FormattedQuote") or []
    except Exception:
        _COOLDOWN["cnbc"] = time.time() + _CNBC_COOLDOWN
        return {}
    if isinstance(q, dict):
        q = [q]
    out: dict[str, dict] = {}
    for item in q:
        if not isinstance(item, dict) or item.get("code") not in (0, "0"):
            continue
        price = _cnbc_num(item.get("last"))
        if price is None:
            continue
        ysym = _from_cnbc(item.get("symbol", ""))
        chg = _cnbc_num(item.get("change_pct"))
        out[ysym] = {
            "symbol": ysym,
            "name": (item.get("name") or item.get("shortName") or ysym).strip(),
            "price": price,
            "prev_close": _cnbc_num(item.get("previous_day_closing")),
            "change_pct": round(chg, 2) if chg is not None else None,
            "currency": item.get("currencyCode"),
            "exchange": item.get("exchange"),
        }
    return out


def _cnbc_bignum(s):
    """CNBC-Kurzzahl mit Suffix ('4.631T', '137.58B', '29.0M', '451,442') → float | None."""
    if s is None:
        return None
    t = str(s).strip().replace(",", "")
    if not t:
        return None
    mult = 1.0
    if t and t[-1] in "TBMK":
        mult = {"T": 1e12, "B": 1e9, "M": 1e6, "K": 1e3}[t[-1]]
        t = t[:-1]
    try:
        return float(t) * mult
    except ValueError:
        return None


def _cnbc_raw(sym: str) -> dict | None:
    """Einzelnes Symbol bei CNBC mit fund=1 → rohes FormattedQuote-dict (reiche Fundamentalfelder:
    open/high/low/volume/pe/fpe/eps/mktcap/revenue/ROE/Margen/Debt-Equity/52W). None bei Fehler/Cool-down."""
    if time.time() < _COOLDOWN["cnbc"]:
        return None
    _throttle("cnbc")
    try:
        r = requests.get(_CNBC_URL, params={
            "symbols": _to_cnbc(sym), "requestMethod": "itv", "fund": "1", "output": "json",
        }, headers=_UA, timeout=12)
        if not r.ok:
            _COOLDOWN["cnbc"] = time.time() + _CNBC_COOLDOWN
            return None
        q = (r.json().get("FormattedQuoteResult") or {}).get("FormattedQuote") or []
    except Exception:
        _COOLDOWN["cnbc"] = time.time() + _CNBC_COOLDOWN
        return None
    if isinstance(q, dict):
        q = [q]
    for item in q:
        if isinstance(item, dict) and item.get("code") in (0, "0") and _cnbc_num(item.get("last")) is not None:
            return item
    return None


def _cnbc_detail(sym: str) -> dict:
    """WStockDetail-Form aus CNBC (kein Key). Leeres dict wenn CNBC nichts liefert."""
    it = _cnbc_raw(sym)
    if not it:
        return {}

    def pos(x):  # CNBC gibt Intraday-Felder (open/high/low/volume) bei geschlossenem Markt als 0 → als fehlend werten
        v = _cnbc_num(x)
        return v if v else None

    open_, high, low = pos(it.get("open")), pos(it.get("high")), pos(it.get("low"))
    vol = _cnbc_bignum(it.get("volume")) or None
    # Markt zu → Intraday leer/0. Letzten kompletten Tagesbar aus der History nehmen.
    if open_ is None or high is None or low is None or vol is None:
        bars = cnbc_history(sym, "3M")
        if bars:
            b = bars[-1]
            open_ = open_ if open_ is not None else b.get("open")
            high = high if high is not None else b.get("high")
            low = low if low is not None else b.get("low")
            vol = vol if vol is not None else b.get("volume")

    chg = _cnbc_num(it.get("change_pct"))
    return {
        "symbol": _from_cnbc(it.get("symbol", sym)),
        "name": (it.get("name") or it.get("shortName") or sym).strip(),
        "price": _cnbc_num(it.get("last")),
        "prev_close": _cnbc_num(it.get("previous_day_closing")),
        "change_pct": round(chg, 2) if chg is not None else None,
        "open": open_,
        "high": high,
        "low": low,
        "volume": vol,
        "mcap": _cnbc_bignum(it.get("mktcapView")),
        "pe": _cnbc_num(it.get("pe")),
        "forward_pe": _cnbc_num(it.get("fpe")),
        "eps": _cnbc_num(it.get("eps")),
        "week52_high": _cnbc_num(it.get("yrhiprice")),
        "week52_low": _cnbc_num(it.get("yrloprice")),
        "currency": it.get("currencyCode"),
        "exchange": it.get("exchange"),
        "quote_type": it.get("type"),
    }


def _cnbc_fundamentals(sym: str) -> dict:
    """Fundamentals-Struktur aus CNBC (kein Key). CNBC liefert Bewertung/Profitabilität/
    Verschuldung/Dividende; Analystenziele, PEG, ROA, Cashflow, Earnings-Termin fehlen (None).
    {available: False} wenn CNBC nichts liefert."""
    it = _cnbc_raw(sym)
    if not it:
        return {"available": False}

    fpe = _cnbc_num(it.get("fpe"))
    dte = _cnbc_num(it.get("DEBTEQTYQ"))     # in % (z.B. 79.55)
    beta = _cnbc_num(it.get("beta"))
    dy = _cnbc_num(it.get("dividendyield"))  # bereits in %
    price = _cnbc_num(it.get("last"))
    w52_high = _cnbc_num(it.get("yrhiprice"))

    flags = []
    def flag(cond, sev, text):
        # text lazy (callable) auswerten: sonst crasht ein f-string mit round(None),
        # bevor 'cond' kurzschliesst (z.B. wenn fpe/dte/... None sind).
        if cond:
            flags.append({"severity": sev, "text": text() if callable(text) else text})

    flag(isinstance(fpe, (int, float)) and fpe > 30, "warn", lambda: f"Hohe Bewertung: Forward-KGV {round(fpe, 1)}")
    flag(isinstance(dte, (int, float)) and dte > 100, "high", lambda: f"Hohe Verschuldung: Debt/Equity {round(dte, 0)}")
    flag(isinstance(beta, (int, float)) and beta > 1.3, "warn", lambda: f"Hohe Marktsensitivität: Beta {round(beta, 2)}")
    flag(isinstance(price, (int, float)) and isinstance(w52_high, (int, float)) and w52_high and price >= 0.97 * w52_high,
         "warn", "Nahe 52-Wochen-Hoch")
    flag(isinstance(dy, (int, float)) and dy > 8, "warn", lambda: f"Auffällig hohe Dividendenrendite {round(dy, 2)}% (Ausschüttungsrisiko)")

    return {
        "available": True,
        "symbol": _from_cnbc(it.get("symbol", sym)),
        "valuation": {
            "pe": _cnbc_num(it.get("pe")), "forward_pe": fpe, "peg": None,
            "price_to_book": None, "ev_ebitda": None,
        },
        "profitability": {
            "roe": _cnbc_num(it.get("ROETTM")), "roa": None,
            "gross_margin": _cnbc_num(it.get("GROSMGNTTM")), "operating_margin": None,
            "profit_margin": _cnbc_num(it.get("NETPROFTTM")),
            "revenue_growth": None, "earnings_growth": None,
        },
        "balance": {
            "debt_to_equity": dte, "current_ratio": None,
            "total_cash": None, "free_cashflow": None,
        },
        "analyst": {
            "recommendation": None, "count": None,
            "target_mean": None, "target_high": None, "target_low": None,
            "price": price,
        },
        "dividend": {"yield": dy, "payout": None},
        "risk": {"beta": beta, "flags": flags},
        "next_earnings": None,
        "disclaimer": "Objektive Fundamentaldaten (CNBC-Gratisquelle, ohne API-Key). "
                      "Analystenziele / PEG / Cashflow nur mit RapidAPI-Key verfügbar. "
                      "Risiko-Ampel = mechanische Schwellenwerte, keine Empfehlung.",
    }


_CNBC_CHART = "https://ts-api.cnbc.com/harmony/app/charts/{rng}.json"

# History-Cache: quant, strategy (via quant) und backtest ziehen dieselbe Tageshistorie —
# ohne Cache wird sie pro Aktienseite mehrfach geladen. 10 Min TTL reicht (Tagesbars).
_hist_cache: dict[tuple, tuple] = {}
_HIST_TTL = 600.0


def cnbc_history(symbol: str, rng: str = "1Y") -> list[dict]:
    """Tages-OHLCV-Historie von CNBC (kein Key). rng: '1Y'/'6M'/'3M' etc. — '6M' liefert
    hier ~2 Jahre Tagesbars, '1Y' ~2 Jahre. Liste von {time (ISO), open, high, low, close,
    volume}; leer bei Fehler/Cool-down. Für quant/backtest, wenn RapidAPI-Chart tot ist."""
    key = (symbol.upper(), rng)
    hit = _hist_cache.get(key)
    if hit and time.time() - hit[0] < _HIST_TTL:
        return hit[1]
    # US-Primaerquelle FMP zuerst (saubere OHLC-Historie); leere Liste -> Fallback CNBC.
    if _fmp is not None and _fmp.enabled():
        try:
            fh = _fmp.history(symbol)
            if fh:
                _hist_cache[key] = (time.time(), fh)
                return fh
        except Exception:
            pass
    if time.time() < _COOLDOWN["cnbc"]:
        return []
    _throttle("cnbc")
    try:
        r = requests.get(_CNBC_CHART.format(rng=rng),
                         params={"symbol": _to_cnbc(symbol)}, headers=_UA, timeout=15)
        if not r.ok:
            _COOLDOWN["cnbc"] = time.time() + _CNBC_COOLDOWN
            return []
        bars = ((r.json().get("barData") or {}).get("priceBars")) or []
    except Exception:
        _COOLDOWN["cnbc"] = time.time() + _CNBC_COOLDOWN
        return []
    out = []
    for b in bars:
        try:
            close = float(b["close"])
        except (KeyError, TypeError, ValueError):
            continue
        ms = b.get("tradeTimeinMills")
        out.append({
            "time": datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d") if ms else None,
            "open": float(b["open"]) if b.get("open") else None,
            "high": float(b["high"]) if b.get("high") else None,
            "low": float(b["low"]) if b.get("low") else None,
            "close": close,
            "volume": b.get("volume"),
        })
    if out:
        _hist_cache[key] = (time.time(), out)
    return out


def _rapid_fetch(symbols: list[str]) -> dict[str, dict]:
    """RapidAPI /market/get-quotes für einen Block. Leeres dict bei Fehler/kein Key/Cool-down."""
    if not _RAPID_KEY or not symbols or time.time() < _COOLDOWN["rapid"]:
        return {}
    try:
        r = requests.get(
            f"https://{_RAPID_HOST}/market/get-quotes",
            params={"region": "US", "symbols": ",".join(symbols)},
            headers={"x-rapidapi-host": _RAPID_HOST, "x-rapidapi-key": _RAPID_KEY},
            timeout=15,
        )
        if r.status_code == 429:  # Monatskontingent erschöpft → lange Pause
            _COOLDOWN["rapid"] = time.time() + _RAPID_COOLDOWN
            return {}
        res = (r.json().get("quoteResponse") or {}).get("result") or []
    except Exception:
        return {}
    return _parse_quotes(res)


# ---- Fallback 1: Yahoo quote-API mit Cookie+Crumb (gratis, Batch wie RapidAPI) -----
_yq_lock = threading.Lock()
_yq: dict = {"sess": None, "crumb": "", "ts": 0.0}


def _yq_session(force: bool = False):
    """Session mit Yahoo-Cookie + Crumb, ~1 h wiederverwendet. (None, "") wenn nicht zu kriegen."""
    with _yq_lock:
        if not force and _yq["sess"] is not None and time.time() - _yq["ts"] < 3600:
            return _yq["sess"], _yq["crumb"]
        sess = requests.Session()
        sess.headers.update(_UA)
        try:
            _throttle()
            sess.get("https://fc.yahoo.com", timeout=10)  # setzt Cookie; Antwort selbst (404) egal
            _throttle()
            r = sess.get(f"https://{_HOSTS[0]}/v1/test/getcrumb", timeout=10)
            if r.status_code == 429:
                _COOLDOWN["yahoo"] = time.time() + _YAHOO_COOLDOWN
                return None, ""
            crumb = r.text.strip()
            if not r.ok or not crumb or "<" in crumb:
                return None, ""
        except Exception:
            return None, ""
        _yq.update(sess=sess, crumb=crumb, ts=time.time())
        return sess, crumb


def _yquote_fetch(symbols: list[str], _retry: bool = True) -> dict[str, dict]:
    """Yahoo /v7/finance/quote ohne Key. Leeres dict bei Drossel/Fehler/Cool-down."""
    if not symbols or time.time() < _COOLDOWN["yahoo"]:
        return {}
    sess, crumb = _yq_session()
    if sess is None:
        return {}
    _throttle()
    try:
        r = sess.get(f"https://{_HOSTS[0]}/v7/finance/quote",
                     params={"symbols": ",".join(symbols), "crumb": crumb}, timeout=12)
    except Exception:
        return {}
    if r.status_code in (401, 403) and _retry:  # Crumb abgelaufen → einmal neu aufbauen
        _yq_session(force=True)
        return _yquote_fetch(symbols, _retry=False)
    if r.status_code == 429:
        _COOLDOWN["yahoo"] = time.time() + _YAHOO_COOLDOWN
        return {}
    if not r.ok:
        return {}
    try:
        res = (r.json().get("quoteResponse") or {}).get("result") or []
    except ValueError:
        return {}
    return _parse_quotes(res)


# Indizes für den Tagesrückblick: USA / Europa / Hongkong.
INDICES: tuple[dict, ...] = (
    {"key": "spx", "name": "S&P 500", "symbol": "^GSPC", "region": "USA"},
    {"key": "ndx", "name": "Nasdaq", "symbol": "^IXIC", "region": "USA"},
    {"key": "dji", "name": "Dow Jones", "symbol": "^DJI", "region": "USA"},
    {"key": "dax", "name": "DAX", "symbol": "^GDAXI", "region": "Deutschland"},
    {"key": "sx5e", "name": "Euro Stoxx 50", "symbol": "^STOXX50E", "region": "Europa"},
    {"key": "hsi", "name": "Hang Seng", "symbol": "^HSI", "region": "Hongkong"},
)

# Sektoren über die SPDR-Select-Sector-ETFs — Tagesperformance je Sektor, ohne Screener-API.
SECTOR_ETFS: tuple[tuple[str, str], ...] = (
    ("XLK", "Technologie"),
    ("XLC", "Kommunikation"),
    ("XLY", "Zyklischer Konsum"),
    ("XLP", "Basiskonsum"),
    ("XLV", "Gesundheit"),
    ("XLF", "Finanzen"),
    ("XLI", "Industrie"),
    ("XLE", "Energie"),
    ("XLB", "Materialien"),
    ("XLU", "Versorger"),
    ("XLRE", "Immobilien"),
)

# Universum für die Bewegungs-Ranglisten: DAX 40 + US-Large-Caps.
DAX40: tuple[str, ...] = (
    "SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "AIR.DE", "MUV2.DE", "BAS.DE", "BMW.DE",
    "MBG.DE", "VOW3.DE", "IFX.DE", "ADS.DE", "BAYN.DE", "DBK.DE", "DB1.DE", "EOAN.DE",
    "RWE.DE", "MRK.DE", "HEN3.DE", "BEI.DE", "CBK.DE", "FRE.DE", "HNR1.DE", "SY1.DE",
    "VNA.DE", "ZAL.DE", "SHL.DE", "ENR.DE", "RHM.DE", "P911.DE", "PAH3.DE", "CON.DE",
    "HEI.DE", "QIA.DE", "SRT3.DE", "1COV.DE", "BNR.DE", "MTX.DE", "DHL.DE", "LIN.DE",
)
US_LARGE: tuple[str, ...] = (
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "LLY", "JPM",
    "XOM", "UNH", "V", "PG", "MA", "JNJ", "HD", "COST", "ABBV", "MRK",
    "WMT", "PEP", "KO", "ADBE", "CRM", "NFLX", "AMD", "TMO", "ACN", "MCD",
    "CSCO", "ABT", "WFC", "TXN", "QCOM", "VZ", "INTC", "CAT", "NEE", "PM",
    "IBM", "GE", "NOW", "SPGI", "UNP", "RTX", "LOW", "BA", "GS", "HON",
)

_cache: dict[str, tuple[float, dict]] = {}


def _chunks(items: tuple[str, ...] | list[str], size: int):
    for i in range(0, len(items), size):
        yield list(items[i:i + size])


# Durchsatz-Regler PRO QUELLE: Yahoo bannt bei Bursts hart (1,3 s Abstand nötig), CNBC ist
# viel toleranter (0,35 s reicht). Getrennte Locks → CNBC- und Yahoo-Calls bremsen sich
# nicht gegenseitig aus. Das ist der Haupt-Speedup: eine Aktienseite trifft fast nur CNBC.
_INTERVALS = {"cnbc": 0.35, "yahoo": 1.3}
_rate_locks = {"cnbc": threading.Lock(), "yahoo": threading.Lock()}
_last_call = {"cnbc": [0.0], "yahoo": [0.0]}


def _throttle(source: str = "yahoo"):
    lk = _rate_locks.get(source, _rate_locks["yahoo"])
    iv = _INTERVALS.get(source, 1.3)
    with lk:
        wait = iv - (time.time() - _last_call[source][0])
        if wait > 0:
            time.sleep(wait)
        _last_call[source][0] = time.time()


def _fetch(symbols: list[str]) -> list:
    """Ein spark-Request durch den Durchsatz-Regler. Bewusst OHNE Retry: Yahoo drosselt
    pro IP über ein Zeitfenster, und Wiederholungen bei HTTP 429 verlängern die Sperre nur.
    Fehlschlag → leer; der 300s-Cache und der nächste Refresh fangen das ab."""
    if time.time() < _COOLDOWN["yahoo"]:
        return []
    params = {"symbols": ",".join(symbols), "range": "1d", "interval": "1d"}
    _throttle()
    for host in _HOSTS:
        try:
            r = requests.get(f"https://{host}{_SPARK_PATH}", params=params,
                             headers=_UA, timeout=12)
        except Exception:
            continue
        if r.status_code == 200:
            try:
                return (r.json().get("spark") or {}).get("result") or []
            except ValueError:
                return []
        if r.status_code in (400, 429):
            if r.status_code == 429:  # gedrosselt → Quelle ruhen lassen statt nachbohren
                _COOLDOWN["yahoo"] = time.time() + _YAHOO_COOLDOWN
            return []
    return []


def _spark(symbols: list[str]) -> dict[str, dict]:
    """Ein spark-Request (≤20 Symbole). Fehler/fehlende Symbole werden still übersprungen."""
    if not symbols:
        return {}
    rows = _fetch(symbols)

    out: dict[str, dict] = {}
    for row in rows:
        try:
            m = row["response"][0]["meta"]
            price, prev = m.get("regularMarketPrice"), m.get("chartPreviousClose")
        except (KeyError, IndexError, TypeError):
            continue
        if not isinstance(price, (int, float)):
            continue
        chg = round((price - prev) / prev * 100, 2) if isinstance(prev, (int, float)) and prev else None
        sym = row.get("symbol") or m.get("symbol")
        out[sym] = {
            "symbol": sym,
            # shortName ist bei Xetra mit Kürzeln aufgefüllt ("SAP SE   I") → longName bevorzugen
            "name": (m.get("longName") or m.get("shortName") or sym).strip(),
            "price": price,
            "prev_close": prev,
            "change_pct": chg,
            "currency": m.get("currency"),
            "exchange": m.get("fullExchangeName"),
        }
    return out


def quotes(symbols: list[str]) -> dict[str, dict]:
    """Beliebig viele Symbole holen, vierstufig mit Fallback:
      1. RapidAPI (nur mit Key + Kontingent, Batch)
      2. CNBC (gratis, kein Key, Batch, kein IP-Limit-Problem) — Standard-Gratisquelle
      3. Yahoo quote-API mit Crumb (gratis, Batch)
      4. anonymes Yahoo spark (20er-Blöcke, stark gedrosselt)
    Was eine Stufe nicht liefert, versucht die nächste nachzuladen."""
    if not symbols:
        return {}
    merged: dict[str, dict] = {}

    if _RAPID_KEY:
        for block in _chunks(symbols, _RAPID_CHUNK):
            merged.update(_rapid_fetch(block))

    missing = [s for s in symbols if s not in merged]
    if missing:  # kein Key / Kontingent leer / einzelne fehlen → CNBC (gratis Batch)
        for block in _chunks(missing, _RAPID_CHUNK):
            merged.update(_cnbc_fetch(block))

    missing = [s for s in symbols if s not in merged]
    if missing:  # dann Yahoo crumb-quote
        for block in _chunks(missing, _RAPID_CHUNK):
            merged.update(_yquote_fetch(block))

    missing = [s for s in symbols if s not in merged]
    if missing:  # letzte Stufe: anonymes spark
        blocks = list(_chunks(missing, _SPARK_CHUNK))
        with ThreadPoolExecutor(max_workers=min(3, len(blocks))) as pool:
            for part in pool.map(_spark, blocks):
                merged.update(part)
    return merged


def _cached(key: str, build, is_empty) -> dict:
    """TTL-Cache mit stale-on-error: liefert Yahoo nichts (HTTP 429), bleibt der letzte
    bekannte Stand stehen, statt die Seite leerzuräumen."""
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    val = build()
    if is_empty(val):
        if hit:
            return hit[1]      # veraltet, aber besser als nichts
        return val             # nie erfolgreich geladen
    _cache[key] = (time.time(), val)
    return val


def _no_rows(v: dict) -> bool:
    return not v.get("rows")


def indices() -> list[dict]:
    """Index-Snapshot USA / Europa / Hongkong. Nicht lieferbare Indizes werden ausgelassen."""
    def build():
        q = quotes([i["symbol"] for i in INDICES])
        return {"rows": [
            {"key": i["key"], "name": i["name"], "region": i["region"],
             "price": q[i["symbol"]]["price"], "change_pct": q[i["symbol"]]["change_pct"]}
            for i in INDICES if i["symbol"] in q
        ]}
    return _cached("indices", build, _no_rows)["rows"]


def sectors() -> list[dict]:
    """Sektor-Tagesperformance über Select-Sector-ETFs, absteigend sortiert."""
    def build():
        q = quotes([e[0] for e in SECTOR_ETFS])
        rows = [{"symbol": sym, "name": name, "price": q[sym]["price"],
                 "change_pct": q[sym]["change_pct"]}
                for sym, name in SECTOR_ETFS if sym in q and q[sym]["change_pct"] is not None]
        rows.sort(key=lambda r: r["change_pct"], reverse=True)
        return {"rows": rows}
    return _cached("sectors", build, _no_rows)["rows"]


def movers(limit: int = 10) -> dict:
    """Größte Tagesgewinner/-verlierer aus DAX 40 + US-Large-Caps (objektive Rangliste)."""
    def build():
        q = quotes(list(DAX40 + US_LARGE))  # 90 Symbole = 3 RapidAPI-Calls (Batch)
        rows = [r for r in q.values() if r["change_pct"] is not None]
        rows.sort(key=lambda r: r["change_pct"], reverse=True)
        return {"universe": len(rows), "rows": rows}

    data = _cached("movers", build, _no_rows)
    rows = data.get("rows") or []
    return {
        "universe": data.get("universe", 0),
        "gainers": rows[:limit],
        "losers": list(reversed(rows[-limit:])) if rows else [],
    }


def _r(d: dict, key: str):
    """Yahoo-quoteSummary-Feld auslesen — Werte kommen als {raw, fmt} oder direkt."""
    v = d.get(key)
    if isinstance(v, dict):
        return v.get("raw")
    return v


_SUMMARY_MODULES = "financialData,summaryDetail,defaultKeyStatistics,calendarEvents"


def _summary_rapid(sym: str) -> dict | None:
    """quoteSummary via RapidAPI /stock/get-summary. None bei Fehler/kein Key/Cool-down."""
    if not _RAPID_KEY or time.time() < _COOLDOWN["rapid"]:
        return None
    try:
        r = requests.get(
            f"https://{_RAPID_HOST}/stock/get-summary",
            params={"symbol": sym, "region": "US"},
            headers={"x-rapidapi-host": _RAPID_HOST, "x-rapidapi-key": _RAPID_KEY},
            timeout=15,
        )
        if r.status_code == 429:
            _COOLDOWN["rapid"] = time.time() + _RAPID_COOLDOWN
            return None
        j = r.json()
    except Exception:
        return None
    return j if isinstance(j, dict) else None


def _summary_crumb(sym: str) -> dict | None:
    """quoteSummary direkt bei Yahoo (v10, Cookie+Crumb) — gleiche Modul-Struktur, die
    RapidAPI flach durchreicht. None bei Drossel/Fehler/Cool-down."""
    if time.time() < _COOLDOWN["yahoo"]:
        return None
    sess, crumb = _yq_session()
    if sess is None:
        return None
    _throttle()
    try:
        r = sess.get(
            f"https://{_HOSTS[0]}/v10/finance/quoteSummary/{sym}",
            params={"modules": _SUMMARY_MODULES, "crumb": crumb},
            timeout=15,
        )
    except Exception:
        return None
    if r.status_code == 429:
        _COOLDOWN["yahoo"] = time.time() + _YAHOO_COOLDOWN
        return None
    if not r.ok:
        return None
    try:
        res = (r.json().get("quoteSummary") or {}).get("result") or []
    except ValueError:
        return None
    return res[0] if res and isinstance(res[0], dict) else None


def fundamentals(symbol: str) -> dict:
    """Fundamental- + Risikodaten (Yahoo quoteSummary via /stock/get-summary): Bewertung,
    Profitabilität, Bilanz, Analysten, Dividende, nächster Earnings-Termin — plus eine
    objektive, regelbasierte Risiko-Ampel. {available: False} wenn nichts kommt."""
    sym = symbol.strip().upper()

    # US-Primaerquelle FMP zuerst; liefert available:False bei Nicht-US/Fehler,
    # dann faellt es unten auf die bestehende Yahoo/CNBC-Kette zurueck.
    if _fmp is not None and _fmp.enabled():
        try:
            fm = _fmp.fundamentals(sym)
            if fm.get("available"):
                return fm
        except Exception:
            pass

    def _ok(x):
        return isinstance(x, dict) and ("financialData" in x or "summaryDetail" in x)

    j = _summary_rapid(sym)
    if not _ok(j):
        # RapidAPI leer → erst CNBC (gratis, ohne Yahoo-Ping — hält die Yahoo-Sperre nicht warm),
        # Yahoo-crumb nur als letzte Stufe, wenn CNBC nichts hat.
        cnbc = _cnbc_fundamentals(sym)
        if cnbc.get("available"):
            return cnbc
        j = _summary_crumb(sym)
        if not _ok(j):
            return {"available": False}

    fd = j.get("financialData", {}) or {}
    sd = j.get("summaryDetail", {}) or {}
    ks = j.get("defaultKeyStatistics", {}) or {}
    ce = (j.get("calendarEvents", {}) or {}).get("earnings", {}) or {}

    price = _r(fd, "currentPrice")
    w52_high = _r(sd, "fiftyTwoWeekHigh")
    target = _r(fd, "targetMeanPrice")
    dte = _r(fd, "debtToEquity")
    cr = _r(fd, "currentRatio")
    beta = _r(sd, "beta") or _r(ks, "beta")
    fpe = _r(sd, "forwardPE")
    peg = _r(ks, "pegRatio")
    eg = _r(fd, "earningsGrowth")
    dy = _r(sd, "dividendYield")

    def pctify(x):
        return round(x * 100, 2) if isinstance(x, (int, float)) else None

    # Earnings-Termin (Unix → ISO-Datum)
    edates = ce.get("earningsDate") or []
    next_earn = None
    if edates:
        try:
            next_earn = datetime.fromtimestamp(edates[0], timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            next_earn = None

    # --- Risiko-Ampel: objektive Schwellen, jede Flag mit Wert ---
    flags = []
    def flag(cond, sev, text):
        if cond:
            flags.append({"severity": sev, "text": text})

    flag(isinstance(fpe, (int, float)) and fpe > 30, "warn", f"Hohe Bewertung: Forward-KGV {round(fpe, 1)}")
    flag(isinstance(peg, (int, float)) and peg > 2, "warn", f"PEG {round(peg, 2)} > 2 — Wachstum teuer bezahlt")
    flag(isinstance(dte, (int, float)) and dte > 100, "high", f"Hohe Verschuldung: Debt/Equity {round(dte, 0)}")
    flag(isinstance(cr, (int, float)) and cr < 1, "high", f"Dünne Liquidität: Current Ratio {round(cr, 2)}")
    flag(isinstance(beta, (int, float)) and beta > 1.3, "warn", f"Hohe Marktsensitivität: Beta {round(beta, 2)}")
    flag(isinstance(eg, (int, float)) and eg < 0, "high", f"Gewinne rückläufig: {pctify(eg)}%")
    flag(isinstance(price, (int, float)) and isinstance(target, (int, float)) and target and price > target,
         "warn", "Kurs über dem durchschnittlichen Analysten-Kursziel")
    flag(isinstance(price, (int, float)) and isinstance(w52_high, (int, float)) and w52_high and price >= 0.97 * w52_high,
         "warn", "Nahe 52-Wochen-Hoch")
    flag(isinstance(dy, (int, float)) and dy > 0.08, "warn", f"Auffällig hohe Dividendenrendite {pctify(dy)}% (Ausschüttungsrisiko)")

    return {
        "available": True,
        "symbol": sym,
        "valuation": {
            "pe": _r(sd, "trailingPE"), "forward_pe": fpe, "peg": peg,
            "price_to_book": _r(ks, "priceToBook"), "ev_ebitda": _r(ks, "enterpriseToEbitda"),
        },
        "profitability": {
            "roe": pctify(_r(fd, "returnOnEquity")), "roa": pctify(_r(fd, "returnOnAssets")),
            "gross_margin": pctify(_r(fd, "grossMargins")), "operating_margin": pctify(_r(fd, "operatingMargins")),
            "profit_margin": pctify(_r(fd, "profitMargins")),
            "revenue_growth": pctify(_r(fd, "revenueGrowth")), "earnings_growth": pctify(eg),
        },
        "balance": {
            "debt_to_equity": dte, "current_ratio": cr,
            "total_cash": _r(fd, "totalCash"), "free_cashflow": _r(fd, "freeCashflow"),
        },
        "analyst": {
            "recommendation": _r(fd, "recommendationKey"), "count": _r(fd, "numberOfAnalystOpinions"),
            "target_mean": target, "target_high": _r(fd, "targetHighPrice"), "target_low": _r(fd, "targetLowPrice"),
            "price": price,
        },
        "dividend": {"yield": pctify(dy), "payout": pctify(_r(sd, "payoutRatio"))},
        "risk": {"beta": beta, "flags": flags},
        "next_earnings": next_earn,
        "disclaimer": "Objektive Fundamentaldaten (Yahoo). Risiko-Ampel = mechanische Schwellenwerte, keine Empfehlung.",
    }


def _parse_search_quotes(rows: list, limit: int) -> list[dict]:
    """Yahoo-quotes[] (RapidAPI /search und Yahoo /v1/finance/search identisch) → Trefferliste."""
    out = []
    for x in rows:
        sym = x.get("symbol")
        if not sym or x.get("quoteType") not in ("EQUITY", "ETF", "INDEX"):
            continue
        # Xetra-Namen mit angehängten Kürzeln säubern ("SAP SE   I" → "SAP SE")
        name = " ".join((x.get("longname") or x.get("shortname") or sym).split())
        out.append({
            "symbol": sym,
            "name": name,
            "exchange": x.get("exchDisp") or x.get("exchange"),
            "type": x.get("quoteType"),
        })
        if len(out) >= limit:
            break
    return out


def _rapid_search(q: str, limit: int) -> list[dict]:
    """RapidAPI /search. Leer bei Fehler/kein Key/Cool-down."""
    if not _RAPID_KEY or time.time() < _COOLDOWN["rapid"]:
        return []
    try:
        r = requests.get(
            f"https://{_RAPID_HOST}/search",
            params={"query": q},
            headers={"x-rapidapi-host": _RAPID_HOST, "x-rapidapi-key": _RAPID_KEY},
            timeout=12,
        )
        if r.status_code == 429:
            _COOLDOWN["rapid"] = time.time() + _RAPID_COOLDOWN
            return []
        rows = r.json().get("quotes") or []
    except Exception:
        return []
    return _parse_search_quotes(rows, limit)


def _yahoo_search(q: str, limit: int) -> list[dict]:
    """Yahoo /v1/finance/search mit Cookie+Crumb (gratis, alle Märkte inkl. Xetra/HK/ISIN).
    Leer bei Drossel/Fehler/Cool-down."""
    if time.time() < _COOLDOWN["yahoo"]:
        return []
    sess, crumb = _yq_session()
    if sess is None:
        return []
    _throttle()
    try:
        r = sess.get(f"https://{_HOSTS[0]}/v1/finance/search",
                     params={"q": q, "quotesCount": max(limit, 10), "newsCount": 0, "crumb": crumb},
                     timeout=12)
    except Exception:
        return []
    if r.status_code == 429:
        _COOLDOWN["yahoo"] = time.time() + _YAHOO_COOLDOWN
        return []
    if not r.ok:
        return []
    try:
        rows = r.json().get("quotes") or []
    except ValueError:
        return []
    return _parse_search_quotes(rows, limit)


def _nasdaq_search(q: str, limit: int) -> list[dict]:
    """Nasdaq-Autocomplete (gratis, ohne Key) — nur US-Listings (Xetra/HK nicht enthalten).
    US-Fallback, wenn Yahoo gedrosselt ist. Leer bei Fehler."""
    try:
        r = requests.get("https://api.nasdaq.com/api/autocomplete/slookup/10",
                         params={"exchange": "", "search": q}, headers=_UA, timeout=12)
        rows = (r.json().get("data") or []) if r.ok else []
    except Exception:
        return []
    _TYPE = {"STOCKS": "EQUITY", "ETF": "ETF", "INDEX": "INDEX"}
    out = []
    for x in rows:
        asset = x.get("asset")
        sym = x.get("symbol")
        if not sym or asset not in _TYPE:
            continue
        out.append({
            "symbol": sym,
            "name": " ".join((x.get("name") or sym).split()),
            "exchange": x.get("exchange") or None,
            "type": _TYPE[asset],
        })
        if len(out) >= limit:
            break
    return out


def search(query: str, limit: int = 10) -> list[dict]:
    """Aktiensuche über Name / Ticker / ISIN → Symbole, dreistufig:
      1. RapidAPI /search (mit Key, alle Märkte)
      2. Yahoo /v1/finance/search mit Crumb (gratis, alle Märkte inkl. Xetra/HK/ISIN)
      3. Nasdaq-Autocomplete (gratis, nur US) — Fallback wenn Yahoo gedrosselt
    Nur Aktien / ETF / Index. Direkteingabe eines Symbols (AAPL / SAP.DE / 0700.HK)
    funktioniert immer, auch wenn keine Such-Stufe antwortet."""
    q = query.strip()
    if not q:
        return []
    return (_rapid_search(q, limit)
            or _yahoo_search(q, limit)
            or _nasdaq_search(q, limit))


def stale_age() -> float | None:
    """Alter des ältesten gecachten Blocks in Sekunden (None = noch nichts geladen).
    Die UI kann damit kennzeichnen, dass Yahoo gerade drosselt."""
    if not _cache:
        return None
    return round(time.time() - min(ts for ts, _ in _cache.values()), 1)


# Reguläre Handelszeiten (Ortszeit) der drei abgedeckten Börsen. Ohne Feiertagskalender —
# an Feiertagen zeigt es fälschlich "offen"; daher in der UI als "Handelszeit" gelabelt,
# nicht als harte Echtzeit-Aussage. Lunch-Pausen (HK 12–13 Uhr) werden ignoriert.
_MARKETS = (
    {"key": "us", "name": "USA",       "tz": "America/New_York", "open": (9, 30), "close": (16, 0)},
    {"key": "de", "name": "Xetra",     "tz": "Europe/Berlin",    "open": (9, 0),  "close": (17, 30)},
    {"key": "hk", "name": "Hongkong",  "tz": "Asia/Hong_Kong",   "open": (9, 30), "close": (16, 0)},
)


def market_status() -> list[dict]:
    """Für jede Börse: offen/geschlossen nach regulärer Handelszeit (Wochentag + Ortszeit),
    plus lokale Uhrzeit. Feiertage nicht berücksichtigt."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    out = []
    for m in _MARKETS:
        now = datetime.now(ZoneInfo(m["tz"]))
        minutes = now.hour * 60 + now.minute
        o = m["open"][0] * 60 + m["open"][1]
        c = m["close"][0] * 60 + m["close"][1]
        is_open = now.weekday() < 5 and o <= minutes < c
        out.append({
            "key": m["key"], "name": m["name"], "open": is_open,
            "local_time": now.strftime("%H:%M"),
            "hours": f"{m['open'][0]:02d}:{m['open'][1]:02d}–{m['close'][0]:02d}:{m['close'][1]:02d}",
        })
    return out


def stock(symbol: str) -> dict:
    """Einzelaktie US/EU/HK mit erweiterten Feldern (Kurs, OHLC, Marktkap., KGV, EPS,
    52-Wochen-Spanne). Über RapidAPI vollständig; ohne Key nur die spark-Basisfelder.
    Leeres dict, wenn das Symbol unbekannt ist."""
    sym = symbol.strip().upper()

    if _RAPID_KEY:
        try:
            r = requests.get(
                f"https://{_RAPID_HOST}/market/get-quotes",
                params={"region": "US", "symbols": sym},
                headers={"x-rapidapi-host": _RAPID_HOST, "x-rapidapi-key": _RAPID_KEY},
                timeout=15,
            )
            res = (r.json().get("quoteResponse") or {}).get("result") or []
        except Exception:
            res = []
        if res:
            q = res[0]
            price = q.get("regularMarketPrice")
            if isinstance(price, (int, float)):
                chg = q.get("regularMarketChangePercent")
                return {
                    "symbol": q.get("symbol", sym),
                    "name": (q.get("longName") or q.get("shortName") or sym).strip(),
                    "price": price,
                    "prev_close": q.get("regularMarketPreviousClose"),
                    "change_pct": round(chg, 2) if isinstance(chg, (int, float)) else None,
                    "open": q.get("regularMarketOpen"),
                    "high": q.get("regularMarketDayHigh"),
                    "low": q.get("regularMarketDayLow"),
                    "volume": q.get("regularMarketVolume"),
                    "mcap": q.get("marketCap"),
                    "pe": q.get("trailingPE"),
                    "forward_pe": q.get("forwardPE"),
                    "eps": q.get("epsTrailingTwelveMonths"),
                    "week52_high": q.get("fiftyTwoWeekHigh"),
                    "week52_low": q.get("fiftyTwoWeekLow"),
                    "currency": q.get("currency"),
                    "exchange": q.get("fullExchangeName"),
                    "quote_type": q.get("quoteType"),
                }

    # Fallback ohne Key / bei leerem RapidAPI-Kontingent: CNBC (reiche Detailfelder, gratis)
    d = _cnbc_detail(sym)
    if d:
        return d

    # letzte Stufe: spark-Basis (nur Kurs/Vortagesschluss)
    basic = quotes([sym])
    return next(iter(basic.values()), {})
