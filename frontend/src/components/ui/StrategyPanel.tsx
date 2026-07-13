import { useEffect, useState } from "react";
import { Target, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, type WStrategy } from "@/lib/api";
import { cn } from "@/lib/utils";

const scoreColor = (s: number | null | undefined) =>
  s == null ? "text-muted-foreground" : s >= 66 ? "text-success" : s >= 40 ? "text-warning" : "text-danger";

// Signal → Farbe / Icon / Label
const SIG = {
  long: { color: "text-success", ring: "border-success/40 bg-success/5", Icon: TrendingUp },
  short: { color: "text-danger", ring: "border-danger/40 bg-danger/5", Icon: TrendingDown },
  neutral: { color: "text-muted-foreground", ring: "border-border bg-muted/10", Icon: Minus },
} as const;

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

export function StrategyPanel({ symbol, onContext }: { symbol: string; onContext?: (s: string) => void }) {
  const [data, setData] = useState<WStrategy | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.wStrategy(symbol)
      .then((d) => { setData(d); if (onContext) onContext(contextOf(d)); })
      .catch(() => setData({ available: false }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (loading) {
    return (
      <GlassCard className="mb-4">
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Strategie-Analyse lädt…
        </div>
      </GlassCard>
    );
  }
  if (!data?.available || !data.factors) return null;

  const sig = SIG[data.signal ?? "neutral"];

  return (
    <GlassCard className="mb-4">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Positionierung (Faktor-Modell)</h3>
      </div>

      {/* Signal-Kopf */}
      <div className={cn("mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3", sig.ring)}>
        <sig.Icon className={cn("h-6 w-6 shrink-0", sig.color)} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-base font-bold", sig.color)}>{data.stance}</p>
          <p className="text-xs text-muted-foreground">{data.archetype}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">Überzeugung</p>
          <p className={cn("font-mono text-lg font-bold", scoreColor(data.conviction))}>{data.conviction}<span className="text-xs text-muted-foreground/50">/100</span></p>
        </div>
      </div>

      {/* Faktoren */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {data.factors.map((x) => (
          <div key={x.key} className="rounded-lg bg-muted/25 p-3">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-medium">{x.label}</span>
              <span className={cn("font-mono text-sm font-bold", scoreColor(x.score))}>{x.score ?? "—"}</span>
            </div>
            <Bar score={x.score} />
            {x.drivers.length > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground/70">{x.drivers.slice(0, 2).join(" · ")}</p>
            )}
          </div>
        ))}
      </div>

      {/* Pro / Contra */}
      {(data.bull_points?.length || data.bear_points?.length) ? (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-success/20 bg-success/5 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-success"><TrendingUp className="h-3.5 w-3.5" /> Dafür (Long)</p>
            {data.bull_points?.length ? (
              <ul className="space-y-1 text-[12px] text-muted-foreground">
                {data.bull_points.map((p, i) => <li key={i}>· {p}</li>)}
              </ul>
            ) : <p className="text-[12px] text-muted-foreground/50">—</p>}
          </div>
          <div className="rounded-lg border border-danger/20 bg-danger/5 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-danger"><TrendingDown className="h-3.5 w-3.5" /> Dagegen (Short)</p>
            {data.bear_points?.length ? (
              <ul className="space-y-1 text-[12px] text-muted-foreground">
                {data.bear_points.map((p, i) => <li key={i}>· {p}</li>)}
              </ul>
            ) : <p className="text-[12px] text-muted-foreground/50">—</p>}
          </div>
        </div>
      ) : null}

      <p className="mt-1 text-[11px] text-muted-foreground/50">{data.disclaimer}</p>
    </GlassCard>
  );
}

function contextOf(d: WStrategy): string {
  if (!d.available || !d.factors) return "";
  const fac = d.factors.map((x) => `${x.label} ${x.score ?? "—"}`).join(", ");
  const bull = d.bull_points?.length ? ` Dafür: ${d.bull_points.join("; ")}.` : "";
  const bear = d.bear_points?.length ? ` Dagegen: ${d.bear_points.join("; ")}.` : "";
  return `\nFaktor-Positionierung: ${d.stance} — ${d.archetype} (Überzeugung ${d.conviction}/100). ` +
    `Faktoren: ${fac}.${bull}${bear} (mechanisches Modell, keine Empfehlung)`;
}
