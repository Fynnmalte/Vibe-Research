import { useEffect, useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, type WQuant } from "@/lib/api";
import { cn } from "@/lib/utils";

const scoreColor = (s: number | null | undefined) =>
  s == null ? "text-muted-foreground" : s >= 66 ? "text-success" : s >= 40 ? "text-warning" : "text-danger";
const fmt = (v: number | null | undefined, suf = "") => (v == null ? "—" : `${v}${suf}`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
const retColor = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted-foreground";

function Bar({ score }: { score: number | null }) {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
      {score != null && (
        <div className={cn("absolute left-0 top-0 h-full rounded-full",
          score >= 66 ? "bg-success/70" : score >= 40 ? "bg-warning/70" : "bg-danger/70")}
          style={{ width: `${score}%` }} />
      )}
    </div>
  );
}

// RSI als Skala 0–100 mit den klassischen Zonen: <30 überverkauft, 30–70 neutral, >70 überkauft.
function RsiGauge({ value, state }: { value: number | null; state: string }) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const vColor = v == null ? "text-muted-foreground" : v >= 70 ? "text-danger" : v <= 30 ? "text-success" : "text-foreground";
  return (
    <div className="rounded-lg bg-muted/25 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">RSI (14)</span>
        <span className="flex items-baseline gap-1.5">
          <span className={cn("font-mono text-base font-bold", vColor)}>{v == null ? "—" : v.toFixed(1)}</span>
          <span className="text-[11px] text-muted-foreground/70">{state}</span>
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full">
        {/* Zonen */}
        <div className="absolute inset-0 flex">
          <div className="bg-success/25" style={{ width: "30%" }} />
          <div className="bg-muted/40" style={{ width: "40%" }} />
          <div className="bg-danger/25" style={{ width: "30%" }} />
        </div>
        {/* Marker */}
        {v != null && (
          <div className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded bg-foreground shadow"
            style={{ left: `${v}%` }} />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground/50">
        <span>0</span><span className="text-success/70">30 überverkauft</span><span className="text-danger/70">überkauft 70</span><span>100</span>
      </div>
    </div>
  );
}

export function QuantPanel({ symbol, onContext }: { symbol: string; onContext?: (s: string) => void }) {
  const [data, setData] = useState<WQuant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.wQuant(symbol)
      .then((d) => { setData(d); if (onContext) onContext(contextOf(d)); })
      .catch(() => setData({ available: false }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (loading) {
    return (
      <GlassCard className="mb-4">
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Quant-Analyse lädt…
        </div>
      </GlassCard>
    );
  }
  if (!data?.available || !data.indicators || !data.factors) return null;

  const i = data.indicators;
  const f = data.factors;

  return (
    <GlassCard className="mb-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Quant-Analyse</h3>
        <span className="ml-auto flex items-baseline gap-1.5">
          <span className="text-xs text-muted-foreground">Gesamt-Score</span>
          <span className={cn("font-mono text-xl font-bold", scoreColor(f.overall))}>{f.overall ?? "—"}</span>
          <span className="text-xs text-muted-foreground/50">/100</span>
        </span>
      </div>

      {/* Faktoren */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { k: "Momentum", ...f.momentum },
          { k: "Trend", ...f.trend },
          { k: "Value", ...f.value },
        ].map((x) => (
          <div key={x.k} className="rounded-lg bg-muted/25 p-3">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-medium">{x.k}</span>
              <span className={cn("font-mono text-sm font-bold", scoreColor(x.score))}>{x.score ?? "—"}</span>
            </div>
            <Bar score={x.score} />
            <p className="mt-1.5 text-[11px] text-muted-foreground/70">{x.driver}</p>
          </div>
        ))}
      </div>

      {/* RSI-Skala */}
      <div className="mb-3">
        <RsiGauge value={i.rsi14} state={i.rsi_state} />
      </div>

      {/* Indikatoren */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "MACD-Hist", v: fmt(i.macd_hist), sub: i.macd_hist != null ? (i.macd_hist > 0 ? "bullisch" : "bärisch") : "" },
          { k: "SMA 20", v: fmt(i.sma20) },
          { k: "SMA 50", v: fmt(i.sma50) },
          { k: "SMA 200", v: fmt(i.sma200) },
          { k: "Rendite 1M", v: pct(i.ret_1m), cls: retColor(i.ret_1m) },
          { k: "Rendite 3M", v: pct(i.ret_3m), cls: retColor(i.ret_3m) },
          { k: "Rendite 6M", v: pct(i.ret_6m), cls: retColor(i.ret_6m) },
          { k: "Volatilität (p.a.)", v: fmt(i.volatility, "%") },
        ].map((m) => (
          <div key={m.k} className="rounded-lg bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{m.k}</p>
            <p className={cn("mt-0.5 font-mono text-sm font-bold", m.cls)}>{m.v}</p>
            {m.sub && <p className="text-[11px] text-muted-foreground/60">{m.sub}</p>}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground/50">
        Indikatoren aus 1 Jahr Tagesdaten (Bibliothek <code>ta</code>). Mechanische Einordnung, keine Prognose, keine Empfehlung.
      </p>
    </GlassCard>
  );
}

function contextOf(d: WQuant): string {
  if (!d.available || !d.indicators || !d.factors) return "";
  const i = d.indicators, f = d.factors;
  return `\nQuant: Gesamt-Score ${f.overall}/100 (Momentum ${f.momentum.score}, Trend ${f.trend.score}, Value ${f.value.score}). ` +
    `RSI ${i.rsi14} (${i.rsi_state}), MACD-Hist ${i.macd_hist}, Rendite 3M ${i.ret_3m}%, Volatilität ${i.volatility}% p.a., ` +
    `Kurs ${i.sma50 && i.sma200 ? "relativ zu SMA50/200 bekannt" : ""}.`;
}
