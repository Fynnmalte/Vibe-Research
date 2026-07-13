"""Quant-Analyse: technische Indikatoren + transparente Faktor-Scorecard.

Ehrlichkeitsprinzip: KEINE „Vorhersage" — nur objektive, nachvollziehbare Kennzahlen aus echten
Kursdaten. Indikatoren via `ta` (bukosabino/ta, MIT). Die Scorecard ist eine mechanische
Einordnung mit offengelegten Treibern; sie ist KEINE Kauf/Verkauf-Empfehlung.

Kurshistorie über denselben RapidAPI-Anbieter (/stock/get-chart). 1 Jahr Tagesdaten reichen für
SMA200, RSI, MACD, Momentum und Volatilität.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
import requests
import ta

import wstock

_HOST = os.environ.get("YH_RAPIDAPI_HOST", "yahoo-finance-real-time1.p.rapidapi.com").strip()
_KEY = os.environ.get("YH_RAPIDAPI_KEY", "").strip()


def _history(symbol: str, rng: str = "1y") -> pd.Series | None:
    """Tages-Schlusskurse als pandas-Series (Index = fortlaufend). None bei Fehler.
    Erst RapidAPI (mit Key), sonst CNBC-Gratishistorie über wstock."""
    closes = None
    if _KEY:
        try:
            r = requests.get(
                f"https://{_HOST}/stock/get-chart",
                params={"symbol": symbol, "range": rng, "interval": "1d", "region": "US"},
                headers={"x-rapidapi-host": _HOST, "x-rapidapi-key": _KEY},
                timeout=15,
            )
            res = r.json()["chart"]["result"][0]
            closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
        except Exception:
            closes = None
    if not closes:  # kein Key / leeres Kontingent / Fehler → CNBC
        closes = [b["close"] for b in wstock.cnbc_history(symbol, "1Y")]
    s = pd.Series(closes, dtype="float64")
    return s if len(s) >= 30 else None


def _ret(s: pd.Series, days: int):
    """Rendite über die letzten `days` Handelstage in Prozent."""
    if len(s) <= days:
        return None
    old = s.iloc[-days - 1]
    return round((s.iloc[-1] / old - 1) * 100, 2) if old else None


def _last(series) -> float | None:
    try:
        v = float(series.iloc[-1])
        return round(v, 2) if np.isfinite(v) else None
    except Exception:
        return None


def _clamp(x: float) -> int:
    return int(max(0, min(100, round(x))))


def analyze(symbol: str) -> dict:
    """Indikatoren + Faktor-Scorecard für ein Symbol. {available: False} wenn keine Historie."""
    sym = symbol.strip().upper()
    s = _history(sym)
    if s is None:
        return {"available": False}

    close = s.reset_index(drop=True)
    price = float(close.iloc[-1])

    # --- Technische Indikatoren (ta) ---
    rsi = _last(ta.momentum.RSIIndicator(close, window=14).rsi())
    macd_obj = ta.trend.MACD(close)
    macd = _last(macd_obj.macd())
    macd_sig = _last(macd_obj.macd_signal())
    macd_hist = _last(macd_obj.macd_diff())
    sma20 = _last(ta.trend.SMAIndicator(close, window=20).sma_indicator())
    sma50 = _last(ta.trend.SMAIndicator(close, window=50).sma_indicator())
    sma200 = _last(ta.trend.SMAIndicator(close, window=200).sma_indicator()) if len(close) >= 200 else None

    daily_ret = close.pct_change().dropna()
    vol_annual = round(float(daily_ret.std() * np.sqrt(252) * 100), 1) if len(daily_ret) > 5 else None
    ret_1m, ret_3m, ret_6m = _ret(close, 21), _ret(close, 63), _ret(close, 126)

    rsi_state = ("überkauft" if rsi and rsi >= 70 else "überverkauft" if rsi and rsi <= 30 else "neutral")

    # --- Faktor-Scorecard (0–100, offengelegte Treiber) ---
    stock = {}
    try:
        stock = wstock.stock(sym)
    except Exception:
        stock = {}
    fpe = stock.get("forward_pe") or stock.get("pe")

    # Momentum: 3M-Rendite auf 0–100 abgebildet (−20% → 0, +20% → 100).
    mom_score = _clamp(50 + (ret_3m or 0) * 2.5)
    # Trend: Lage zu SMA50/SMA200 (jeweils darüber = +25), plus MACD-Vorzeichen.
    trend = 50
    if sma50 and price > sma50:
        trend += 20
    if sma200 and price > sma200:
        trend += 20
    if macd_hist is not None:
        trend += 10 if macd_hist > 0 else -10
    trend_score = _clamp(trend)
    # Value: absolute Forward-KGV-Bänder (<15 günstig → 100, >40 teuer → 0). Grob, bewusst transparent.
    if fpe and fpe > 0:
        val_score = _clamp(100 - (fpe - 15) * (100 / 25))
    else:
        val_score = None

    parts = [p for p in (mom_score, trend_score, val_score) if p is not None]
    overall = _clamp(sum(parts) / len(parts)) if parts else None

    return {
        "available": True,
        "symbol": sym,
        "points": len(close),
        "indicators": {
            "rsi14": rsi, "rsi_state": rsi_state,
            "macd": macd, "macd_signal": macd_sig, "macd_hist": macd_hist,
            "sma20": sma20, "sma50": sma50, "sma200": sma200,
            "ret_1m": ret_1m, "ret_3m": ret_3m, "ret_6m": ret_6m,
            "volatility": vol_annual,
        },
        "factors": {
            "momentum": {"score": mom_score, "driver": f"3M-Rendite {ret_3m if ret_3m is not None else '—'}%"},
            "trend": {"score": trend_score, "driver": f"Kurs {'über' if sma50 and price > sma50 else 'unter'} SMA50, "
                                                       f"{'über' if sma200 and price > sma200 else 'unter/—'} SMA200"},
            "value": {"score": val_score, "driver": f"Forward-KGV {round(fpe, 1) if fpe else '—'}"} if val_score is not None
                     else {"score": None, "driver": "Forward-KGV fehlt"},
            "overall": overall,
        },
        "disclaimer": "Mechanische Einordnung aus objektiven Kursdaten. Keine Prognose, keine Empfehlung.",
    }
