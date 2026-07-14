import { useEffect, useState } from "react";
import { ShieldCheck, Loader2, Check, X, Minus } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, type WScores } from "@/lib/api";
import { cn } from "@/lib/utils";

const ZONE: Record<string, { label: string; cls: string }> = {
  safe: { label: "Sicher", cls: "text-success" },
  grey: { label: "Grauzone", cls: "text-warning" },
  distress: { label: "Distress", cls: "text-danger" },
};

export function ScoresPanel({ symbol, onContext }: { symbol: string; onContext?: (s: string) => void }) {
  const [data, setData] = useState<WScores | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.wScores(symbol)
      .then((d) => { setData(d); if (onContext) onContext(contextOf(d)); })
      .catch(() => setData({ available: false }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (loading) {
    return (
      <GlassCard className="mb-4">
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Bilanz-Scores (SEC) laden…
        </div>
      </GlassCard>
    );
  }
  if (!data?.available) return null; // Nicht-US oder keine SEC-Daten

  const p = data.piotroski;
  const a = data.altman;
  const pColor = p ? (p.score >= 7 ? "text-success" : p.score >= 4 ? "text-warning" : "text-danger") : "text-muted-foreground";
  const zone = a?.available && a.zone ? ZONE[a.zone] : null;

  return (
    <GlassCard className="mb-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Bilanz-Scores (SEC-XBRL)</h3>
        <span className="ml-auto text-[11px] text-muted-foreground/50">Profi-Kennzahlen</span>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        {/* Piotroski */}
        <div className="rounded-lg bg-muted/25 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold">Piotroski F-Score</span>
            <span className={cn("font-mono text-xl font-bold", pColor)}>{p?.score}<span className="text-xs text-muted-foreground/50">/{p?.max ?? 9}</span></span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground/60">Bilanzqualität · ≥7 stark, ≤2 schwach</p>
        </div>
        {/* Altman */}
        <div className="rounded-lg bg-muted/25 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold">Altman Z-Score</span>
            <span className="flex items-baseline gap-1.5">
              <span className={cn("font-mono text-xl font-bold", zone?.cls ?? "text-muted-foreground")}>{a?.available ? a.z : "—"}</span>
              {zone && <span className={cn("text-[11px]", zone.cls)}>{zone.label}</span>}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground/60">Pleite-Frühwarnung · &gt;2,99 sicher, &lt;1,81 Distress</p>
        </div>
      </div>

      {/* Piotroski-Detailtests */}
      {p?.tests && (
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {p.tests.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[12px]">
              {t.pass === null
                ? <Minus className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                : t.pass
                ? <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                : <X className="h-3.5 w-3.5 shrink-0 text-danger" />}
              <span className={cn("flex-1", t.pass === null ? "text-muted-foreground/40" : "text-muted-foreground")}>{t.name}</span>
              {t.detail && <span className="font-mono text-[11px] text-muted-foreground/50">{t.detail}</span>}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground/50">{data.disclaimer}</p>
    </GlassCard>
  );
}

function contextOf(d: WScores): string {
  if (!d.available) return "";
  const parts: string[] = [];
  if (d.piotroski) parts.push(`Piotroski F-Score ${d.piotroski.score}/${d.piotroski.max}`);
  if (d.altman?.available) parts.push(`Altman Z ${d.altman.z} (${d.altman.zone})`);
  return parts.length ? `\nBilanz-Scores (SEC): ${parts.join(", ")}.` : "";
}
