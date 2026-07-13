import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, Loader2, AlertCircle, Star, StarOff } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { StockSearch } from "@/components/ui/StockSearch";
import { ThesisPanel } from "@/components/ui/ThesisPanel";
import { AnalystPanel } from "@/components/ui/AnalystPanel";
import { FundamentalsPanel } from "@/components/ui/FundamentalsPanel";
import { StrategyPanel } from "@/components/ui/StrategyPanel";
import { QuantPanel } from "@/components/ui/QuantPanel";
import { BacktestPanel } from "@/components/ui/BacktestPanel";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, type WStockDetail } from "@/lib/api";
import { loadWatch, saveWatch, addCodes } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

// Westliche Konvention: grün = steigend.
const wUp = (p: number | null | undefined) =>
  p == null ? "text-muted-foreground" : p > 0 ? "text-success" : p < 0 ? "text-danger" : "text-muted-foreground";
const pctStr = (p: number | null | undefined) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p}%`);
const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("de-DE", { maximumFractionDigits: 2 }));
const round2 = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100) / 100}`);
const money = (v: number | null | undefined, cur: string | null) => {
  if (v == null) return "—";
  const c = cur ?? "";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)} Bio. ${c}`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} Mrd. ${c}`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} Mio. ${c}`;
  return `${v.toLocaleString("de-DE")} ${c}`;
};

// Position innerhalb der 52-Wochen-Spanne (0–100 %); null wenn Daten fehlen.
const range52 = (d: WStockDetail): number | null => {
  if (d.price == null || d.week52_low == null || d.week52_high == null || d.week52_high <= d.week52_low) return null;
  return Math.min(100, Math.max(0, ((d.price - d.week52_low) / (d.week52_high - d.week52_low)) * 100));
};

export function StockData() {
  const [params] = useSearchParams();
  const symbolParam = params.get("symbol") || "";
  const [data, setData] = useState<WStockDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inWatch, setInWatch] = useState(false);
  const [thesisCtx, setThesisCtx] = useState("");
  const [quantCtx, setQuantCtx] = useState("");
  const [fundCtx, setFundCtx] = useState("");
  const [strategyCtx, setStrategyCtx] = useState("");
  const runId = useRef(0);

  const load = async (symbol: string) => {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    const rid = ++runId.current;
    setLoading(true); setErr(null); setData(null); setThesisCtx(""); setQuantCtx(""); setFundCtx(""); setStrategyCtx("");
    try {
      const d = await api.wStock(s);
      if (rid !== runId.current) return;
      setData(d);
      setInWatch(loadWatch().includes(d.symbol));
    } catch (e) {
      if (rid === runId.current) setErr(e instanceof ApiError ? e.message : `Symbol „${s}" nicht gefunden`);
    } finally {
      if (rid === runId.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (symbolParam) load(symbolParam);
    else { setData(null); setErr(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolParam]);

  const toggleWatch = () => {
    if (!data) return;
    let next: string[];
    if (inWatch) {
      next = loadWatch().filter((c) => c !== data.symbol);
      setInWatch(false);
    } else {
      next = addCodes(loadWatch(), data.symbol).next;
      setInWatch(true);
    }
    saveWatch(next);
  };

  const r52 = data ? range52(data) : null;

  const aiContext = data
    ? `Aktie: ${data.name} (${data.symbol}) · ${data.exchange ?? ""}\n` +
      `Kurs ${fmt(data.price)} ${data.currency ?? ""} · Veränderung ${pctStr(data.change_pct)} · Vortagesschluss ${fmt(data.prev_close)}\n` +
      `Marktkap. ${money(data.mcap, data.currency)} · KGV ${round2(data.pe)} · Forward-KGV ${round2(data.forward_pe)} · EPS ${round2(data.eps)}\n` +
      `Tag: Eröffnung ${fmt(data.open)}, Hoch ${fmt(data.high)}, Tief ${fmt(data.low)}, Volumen ${data.volume ?? "—"}\n` +
      `52-Wochen: ${fmt(data.week52_low)}–${fmt(data.week52_high)}${r52 != null ? ` (aktuell bei ${r52.toFixed(0)}% der Spanne)` : ""}` +
      fundCtx + strategyCtx + quantCtx + thesisCtx
    : "";

  return (
    <div>
      <PageHeader
        title="Aktiendaten"
        subtitle="Suche eine Aktie (Name / Ticker / ISIN) und sieh alle Daten auf einen Blick"
        actions={data && (
          <AskAiButton
            context={aiContext}
            label="KI-Briefing"
            suggestions={["Ordne diese Aktie kurz ein", "Ist die Bewertung hoch oder niedrig", "Wo steht der Kurs in der 52-Wochen-Spanne", "Welche Chancen und Risiken"]}
          />
        )}
      />

      <div className="mb-5">
        <StockSearch autoFocus={!symbolParam} />
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade {symbolParam}…
        </div>
      )}

      {err && !loading && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {data && !loading && (
        <>
          <GlassCard glow className="mb-4">
            <div className="mb-4 flex flex-wrap items-baseline gap-2">
              <h2 className="text-xl font-bold">{data.name}</h2>
              <span className="font-mono text-sm text-muted-foreground">{data.symbol}</span>
              {data.exchange && <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{data.exchange}</span>}
              <button
                onClick={toggleWatch}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-primary"
              >
                {inWatch ? <><Star className="h-3.5 w-3.5 fill-primary text-primary" /> In Watchlist</> : <><StarOff className="h-3.5 w-3.5" /> Zur Watchlist</>}
              </button>
            </div>

            <div className="mb-4 flex items-baseline gap-3">
              <span className={cn("font-mono text-3xl font-bold", wUp(data.change_pct))}>{fmt(data.price)}</span>
              <span className="text-sm text-muted-foreground">{data.currency}</span>
              <span className={cn("font-mono text-lg", wUp(data.change_pct))}>{pctStr(data.change_pct)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { k: "Vortagesschluss", v: fmt(data.prev_close) },
                { k: "Eröffnung", v: fmt(data.open) },
                { k: "Tageshoch", v: fmt(data.high) },
                { k: "Tagestief", v: fmt(data.low) },
                { k: "Volumen", v: data.volume != null ? data.volume.toLocaleString("de-DE") : "—" },
                { k: "Marktkap.", v: money(data.mcap, data.currency) },
              ].map((m) => (
                <div key={m.k} className="rounded-lg bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{m.k}</p>
                  <p className="mt-0.5 font-mono text-base font-bold">{m.v}</p>
                </div>
              ))}
            </div>
          </GlassCard>

          {(data.pe != null || data.eps != null || data.week52_high != null) && (
            <GlassCard className="mb-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
                <BarChart3 className="h-4 w-4 text-primary" /> Kennzahlen
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { k: "KGV (TTM)", v: round2(data.pe) },
                  { k: "Forward-KGV", v: round2(data.forward_pe) },
                  { k: "EPS (TTM)", v: round2(data.eps) },
                  { k: "52W Hoch", v: fmt(data.week52_high) },
                  { k: "52W Tief", v: fmt(data.week52_low) },
                ].map((m) => (
                  <div key={m.k} className="rounded-lg bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{m.k}</p>
                    <p className="mt-0.5 font-mono text-base font-bold">{m.v}</p>
                  </div>
                ))}
              </div>

              {r52 != null && (
                <div className="mt-4">
                  <div className="mb-1 flex justify-between font-mono text-[11px] text-muted-foreground/60">
                    <span>{fmt(data.week52_low)}</span>
                    <span>52-Wochen-Spanne</span>
                    <span>{fmt(data.week52_high)}</span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/30">
                    <div className="absolute top-0 h-full rounded-full bg-primary/40" style={{ width: `${r52}%` }} />
                    <div className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded bg-foreground" style={{ left: `${r52}%` }} />
                  </div>
                </div>
              )}
            </GlassCard>
          )}

          <FundamentalsPanel symbol={data.symbol} onContext={setFundCtx} />

          <StrategyPanel symbol={data.symbol} onContext={setStrategyCtx} />

          <QuantPanel symbol={data.symbol} onContext={setQuantCtx} />

          <BacktestPanel symbol={data.symbol} />

          <ThesisPanel symbol={data.symbol} onContext={setThesisCtx} />

          <AnalystPanel symbol={data.symbol} context={aiContext} />

          <p className="text-xs text-muted-foreground/60">
            US/EU/HK-Daten über öffentliche Finanzquellen (CNBC / Yahoo; mit eigenem RapidAPI-Key zusätzliche Felder) · Beträge in Originalwährung · nur objektive Daten, keine Kauf/Verkauf-Empfehlung. Das KI-Briefing stammt von deiner selbst konfigurierten KI.
          </p>
        </>
      )}

      {!data && !loading && !err && (
        <GlassCard>
          <div className="py-12 text-center text-sm text-muted-foreground">
            Suche oben nach einer Aktie — <b className="text-foreground">Name</b> (Siemens),{" "}
            <b className="text-foreground">Ticker</b> (AAPL, SAP.DE, 0700.HK) oder{" "}
            <b className="text-foreground">ISIN</b> (DE0007164600).<br />
            <span className="text-xs text-muted-foreground/60">Klick auf einen Treffer öffnet alle Kennzahlen; das KI-Briefing ordnet sie ein.</span>
          </div>
        </GlassCard>
      )}

      <Disclaimer />
    </div>
  );
}
