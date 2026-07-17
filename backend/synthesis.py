"""Synthese / Gesamtbild — bringt die Einzelsignale mechanisch zu EINEM Fazit zusammen.

Das Dashboard liefert viele lose Kennzahlen (Faktor-Modell, Quant, Alt-Data, Bilanz-Scores).
Dieses Modul verdichtet sie regelbasiert zu:
  • einer Signal-Matrix (jede Dimension bullisch / neutral / bärisch),
  • erkannten DIVERGENZEN (z. B. bullische Optionen ↔ Insider-Verkäufe),
  • einer Setup-Klassifikation (Momentum-Long / Konsolidierung / Squeeze / Distress …),
  • einem kurzen Fazit-Satz und einem Gesamt-Lean.

Alles instant und rein mechanisch — keine KI, kein Warten. Die KI bleibt für das, was Regeln
nicht können: aktuelle Nachrichten & Katalysatoren. Objektiv, keine Empfehlung/Prognose.
"""

from __future__ import annotations

import altdata
import momentum as momentum_mod
import quant
import scores as scores_mod
import strategy


def _state(v, hi, lo):
    if v is None:
        return None
    return "bull" if v >= hi else ("bear" if v <= lo else "neutral")


def _fac(st: dict, key: str):
    for f in st.get("factors", []):
        if f["key"] == key:
            return f["score"]
    return None


