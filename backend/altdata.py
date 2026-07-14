"""Alternative Daten (US) — Signale, die nicht jeder im Dashboard hat, alle gratis & keyless:

  1. Insider-Transaktionen  — SEC EDGAR Form 4 (offene-Markt-Käufe/-Verkäufe von Vorständen)
  2. Short-Volumen           — FINRA RegSHO Tagesdatei (Anteil leerverkauftes Volumen)
  3. Optionen-Positionierung — CBOE delayed quotes (Put/Call-Ratio, Open Interest, IV)

Nur US-Titel (SEC/FINRA/CBOE decken kein Xetra/HK ab) → für Symbole mit Suffix (.DE/.HK …)
gibt es {available: False}. Rein objektive öffentliche Daten, keine Empfehlung/Prognose.
"""

from __future__ import annotations

import re
import threading
import time
from datetime import date, datetime, timedelta

import requests

# SEC verlangt eine Kontakt-Info (Email-Muster) im User-Agent, sonst 403.
# Generischer Platzhalter (keine echte Personen-Email im öffentlichen Code).
_UA = {"User-Agent": "Vibe-Research/0.1 (admin@viberesearch.app)"}
_TTL = 3600.0
_lock = threading.Lock()

_cik: dict[str, str] = {}          # ticker -> CIK (10-stellig), einmal geladen
_finra: dict[str, tuple] = {}      # cache: {date_str: (symbol->(short,total))} + zuletzt geparst
_cache: dict[str, tuple] = {}      # per-symbol summary cache: sym -> (ts, dict)


def _is_us(sym: str) -> bool:
    """US-Ticker = keine Länder-Endung (.DE/.HK/.KS …), keine reinen Ziffern (A-Aktien)."""
    s = sym.strip().upper()
    return bool(s) and "." not in s and not s.isdigit() and "-" not in s[1:]


# ---------------------------------------------------------------- SEC Insider (Form 4)

def _cik_of(sym: str) -> str | None:
    with _lock:
        if not _cik:
            try:
                m = requests.get("https://www.sec.gov/files/company_tickers.json", headers=_UA, timeout=15).json()
                for v in m.values():
                    _cik[v["ticker"].upper()] = str(v["cik_str"]).zfill(10)
            except Exception:
                return None
        return _cik.get(sym.upper())


def _parse_form4(xml: str) -> list[dict]:
    """Nicht-derivative Transaktionen: Code (P=Kauf, S=Verkauf, A=Zuteilung, M=Ausübung,
    G=Schenkung, F=Steuer), Stück, Preis, A/D (erworben/veräußert)."""
    owner = re.search(r"<rptOwnerName>\s*([^<]+?)\s*</rptOwnerName>", xml)
    name = owner.group(1).strip() if owner else "—"
    out = []
    for blk in re.split(r"<nonDerivativeTransaction>", xml)[1:]:
        c = re.search(r"<transactionCode>(\w)</transactionCode>", blk)
        sh = re.search(r"<transactionShares>\s*<value>([\d.]+)", blk)
        pr = re.search(r"<transactionPricePerShare>\s*<value>([\d.]*)", blk)
        if not (c and sh):
            continue
        shares = float(sh.group(1))
        price = float(pr.group(1)) if pr and pr.group(1) else 0.0
        out.append({"owner": name, "code": c.group(1), "shares": shares,
                    "price": price, "value": round(shares * price)})
    return out


def insider(sym: str, lookback_days: int = 120, max_filings: int = 16) -> dict:
    """Zusammenfassung der jüngsten Insider-Käufe (P) / -Verkäufe (S) aus SEC Form 4."""
    cik = _cik_of(sym)
    if not cik:
        return {"available": False}
    try:
        sub = requests.get(f"https://data.sec.gov/submissions/CIK{cik}.json", headers=_UA, timeout=15).json()
        r = sub["filings"]["recent"]
    except Exception:
        return {"available": False}

    cutoff = (date.today() - timedelta(days=lookback_days)).isoformat()
    accs = [(r["accessionNumber"][i], r["filingDate"][i])
            for i in range(len(r["form"]))
            if r["form"][i] == "4" and r["filingDate"][i] >= cutoff][:max_filings]

    txns = []
    cikn = int(cik)
    for acc, fdate in accs:
        a = acc.replace("-", "")
        try:
            idx = requests.get(f"https://www.sec.gov/Archives/edgar/data/{cikn}/{a}/index.json", headers=_UA, timeout=12).json()
            xmls = [f["name"] for f in idx["directory"]["item"] if f["name"].endswith(".xml")]
            if not xmls:
                continue
            xml = requests.get(f"https://www.sec.gov/Archives/edgar/data/{cikn}/{a}/{xmls[0]}", headers=_UA, timeout=12).text
        except Exception:
            continue
        for t in _parse_form4(xml):
            t["date"] = fdate
            txns.append(t)

    buys = [t for t in txns if t["code"] == "P"]      # offene-Markt-Kauf
    sells = [t for t in txns if t["code"] == "S"]     # offene-Markt-Verkauf
    buy_val = sum(t["value"] for t in buys)
    sell_val = sum(t["value"] for t in sells)
    # jüngste nennenswerte Transaktionen (Kauf/Verkauf) für die Anzeige
    notable = [t for t in txns if t["code"] in ("P", "S")]
    notable.sort(key=lambda t: t["date"], reverse=True)

    return {
        "available": True,
        "lookback_days": lookback_days,
        "buy_count": len(buys), "sell_count": len(sells),
        "buy_value": buy_val, "sell_value": sell_val,
        "net_value": buy_val - sell_val,
        "recent": [{"date": t["date"], "owner": t["owner"], "code": t["code"],
                    "shares": t["shares"], "value": t["value"]} for t in notable[:6]],
    }


