"""Universe-Screener — rankt ein ganzes Aktienuniversum nach dem Faktor-Modell (strategy.py).

Wie ein Quant-Desk: statt eine Aktie zu analysieren, das gesamte Universum (US-Large-Caps
oder DAX 40) nach dem Composite-Score sortieren → Top-Long-/Top-Short-Kandidaten auf einen
Blick. Rein mechanisch, transparente Regeln, keine Empfehlung.

Da strategy.analyze() je Symbol Fundamentaldaten + Kurshistorie zieht (und der globale
Durchsatz-Regler diese Calls serialisiert), läuft die Berechnung im Hintergrund-Thread mit
Cache — Fundamentaldaten ändern sich intraday kaum. Der Endpoint liefert sofort den letzten
Stand plus Fortschritt (done/total); die UI pollt, bis fertig.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime

import momentum
import strategy
import wstock

UNIVERSES: dict[str, tuple[str, list[str]]] = {
    "us": ("US-Large-Caps", list(wstock.US_LARGE)),
    "dax": ("DAX 40", list(wstock.DAX40)),
}

_TTL = 1800.0          # 30 Min Cache je Universum
_lock = threading.Lock()
_state: dict[str, dict] = {}   # universe -> {ts, rows, computing, done, total}


def _row(sym: str, st: dict, q: dict, mom: dict) -> dict:
    return {
        "symbol": sym,
        "name": (q.get("name") or sym),
        "price": q.get("price"),
        "change_pct": q.get("change_pct"),
        "currency": q.get("currency"),
        "signal": st.get("signal"),
        "composite": st.get("composite"),
        "conviction": st.get("conviction"),
        "archetype": st.get("archetype"),
        "factors": {f["key"]: f["score"] for f in st.get("factors", [])},
        # Momentum-Block: Relativstärke, 52W-Hoch-Nähe, relatives Volumen, Momentum-Score
        "mom_score": mom.get("score"),
        "rs_3m": mom.get("rs_3m"),
        "pct_from_high": mom.get("pct_from_high"),
        "breakout": mom.get("breakout"),
        "rel_volume": mom.get("rel_volume"),
    }


def _compute(universe: str, symbols: list[str]) -> None:
    # Namen/Kurse als günstiger Batch vorab (spart je-Symbol-Calls).
    try:
        quotes = wstock.quotes(symbols)
    except Exception:
        quotes = {}
    rows = []
    for i, sym in enumerate(symbols):
        try:
            st = strategy.analyze(sym)
        except Exception:
            st = {"available": False}
        if st.get("available") and st.get("composite") is not None:
            try:
                mom = momentum.metrics(sym)   # nutzt gecachte Historie (strategy hat sie schon geladen)
            except Exception:
                mom = {}
            rows.append(_row(sym, st, quotes.get(sym, {}), mom))
        with _lock:
            if universe in _state:
                _state[universe]["done"] = i + 1
    rows.sort(key=lambda r: -(r["composite"] or 0))
    with _lock:
        _state[universe] = {"ts": time.time(), "rows": rows, "computing": False,
                            "done": len(symbols), "total": len(symbols)}


def get(universe: str, force: bool = False) -> dict:
    """Aktuelles Ranking + Fortschritt. Startet bei stale/fehlend eine Hintergrund-Berechnung."""
    universe = universe if universe in UNIVERSES else "us"
    name, symbols = UNIVERSES[universe]

    with _lock:
        s = _state.get(universe)
        fresh = bool(s) and not s["computing"] and (time.time() - s["ts"] < _TTL)
        if fresh and not force:
            out = dict(s)
        else:
            if not s or not s["computing"]:
                _state[universe] = {
                    "ts": (s["ts"] if s else 0.0),
                    "rows": (s["rows"] if s else []),
                    "computing": True, "done": 0, "total": len(symbols),
                }
                threading.Thread(target=_compute, args=(universe, symbols), daemon=True).start()
            out = dict(_state[universe])

    computed_at = datetime.fromtimestamp(out["ts"]).strftime("%Y-%m-%d %H:%M") if out.get("ts") else None
    return {
        "universe": universe, "name": name,
        "rows": out.get("rows", []),
        "computing": out.get("computing", False),
        "done": out.get("done", 0), "total": out.get("total", len(symbols)),
        "computed_at": computed_at,
        "disclaimer": "Mechanisches Faktor-Ranking (Value/Quality/Health/Momentum) über ein "
                      "festes Universum. Keine Empfehlung, keine Prognose — objektive Regelausgabe.",
    }