def analyze(symbol: str) -> dict:
    sym = symbol.strip().upper()
    st = strategy.analyze(sym)
    if not st.get("available"):
        return {"available": False}
    q = quant.analyze(sym)
    qi = q.get("indicators", {}) if q.get("available") else {}
    qf = q.get("factors", {}) if q.get("available") else {}
    alt = altdata.summary(sym)
    sc = scores_mod.analyze(sym)
    mo = momentum_mod.metrics(sym)

    val = _fac(st, "value"); qual = _fac(st, "quality"); health = _fac(st, "health"); mom = _fac(st, "momentum")
    trend = qf.get("trend", {}).get("score")
    rsi = qi.get("rsi14"); macd = qi.get("macd_hist"); ret3 = qi.get("ret_3m"); vol = qi.get("volatility")

    # Kurzfrist-Momentum aus RSI + MACD
    kf = None
    if macd is not None and rsi is not None:
        if macd > 0 and 45 <= rsi <= 72:
            kf = "bull"
        elif macd < 0 or rsi >= 75 or rsi <= 35:
            kf = "bear" if (macd is not None and macd < 0) else "neutral"
        else:
            kf = "neutral"

    ins = alt.get("insider", {}) if alt.get("available") else {}
    sho = alt.get("short", {}) if alt.get("available") else {}
    opt = alt.get("options", {}) if alt.get("available") else {}
    net = ins.get("net_value")
    short_ratio = sho.get("short_ratio")
    pc = opt.get("pc_oi_ratio")
    pio = (sc.get("piotroski") or {}).get("score") if sc.get("available") else None
    altman_zone = (sc.get("altman") or {}).get("zone") if sc.get("available") else None

    # --- Signal-Matrix ---
    signals = []
    def sig(name, state, detail):
        if state is not None:
            signals.append({"name": name, "state": state, "detail": detail})

    sig("Trend (langfristig)", _state(trend, 65, 40), qf.get("trend", {}).get("driver", ""))
    sig("Momentum (kurzfristig)", kf, f"RSI {rsi}, MACD-Hist {macd}" if rsi is not None else "")
    sig("Bewertung", _state(val, 60, 30), f"Value-Score {val}")
    sig("Qualität", _state(qual, 65, 30), f"Quality-Score {qual}" + (f", Piotroski {pio}/9" if pio is not None else ""))
    sig("Bilanz-Sicherheit", "bear" if altman_zone == "distress" else _state(health, 60, 30),
        (f"Altman {altman_zone}" if altman_zone else f"Health-Score {health}"))
    if net is not None:
        sig("Insider (SEC)", "bull" if net > 0 else ("bear" if net < 0 else "neutral"),
            f"netto {'+' if net>0 else ''}{round(net/1e6,1)} Mio.")
    if pc is not None:
        sig("Optionen (Put/Call)", "bull" if pc <= 0.7 else ("bear" if pc >= 1.3 else "neutral"), f"P/C-OI {pc}")
    if short_ratio is not None:
        sig("Short-Anteil", "bear" if short_ratio >= 45 else "neutral", f"{short_ratio}% des Tagesvolumens")

    # Momentum-Signale (Relativstärke / 52W-Hoch / Volumen)
    rs3 = mo.get("rs_3m") if mo.get("available") else None
    pfh = mo.get("pct_from_high") if mo.get("available") else None
    breakout = mo.get("breakout") if mo.get("available") else None
    relvol = mo.get("rel_volume") if mo.get("available") else None
    if rs3 is not None:
        sig("Relativstärke", "bull" if rs3 >= 2 else ("bear" if rs3 <= -5 else "neutral"), f"3M vs. Index {'+' if rs3>0 else ''}{rs3}%")
    if pfh is not None:
        sig("52W-Hoch", "bull" if breakout else ("bear" if pfh <= -25 else "neutral"),
            f"{pfh}% vom Hoch" + (" · Breakout" if breakout else ""))
    if relvol is not None:
        sig("Volumen", "bull" if relvol >= 1.5 else ("bear" if relvol <= 0.6 else "neutral"), f"RelVol {relvol}×")

    bulls = sum(1 for s in signals if s["state"] == "bull")
    bears = sum(1 for s in signals if s["state"] == "bear")

    # --- Divergenzen (der interessante Teil) ---
    div = []
    if trend is not None and trend >= 65 and net is not None and net < 0:
        div.append("Starker Aufwärtstrend, aber Insider verkaufen netto — Management hält den Lauf evtl. für ausgereizt.")
    if pc is not None and pc <= 0.7 and net is not None and net < 0:
        div.append("Gegenläufig: bullische Optionspositionierung ↔ Insider-Netto-Verkäufe.")
    if trend is not None and trend >= 65 and kf in ("bear", "neutral"):
        div.append("Übergeordneter Aufwärtstrend, kurzfristig aber Konsolidierung (MACD/RSI flau).")
    if short_ratio is not None and short_ratio >= 35 and isinstance(vol, (int, float)) and vol >= 25:
        div.append(f"Hoher Short-Anteil ({short_ratio}%) + Volatilität ({vol}% p.a.) = Squeeze-Brennstoff bei Ausbruch.")
    if altman_zone == "distress" and val is not None and val >= 60:
        div.append("Optisch günstig, aber Altman-Distress — mögliche Value-Falle.")
    if breakout and relvol is not None and relvol < 1.0:
        div.append(f"Nahe 52W-Hoch, aber ohne Volumen (RelVol {relvol}×) — Ausbruch unbestätigt, Fakeout-Gefahr.")
    if rs3 is not None and rs3 >= 3 and (ret3 is not None and ret3 < 0):
        div.append("Relativ stark trotz fallendem Kurs — hält sich besser als der Markt (Relativstärke-Führer).")

    # --- Setup-Klassifikation ---
    if altman_zone == "distress" or (health is not None and health <= 25):
        setup = "Distress / Short-Lean"
    elif short_ratio is not None and short_ratio >= 40 and (trend or 0) >= 55:
        setup = "Squeeze-Kandidat (hoher Short im Aufwärtstrend)"
    elif (trend or 0) >= 65 and kf == "bull":
        setup = "Momentum-Long (Trend + Kurzfrist bestätigt)"
    elif (trend or 0) >= 65 and kf in ("bear", "neutral"):
        setup = "Aufwärtstrend in Konsolidierung"
    elif val is not None and val >= 65 and (qual or 0) >= 45 and (health or 50) >= 45:
        setup = "Value-Chance (günstig + solide)"
    elif val is not None and val <= 30 and (mom or 50) <= 45:
        setup = "Überbewertet — Vorsicht"
    else:
        setup = "Gemischtes Bild"

    lean = st.get("signal"); conviction = st.get("conviction")

    # --- Fazit-Satz (mechanisch, aus Lean + Setup + Kern-Divergenz) ---
    lean_txt = {"long": "Long-Neigung", "short": "Short-Neigung", "neutral": "neutral"}.get(lean, "neutral")
    concl = f"{setup}. Gesamt {lean_txt} (Überzeugung {conviction}/100, {bulls} bullische vs. {bears} bärische Signale)."
    if div:
        concl += " Beachte: " + div[0]

    return {
        "available": True, "symbol": sym,
        "lean": lean, "conviction": conviction, "setup": setup,
        "bull_count": bulls, "bear_count": bears,
        "signals": signals, "divergences": div, "conclusion": concl,
        "note": "Mechanische Synthese aller Kennzahlen — sofort, ohne KI. Für aktuelle Nachrichten/"
                "Katalysatoren die KI fragen. Keine Empfehlung, keine Prognose.",
    }