# ---------------------------------------------------------------- FINRA Short-Volumen

def _finra_day(sym: str) -> dict:
    """Anteil leerverkauftes Volumen aus der jüngsten FINRA-RegSHO-Tagesdatei."""
    with _lock:
        cached_date, table = _finra.get("data", (None, None))
    # jüngste verfügbare Handelstagsdatei suchen (max 7 Tage zurück)
    for back in range(1, 8):
        d = (date.today() - timedelta(days=back)).strftime("%Y%m%d")
        if table is not None and cached_date == d:
            break
        try:
            txt = requests.get(f"https://cdn.finra.org/equity/regsho/daily/CNMSshvol{d}.txt", headers=_UA, timeout=15).text
        except Exception:
            continue
        if not txt.startswith("Date|"):
            continue
        tbl = {}
        for line in txt.splitlines()[1:]:
            p = line.split("|")
            if len(p) >= 5:
                try:
                    tbl[p[1]] = (float(p[2]), float(p[4]))   # short, total
                except ValueError:
                    pass
        table, cached_date = tbl, d
        with _lock:
            _finra["data"] = (d, tbl)
        break
    if not table:
        return {"available": False}
    hit = table.get(sym.upper())
    if not hit:
        return {"available": False}
    short, total = hit
    return {"available": True, "date": cached_date,
            "short_volume": round(short), "total_volume": round(total),
            "short_ratio": round(short / total * 100, 1) if total else None}


# ---------------------------------------------------------------- CBOE Optionen

def _cboe(sym: str) -> dict:
    """Put/Call-Ratio (Open Interest + Volumen) + durchschnittliche implizite Vola."""
    try:
        j = requests.get(f"https://cdn.cboe.com/api/global/delayed_quotes/options/{sym.upper()}.json",
                         headers=_UA, timeout=12).json()
        opts = (j.get("data") or {}).get("options") or []
    except Exception:
        return {"available": False}
    if not opts:
        return {"available": False}
    call_oi = put_oi = call_vol = put_vol = 0
    ivs = []
    for o in opts:
        oid = o.get("option", "")
        m = re.search(r"([CP])\d{8}$", oid)
        if not m:
            continue
        oi = o.get("open_interest") or 0
        vol = o.get("volume") or 0
        iv = o.get("iv")
        if isinstance(iv, (int, float)) and iv > 0:
            ivs.append(iv)
        if m.group(1) == "P":
            put_oi += oi; put_vol += vol
        else:
            call_oi += oi; call_vol += vol
    return {
        "available": True,
        "pc_oi_ratio": round(put_oi / call_oi, 2) if call_oi else None,
        "pc_vol_ratio": round(put_vol / call_vol, 2) if call_vol else None,
        "call_oi": call_oi, "put_oi": put_oi,
        "avg_iv": round(sum(ivs) / len(ivs) * 100, 1) if ivs else None,   # in %
    }


# ---------------------------------------------------------------- Zusammenfassung

def summary(symbol: str) -> dict:
    """Insider + Short-Volumen + Optionen für ein US-Symbol, mit kurzen objektiven Hinweisen."""
    sym = symbol.strip().upper()
    if not _is_us(sym):
        return {"available": False, "reason": "Alt-Data (SEC/FINRA/CBOE) nur für US-Titel."}

    with _lock:
        hit = _cache.get(sym)
        if hit and time.time() - hit[0] < _TTL:
            return hit[1]

    ins = insider(sym)
    sho = _finra_day(sym)
    opt = _cboe(sym)

    notes = []
    if ins.get("available"):
        if ins["buy_count"] and ins["net_value"] > 0:
            notes.append({"sev": "pos", "text": f"Insider-Netto-Käufe: {ins['buy_count']} Käufe, netto ${ins['net_value']:,}".replace(",", ".")})
        elif ins["sell_count"] and ins["net_value"] < 0:
            notes.append({"sev": "neg", "text": f"Insider-Netto-Verkäufe: {ins['sell_count']} Verkäufe, netto -${abs(ins['net_value']):,}".replace(",", ".")})
    if sho.get("available") and sho.get("short_ratio") is not None:
        if sho["short_ratio"] >= 45:
            notes.append({"sev": "neg", "text": f"Hoher Leerverkaufs-Anteil: {sho['short_ratio']}% des Tagesvolumens"})
    if opt.get("available") and opt.get("pc_oi_ratio") is not None:
        if opt["pc_oi_ratio"] >= 1.3:
            notes.append({"sev": "neg", "text": f"Put-lastige Optionen (Put/Call-OI {opt['pc_oi_ratio']}) — viel Absicherung/Skepsis"})
        elif opt["pc_oi_ratio"] <= 0.6:
            notes.append({"sev": "pos", "text": f"Call-lastige Optionen (Put/Call-OI {opt['pc_oi_ratio']})"})

    out = {
        "available": ins.get("available") or sho.get("available") or opt.get("available"),
        "symbol": sym, "insider": ins, "short": sho, "options": opt, "notes": notes,
        "disclaimer": "Objektive öffentliche Daten: SEC EDGAR (Insider Form 4), FINRA RegSHO "
                      "(Short-Volumen), CBOE (Optionen, verzögert). Keine Empfehlung, keine Prognose.",
    }
    with _lock:
        _cache[sym] = (time.time(), out)
    return out
