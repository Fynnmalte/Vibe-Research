import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, RefreshCw, Loader2, Trash2, AlertCircle, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, type PortfolioData, type WStrategy } from "@/lib/api";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30 * 60 * 1000; // alle 30 Minuten automatisch aktualisieren
const pnlColor = (v: number) => (v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted-foreground");
const fmt = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 2 });

// Strategie-Signal → kompaktes Label + Farbe (aus dem Faktor-Modell)
const SIGNAL: Record<string, { label: string; cls: string }> = {
  long: { label: "Long", cls: "text-success border-success/40 bg-success/10" },
  short: { label: "Short", cls: "text-danger border-danger/40 bg-danger/10" },
  neutral: { label: "Neutral", cls: "text-muted-foreground border-border bg-muted/20" },
};

export function Portfolio() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selling, setSelling] = useState<string | null>(null);
  // Strategie-Signal je Position (Faktor-Modell), lazy geladen
  const [signals, setSignals] = useState<Record<string, WStrategy>>({});

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setData(manual ? await api.refreshPortfolio() : await api.portfolio());
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Laden fehlgeschlagen");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Strategie-Signal je gehaltene Position nachladen (Faktor-Modell). Einmal pro Code.
  useEffect(() => {
    const codes = (data?.holdings || []).map((h) => h.code);
    codes.forEach((c) => {
      if (signals[c]) return;
      api.wStrategy(c)
        .then((s) => setSignals((prev) => ({ ...prev, [c]: s })))
        .catch(() => setSignals((prev) => ({ ...prev, [c]: { available: false } })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.holdings]);

  const remove = async (c: string) => {
    try { setData(await api.removeHolding(c)); } catch { /* ignore */ }
  };

  // Musterdepot: ganze Position zum aktuellen Kurs verkaufen (schließen + realisierter G/V).
  const sell = async (c: string) => {
    setSelling(c); setErr(null);
    try {
      setData(await api.sellPosition(c));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Verkauf fehlgeschlagen");
    } finally {
      setSelling(null);
    }
  };

  const removeClosed = async (i: number) => {
    try { setData(await api.removeClosed(i)); } catch { /* ignore */ }
  };

  const holdings = data?.holdings || [];
  const totals = data?.totals;
  const closed = data?.closed || [];

  const aiContext = totals
    ? `Mein Musterdepot (lokale Daten):\n` + holdings.map((h) => `${h.name}(${h.code}) ${h.shares} Stk. Einstand ${h.cost} Kurs ${h.price} G/V ${h.pnl}(${h.pnl_pct}%)`).join("\n") +
      `\nSumme: Marktwert ${totals.market_value} Gesamt-G/V ${totals.pnl}(${totals.pnl_pct}%)`
    : "Mein Musterdepot: noch keine Positionen.";

  return (
    <div>
      <PageHeader
        title="Mein Musterdepot"
        subtitle="Aktien zum aktuellen Kurs kaufen (über die Aktienseite), G/V live verfolgen"
        actions={
          <div className="flex items-center gap-2">
            {holdings.length > 0 && (
              <AskAiButton context={aiContext} label="KI mein Depot zeigen"
                suggestions={["Auf welche Richtungen konzentriert sich mein Depot", "Welche strukturellen Risiken gibt es", "Passt das zu den App-Signalen"]} />
            )}
            <button onClick={() => load(true)} disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Aktualisieren
            </button>
          </div>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/25 bg-success/5 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <span>Positionen bleiben <b className="text-foreground">nur lokal bei dir</b>, kein Upload, nicht im Repository. Kaufen: eine Aktie unter <b className="text-foreground">Aktiendaten</b> öffnen und „Ins Depot" klicken (kauft zum Live-Kurs). Verkaufen: unten „Verkaufen" — schließt zum aktuellen Kurs. Kurse aktualisieren alle 30 Minuten automatisch. Kein Titel-Vorschlag, keine Empfehlung.</span>
      </div>

      {/* Zusammenfassung */}
      {totals && holdings.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { k: "Marktwert gesamt", v: fmt(totals.market_value), c: "text-foreground" },
            { k: "Einstand gesamt", v: fmt(totals.cost), c: "text-foreground" },
            { k: "Gewinn/Verlust", v: (totals.pnl > 0 ? "+" : "") + fmt(totals.pnl), c: pnlColor(totals.pnl) },
            { k: "G/V-Quote", v: (totals.pnl_pct > 0 ? "+" : "") + totals.pnl_pct + "%", c: pnlColor(totals.pnl) },
          ].map((m) => (
            <GlassCard key={m.k} className="p-3">
              <p className="text-xs text-muted-foreground">{m.k}</p>
              <p className={cn("mt-1 font-mono text-lg font-bold", m.c)}>{m.v}</p>
            </GlassCard>
          ))}
        </div>
      )}

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {/* Positionstabelle */}
      <GlassCard glow>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">Positionsdetails</h3>
          {data?.updated && <span className="text-xs text-muted-foreground/60">Aktualisiert {data.updated}</span>}
        </div>
        {holdings.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground/70">Noch keine Positionen im Musterdepot.</p>
            <Link to="/stock-data" className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/25">
              <Search className="h-4 w-4" /> Aktie suchen → „Ins Depot"
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                  {["Name", "Kurs", "Stück", "Einstand", "Marktwert", "Gewinn/Verlust", "G/V%", "App-Signal", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.code} className="border-b border-border/30">
                    <td className="px-2 py-2.5">
                      <Link to={`/stock-data?symbol=${encodeURIComponent(h.code)}`} className="hover:text-primary">
                        <span className="font-medium">{h.name}</span>
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground/60">{h.code}</span>
                      </Link>
                    </td>
                    <td className="px-2 py-2.5 font-mono">{fmt(h.price)}</td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{fmt(h.shares)}</td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{fmt(h.cost)}</td>
                    <td className="px-2 py-2.5 font-mono">{fmt(h.market_value)}</td>
                    <td className={cn("px-2 py-2.5 font-mono", pnlColor(h.pnl))}>{h.pnl > 0 ? "+" : ""}{fmt(h.pnl)}</td>
                    <td className={cn("px-2 py-2.5 font-mono", pnlColor(h.pnl))}>{h.pnl_pct > 0 ? "+" : ""}{h.pnl_pct}%</td>
                    <td className="px-2 py-2.5">
                      {(() => {
                        const sg = signals[h.code];
                        if (!sg) return <span className="text-xs text-muted-foreground/40">…</span>;
                        if (!sg.available || !sg.signal) return <span className="text-xs text-muted-foreground/40">—</span>;
                        const m = SIGNAL[sg.signal];
                        return (
                          <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", m.cls)}
                            title={`${sg.archetype ?? ""} · Überzeugung ${sg.conviction ?? "—"}/100`}>
                            {m.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5">
                      <button onClick={() => sell(h.code)} disabled={selling === h.code}
                        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-danger/40 hover:text-danger disabled:opacity-50"
                        title="Zum aktuellen Kurs verkaufen (schließen)">
                        {selling === h.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verkaufen"}
                      </button>
                      <button onClick={() => remove(h.code)} className="ml-1 text-muted-foreground/40 hover:text-destructive" title="Ohne Erfassung entfernen">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Geschlossene Positionen */}
      <div className="mb-2 mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">Geschlossen</h3>
        {closed.length > 0 && data && (
          <span className="text-sm">
            Realisierter G/V gesamt <b className={cn("font-mono", pnlColor(data.realized_pnl))}>{data.realized_pnl > 0 ? "+" : ""}{fmt(data.realized_pnl)}</b>
          </span>
        )}
      </div>
      <GlassCard>
        {closed.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground/60">Noch keine geschlossenen Positionen. „Verkaufen" bei einer Position schließt sie zum aktuellen Kurs.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                  {["Name", "Schließungsdatum", "Schließungspreis", "Stück", "Einstand", "Realisierter G/V", "G/V%", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closed.map((c, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="px-2 py-2.5">
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground/60">{c.code}</span>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{c.date}</td>
                    <td className="px-2 py-2.5 font-mono">{fmt(c.price)}</td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{fmt(c.shares)}</td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{fmt(c.cost)}</td>
                    <td className={cn("px-2 py-2.5 font-mono", pnlColor(c.pnl))}>{c.pnl > 0 ? "+" : ""}{fmt(c.pnl)}</td>
                    <td className={cn("px-2 py-2.5 font-mono", pnlColor(c.pnl))}>{c.pnl_pct > 0 ? "+" : ""}{c.pnl_pct}%</td>
                    <td className="px-2 py-2.5">
                      <button onClick={() => removeClosed(i)} className="text-muted-foreground/50 hover:text-destructive" title="Löschen">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <Disclaimer />
    </div>
  );
}
