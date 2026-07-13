"""Backtesting-Lab: transparente Regel-Strategien auf echter Kurshistorie.

Ehrlichkeitsprinzip (wie quant.py): keine überangepasste Blackbox, keine Live-Signale — nur
nachvollziehbare, klassische Regeln, historisch getestet, immer mit „Buy & Hold" als Referenz.

Eigene, schlanke Backtest-Engine (pandas/numpy) — bewusst KEINE AGPL-Bibliothek, damit das Tool
frei weitergegeben/gehostet werden kann. Long-only, all-in/all-out, mit Kommission. Signale
werden um einen Tag verzögert ausgeführt (kein Look-ahead). Kurshistorie über denselben
RapidAPI-Anbieter wie quant.py (/stock/get-chart, 2 Jahre Tagesdaten).

Compliance: Strategie-Backtest zu Bildungs-/Analysezwecken. Vergangene Performance ≠ Zukunft,
keine Empfehlung, kein Timing-Signal.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
import requests

import wstock

_HOST = os.environ.get("YH_RAPIDAPI_HOST", "yahoo-finance-real-time1.p.rapidapi.com").strip()
_KEY = os.environ.get("YH_RAPIDAPI_KEY", "").strip()
_CASH = 10_000.0
_COMMISSION = 0.001  # 0,1 % je Positionswechsel


def _closes(symbol: str, rng: str = "2y") -> pd.Series | None:
    """Tages-Schlusskurse mit Datumsindex. Erst RapidAPI (mit Key), sonst CNBC-Gratishistorie."""
    if _KEY:
        try:
            r = requests.get(
                f"https://{_HOST}/stock/get-chart",
                params={"symbol": symbol, "range": rng, "interval": "1d", "region": "US"},
                headers={"x-rapidapi-host": _HOST, "x-rapidapi-key": _KEY},
                timeout=15,
            )
            res = r.json()["chart"]["result"][0]
            ts = res["timestamp"]
            closes = res["indicators"]["quote"][0]["close"]
            s = pd.Series(closes, index=pd.to_datetime(ts, unit="s")).dropna()
            if len(s) >= 60:
                return s
        except Exception:
            pass
    # kein Key / leeres Kontingent / Fehler → CNBC-Gratishistorie
    bars = wstock.cnbc_history(symbol, "6M")  # liefert hier ~2 Jahre Tagesbars
    if not bars:
        return None
    s = pd.Series([b["close"] for b in bars],
                  index=pd.to_datetime([b["time"] for b in bars])).dropna()
    return s if len(s) >= 60 else None


def _sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def _rsi(s: pd.Series, n: int = 14) -> pd.Series:
    delta = s.diff()
    up = delta.clip(lower=0).rolling(n).mean()
    down = -delta.clip(upper=0).rolling(n).mean()
    rs = up / down.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def _positions(close: pd.Series, strategy: str, p: dict) -> pd.Series:
    """Boolesche Positionsreihe (1 = investiert). Vor der Ausführung um 1 Tag verzögert."""
    if strategy == "sma_cross":
        fast, slow = int(p.get("fast", 20)), int(p.get("slow", 50))
        pos = (_sma(close, fast) > _sma(close, slow)).astype(float)
    elif strategy == "momentum":
        w = int(p.get("window", 100))
        pos = (close > _sma(close, w)).astype(float)
    elif strategy == "rsi":
        window, low, high = int(p.get("window", 14)), float(p.get("low", 30)), float(p.get("high", 55))
        rsi = _rsi(close, window)
        pos = np.zeros(len(close))
        holding = False
        for i, v in enumerate(rsi.to_numpy()):
            if np.isnan(v):
                pos[i] = 0.0
                continue
            if not holding and v < low:
                holding = True
            elif holding and v > high:
                holding = False
            pos[i] = 1.0 if holding else 0.0
        pos = pd.Series(pos, index=close.index)
    else:
        pos = pd.Series(0.0, index=close.index)
    return pos.fillna(0.0).shift(1).fillna(0.0)  # verzögerte Ausführung


def strategies_catalog() -> list[dict]:
    return [
        {"key": "sma_cross", "name": "SMA-Crossover", "params": {"fast": 20, "slow": 50},
         "desc": "Kauf wenn schneller Durchschnitt den langsamen von unten kreuzt."},
        {"key": "rsi", "name": "RSI-Reversion", "params": {"window": 14, "low": 30, "high": 55},
         "desc": "Kauf bei überverkauftem RSI, Verkauf bei Erholung."},
        {"key": "momentum", "name": "Momentum-Trendfilter", "params": {"window": 100},
         "desc": "Investiert nur, solange der Kurs über seinem Langfrist-Durchschnitt liegt."},
    ]


def run(symbol: str, strategy: str, params: dict | None = None) -> dict:
    sym = symbol.strip().upper()
    if strategy not in ("sma_cross", "rsi", "momentum"):
        return {"available": False, "error": "Unbekannte Strategie"}
    close = _closes(sym)
    if close is None:
        return {"available": False, "error": "Keine Historie"}

    p = params or {}
    pos = _positions(close, strategy, p)

    daily = close.pct_change().fillna(0.0)
    strat_ret = pos * daily
    # Kommission an jedem Positionswechsel abziehen.
    switches = pos.diff().abs().fillna(0.0)
    strat_ret = strat_ret - switches * _COMMISSION

    equity = _CASH * (1 + strat_ret).cumprod()
    bh = _CASH * (close / close.iloc[0])

    # Kennzahlen
    n = len(close)
    total_ret = (equity.iloc[-1] / _CASH - 1) * 100
    bh_ret = (bh.iloc[-1] / _CASH - 1) * 100
    cagr = ((equity.iloc[-1] / _CASH) ** (252 / n) - 1) * 100 if n > 0 else None
    sd = strat_ret.std()
    sharpe = (strat_ret.mean() / sd * np.sqrt(252)) if sd and sd > 0 else None
    dd = (equity / equity.cummax() - 1).min() * 100
    exposure = pos.mean() * 100

    # Trades: 0→1 = Einstieg, 1→0 = Ausstieg; Trefferquote je abgeschlossenem Trade.
    trades, wins, entry_price = 0, 0, None
    pa = pos.to_numpy()
    ca = close.to_numpy()
    for i in range(1, len(pa)):
        if pa[i] > pa[i - 1]:            # Einstieg
            entry_price = ca[i]; trades += 1
        elif pa[i] < pa[i - 1] and entry_price is not None:  # Ausstieg
            if ca[i] > entry_price * (1 + 2 * _COMMISSION):
                wins += 1
            entry_price = None
    win_rate = (wins / trades * 100) if trades else None

    step = max(1, n // 80)
    curve = [round(float(x), 2) for x in equity.iloc[::step]]
    bh_curve = [round(float(x), 2) for x in bh.iloc[::step]]

    def rnd(x):
        return round(float(x), 2) if x is not None and np.isfinite(float(x)) else None

    return {
        "available": True,
        "symbol": sym, "strategy": strategy,
        "strategy_name": next((s["name"] for s in strategies_catalog() if s["key"] == strategy), strategy),
        "params": {k: int(v) for k, v in p.items() if str(v).lstrip("-").isdigit()},
        "from": str(close.index[0].date()), "to": str(close.index[-1].date()),
        "return_pct": rnd(total_ret), "buyhold_pct": rnd(bh_ret), "cagr_pct": rnd(cagr),
        "sharpe": rnd(sharpe), "max_drawdown_pct": rnd(dd), "win_rate_pct": rnd(win_rate),
        "trades": trades, "exposure_pct": rnd(exposure),
        "equity_curve": curve, "buyhold_curve": bh_curve,
        "disclaimer": "Historischer Regel-Backtest zu Analysezwecken. Vergangene Performance ≠ Zukunft, keine Empfehlung.",
    }
