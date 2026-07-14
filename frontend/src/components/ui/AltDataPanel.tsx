import { useEffect, useState } from "react";
import { Radar, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, type WAltData } from "@/lib/api";
import { cn } from "@/lib/utils";

const money = (v: number | null | undefined) => {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s = a >= 1e9 ? (a / 1e9).toFixed(2) + " Mrd." : a >= 1e6 ? (a / 1e6).toFixed(1) + " Mio." : a.toLocaleString("de-DE");
  return (v < 0 ? "−" : "") + "$" + s;
};
const num = (v: number | null | undefined, suf = "") => (v == null ? "—" : `${v}${suf}`);

export function AltDataPanel({ symbol, onContext }: { symbol: string; onContext?: (s: string) => void }) {
  const [data, setData] = useState<WAltData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.wAltData(symbol)
      .then((d) => { setData(d); if (onContext) onContext(contextOf(d)); })
      .catch(() => setData({ available: false }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (loading) {
    return (
      <GlassCard className="mb-4">
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Alt-Data (SEC / FINRA / CBOE) lädt…
        </div>
      </GlassCard>
    );
  }
  if (!data?.available) return null; // Nicht-US oder nichts verfügbar → Panel aus

  const ins = data.insider;
  const sho = data.short;
  const opt = data.options;
  const netPos = (ins?.net_value ?? 0) > 0;

  return (
    <GlassCard className="mb-4">
      <div className="mb-3 flex items-center gap-2">
        <Radar className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Alt-Data · Insider / Short / Optionen</h3>
        <span className="ml-auto text-[11px] text-muted-foreground/50">US · SEC / FINRA / CBOE</span>
      </div>

      {/* Objektive Hinweise */}
      {data.notes && data.notes.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {data.notes.map((n, i) => (
            <div key={i} className={cn("flex items-center gap-1.5 rounded-lg border p-2 text-xs",
              n.sev === "pos" ? "border-success/25 bg-success/5 text-success" : "border-danger/25 bg-danger/5 text-danger")}>
              {n.sev === "pos" ? <TrendingUp className="h-3.5 w-3.5 shrink-0" /> : <TrendingDown className="h-3.5 w-3.5 shrink-0" />}
              <span className="text-muted-foreground">{n.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Insider */}
        <div className="rounded-lg bg-muted/25 p-3">
          <p className="mb-1.5 text-xs font-semibold">Insider (Form 4, ~120 T.)</p>
          {ins?.available ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm text-success">{ins.buy_count} Käufe</span>
                <span className="font-mono text-sm text-danger">{ins.sell_count} Verkäufe</span>
              </div>
              <p className={cn("mt-1 font-mono text-sm font-bold", netPos ? "text-success" : "text-danger")}>
                netto {money(ins.net_value)}
              </p>
            </>
          ) : <p className="text-xs text-muted-foreground/50">keine Meldungen</p>}
        </div>

        {/* Short */}
        <div className="rounded-lg bg-muted/25 p-3">
          <p className="mb-1.5 text-xs font-semibold">Short-Volumen (FINRA)</p>
          {sho?.available ? (
            <>
              <p className={cn("font-mono text-lg font-bold",
                (sho.short_ratio ?? 0) >= 45 ? "text-danger" : "text-foreground")}>{num(sho.short_ratio, "%")}</p>
              <p className="text-[11px] text-muted-foreground/60">des Tagesvolumens leerverkauft ({sho.date})</p>
            </>
          ) : <p className="text-xs text-muted-foreground/50">n/a</p>}
        </div>

        {/* Optionen */}
        <div className="rounded-lg bg-muted/25 p-3">
          <p className="mb-1.5 text-xs font-semibold">Optionen (CBOE, delayed)</p>
          {opt?.available ? (
            <>
              <p className={cn("font-mono text-lg font-bold",
                (opt.pc_oi_ratio ?? 1) >= 1.3 ? "text-danger" : (opt.pc_oi_ratio ?? 1) <= 0.6 ? "text-success" : "text-foreground")}>
                {num(opt.pc_oi_ratio)}
              </p>
              <p className="text-[11px] text-muted-foreground/60">Put/Call-OI · IV Ø {num(opt.avg_iv, "%")}</p>
            </>
          ) : <p className="text-xs text-muted-foreground/50">n/a</p>}
        </div>
      </div>

      {/* Letzte Insider-Trades */}
      {ins?.recent && ins.recent.length > 0 && (
        <div className="mt-3 border-t border-border/30 pt-2">
          <p className="mb-1 text-[11px] text-muted-foreground/60">Letzte Insider-Transaktionen</p>
          <div className="space-y-0.5">
            {ins.recent.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="w-20 shrink-0 font-mono text-muted-foreground/60">{t.date}</span>
                <span className={cn("w-14 shrink-0 font-medium", t.code === "P" ? "text-success" : "text-danger")}>
                  {t.code === "P" ? "Kauf" : "Verkauf"}
                </span>
                <span className="flex-1 truncate text-muted-foreground">{t.owner}</span>
                <span className="shrink-0 font-mono text-muted-foreground/70">{money(t.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground/50">{data.disclaimer}</p>
    </GlassCard>
  );
}

function contextOf(d: WAltData): string {
  if (!d.available) return "";
  const p: string[] = [];
  if (d.insider?.available) p.push(`Insider (120T): ${d.insider.buy_count} Käufe / ${d.insider.sell_count} Verkäufe, netto ${d.insider.net_value}`);
  if (d.short?.available) p.push(`Short-Volumen ${d.short.short_ratio}% des Tages`);
  if (d.options?.available) p.push(`Put/Call-OI ${d.options.pc_oi_ratio}, IV Ø ${d.options.avg_iv}%`);
  return p.length ? `\nAlt-Data (US): ${p.join("; ")}.` : "";
}
