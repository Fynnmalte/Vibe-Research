import { useEffect, useState } from "react";
import { Sparkles, Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, type WSynthesis } from "@/lib/api";
import { cn } from "@/lib/utils";

const LEAN = {
  long: { label: "Long-Neigung", cls: "text-success", ring: "border-success/40 bg-success/5", Icon: TrendingUp },
  short: { label: "Short-Neigung", cls: "text-danger", ring: "border-danger/40 bg-danger/5", Icon: TrendingDown },
  neutral: { label: "Neutral", cls: "text-muted-foreground", ring: "border-border bg-muted/10", Icon: Minus },
} as const;

const STATE = {
  bull: { cls: "text-success border-success/40 bg-success/10", dot: "bg-success" },
  bear: { cls: "text-danger border-danger/40 bg-danger/10", dot: "bg-danger" },
  neutral: { cls: "text-muted-foreground border-border bg-muted/20", dot: "bg-muted-foreground/40" },
} as const;

export function SynthesisPanel({ symbol, onContext }: { symbol: string; onContext?: (s: string) => void }) {
  const [data, setData] = useState<WSynthesis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.wSynthesis(symbol)
      .then((d) => { setData(d); if (onContext) onContext(contextOf(d)); })
      .catch(() => setData({ available: false }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (loading) {
    return (
      <GlassCard glow className="mb-4">
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Synthese wird verdichtet…
        </div>
      </GlassCard>
    );
  }
  if (!data?.available) return null;

  const lean = LEAN[data.lean ?? "neutral"];

  return (
    <GlassCard glow className="mb-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Synthese · Gesamtbild</h3>
        <span className="ml-auto text-[11px] text-muted-foreground/50">sofort · ohne KI</span>
      </div>

      {/* Kopf: Lean + Setup + Überzeugung */}
      <div className={cn("mb-3 flex flex-wrap items-center gap-3 rounded-lg border p-3", lean.ring)}>
        <lean.Icon className={cn("h-6 w-6 shrink-0", lean.cls)} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-base font-bold", lean.cls)}>{data.setup}</p>
          <p className="text-xs text-muted-foreground">
            Gesamt {lean.label} · <span className="text-success">{data.bull_count}▲</span> / <span className="text-danger">{data.bear_count}▼</span> Signale
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">Überzeugung</p>
          <p className={cn("font-mono text-lg font-bold", lean.cls)}>{data.conviction}<span className="text-xs text-muted-foreground/50">/100</span></p>
        </div>
      </div>

      {/* Signal-Matrix */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {data.signals?.map((s, i) => (
          <span key={i} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]", STATE[s.state].cls)}
            title={s.detail}>
            <span className={cn("h-1.5 w-1.5 rounded-full", STATE[s.state].dot)} />
            {s.name}
          </span>
        ))}
      </div>

      {/* Divergenzen */}
      {data.divergences && data.divergences.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {data.divergences.map((d, i) => (
            <div key={i} className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/5 p-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{d}</span>
            </div>
          ))}
        </div>
      )}

      {/* Fazit */}
      <div className="rounded-lg bg-muted/25 p-3">
        <p className="text-sm text-foreground">{data.conclusion}</p>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground/50">{data.note}</p>
    </GlassCard>
  );
}

function contextOf(d: WSynthesis): string {
  if (!d.available) return "";
  const sig = d.signals?.map((s) => `${s.name}: ${s.state}`).join(", ");
  const div = d.divergences?.length ? ` Divergenzen: ${d.divergences.join(" | ")}` : "";
  return `\nSynthese: ${d.conclusion} Signale: ${sig}.${div}`;
}
