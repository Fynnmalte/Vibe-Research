import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, type WScreener } from "@/lib/api";
import { cn } from "@/lib/utils";

const UNIS = [
  { key: "us", label: "US-Large-Caps" },
  { key: "dax", label: "DAX 40" },
];

const SIGNAL: Record<string, { label: string; cls: string }> = {
  long: { label: "Long", cls: "text-success border-success/40 bg-success/10" },
  short: { label: "Short", cls: "text-danger border-danger/40 bg-danger/10" },
  neutral: { label: "Neutral", cls: "text-muted-foreground border-border bg-muted/20" },
};
const scoreColor = (s: number | null | undefined) =>
  s == null ? "text-muted-foreground" : s >= 66 ? "text-success" : s >= 40 ? "text-warning" : "text-danger";
const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("de-DE", { maximumFractionDigits: 2 }));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
const pctColor = (v: number | null | undefined) => (v == null ? "text-muted-foreground" : v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted-foreground");

const FACTORS: [string, string][] = [
  ["value", "Val"], ["quality", "Qual"], ["health", "Health"], ["momentum", "Mom"],
];

export function Screener() {
  const [uni, setUni] = useState("us");
  const [data, setData] = useState<WScreener | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOnce = useCallback(async (u: string, force = false) => {
    try {
      const d = await api.wScreener(u, force);
      setData(d);
      if (d.computing) poll.current = setTimeout(() => fetchOnce(u), 3000); // solange rechnend: nachpollen
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setData(null);
    if (poll.current) clearTimeout(poll.current);
    fetchOnce(uni);
    return () => { if (poll.current) clearTimeout(poll.current); };
  }, [uni, fetchOnce]);

  const rows = data?.rows || [];
  const computing = data?.computing;
  const progress = data && data.total ? Math.round((data.done / data.total) * 100) : 0;

  const longs = rows.filter((r) => r.signal === "long");
  const shorts = rows.filter((r) => r.signal === "short");
  const aiContext = rows.length
    ? `Faktor-Screener ${data?.name} (Ranking nach Composite):\n` +
      rows.slice(0, 20).map((r) => `${r.name}(${r.symbol}) ${r.signal} Composite ${r.composite} — ${r.archetype}`).join("\n")
    : "";

  return (
    <div>
      <PageHeader
        title="Faktor-Screener"
        subtitle="Ein ganzes Universum nach dem Faktor-Modell ranken — Top-Long / Top-Short auf einen Blick"
        actions={
          rows.length > 0 ? (
            <AskAiButton context={aiContext} label="KI-Analyse"
              suggestions={["Welche Long-Kandidaten stechen heraus", "Wo häufen sich Short-Signale", "Fasse die Faktor-Lage zusammen"]} />
          ) : undefined
        }
      />

      {/* Universum-Wahl + Refresh */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {UNIS.map((u) => (
          <button key={u.key} onClick={() => setUni(u.key)}
            className={cn("rounded-lg border px-3 py-1.5 text-sm",
              uni === u.key ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
            {u.label}
          </button>
        ))}
        <button onClick={() => fetchOnce(uni, true)} disabled={computing}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
          {computing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Neu rechnen
        </button>
      </div>

      {/* Fortschritt */}
      {computing && (
        <GlassCard className="mb-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Analysiere Universum… {data?.done}/{data?.total}</p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
          {rows.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground/60">Zeige vorläufigen Stand vom letzten Lauf…</p>}
        </GlassCard>
      )}

      {/* Zusammenfassung */}
      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { k: "Analysiert", v: `${rows.length}`, c: "text-foreground" },
            { k: "Long-Signale", v: `${longs.length}`, c: "text-success" },
            { k: "Short-Signale", v: `${shorts.length}`, c: "text-danger" },
            { k: "Stand", v: data?.computed_at ?? "—", c: "text-muted-foreground" },
          ].map((m) => (
            <GlassCard key={m.k} className="p-3">
              <p className="text-xs text-muted-foreground">{m.k}</p>
              <p className={cn("mt-1 font-mono text-lg font-bold", m.c)}>{m.v}</p>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Ranking-Tabelle */}
      <GlassCard glow>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground/60">
            {computing ? "Erster Lauf läuft — das Universum wird analysiert (dauert 1–2 Min)…" : "Keine Daten."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Kurs</th>
                  <th className="px-2 py-2 font-medium">Tag</th>
                  <th className="px-2 py-2 font-medium">Signal</th>
                  <th className="px-2 py-2 font-medium">Score</th>
                  {FACTORS.map(([, l]) => <th key={l} className="px-2 py-2 text-center font-medium">{l}</th>)}
                  <th className="px-2 py-2 font-medium">Archetyp</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const sg = r.signal ? SIGNAL[r.signal] : null;
                  return (
                    <tr key={r.symbol} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="px-2 py-2 font-mono text-xs text-muted-foreground/50">{i + 1}</td>
                      <td className="px-2 py-2">
                        <Link to={`/stock-data?symbol=${encodeURIComponent(r.symbol)}`} className="hover:text-primary">
                          <span className="font-medium">{r.name}</span>
                          <span className="ml-1.5 font-mono text-xs text-muted-foreground/60">{r.symbol}</span>
                        </Link>
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{fmt(r.price)}</td>
                      <td className={cn("px-2 py-2 font-mono text-xs", pctColor(r.change_pct))}>{pct(r.change_pct)}</td>
                      <td className="px-2 py-2">
                        {sg && <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", sg.cls)}>{sg.label}</span>}
                      </td>
                      <td className={cn("px-2 py-2 font-mono font-bold", scoreColor(r.composite))}>{r.composite ?? "—"}</td>
                      {FACTORS.map(([k]) => (
                        <td key={k} className={cn("px-2 py-2 text-center font-mono text-xs", scoreColor(r.factors[k]))}>{r.factors[k] ?? "—"}</td>
                      ))}
                      <td className="px-2 py-2 text-xs text-muted-foreground/70">{r.archetype}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data?.disclaimer && <p className="mt-3 text-[11px] text-muted-foreground/50">{data.disclaimer}</p>}
      </GlassCard>

      <Disclaimer />
    </div>
  );
}
