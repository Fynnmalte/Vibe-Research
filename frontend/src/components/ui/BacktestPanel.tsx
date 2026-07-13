import { useEffect, useState } from "react";
import { FlaskConical, Loader2, Play } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, type BacktestStrategy, type BacktestResult } from "@/lib/api";
import { cn } from "@/lib/utils";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
const good = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted-foreground";

// Zwei Kurven (Strategie vs Buy&Hold) als schlichtes SVG, gemeinsame Skala.
function EquityChart({ strat, bh }: { strat: number[]; bh: number[] }) {
  const all = [...strat, ...bh];
  if (all.length < 2) return null;
  const min = Math.min(...all), max = Math.max(...all);
  const W = 100, H = 32;
  const path = (arr: number[]) =>
    arr.map((v, i) => `${(i / (arr.length - 1)) * W},${H - ((v - min) / (max - min || 1)) * H}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full">
      <polyline points={path(bh)} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.6" strokeDasharray="1.5 1.5" opacity="0.7" vectorEffect="non-scaling-stroke" />
      <polyline points={path(strat)} fill="none" stroke="hsl(var(--primary))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BacktestPanel({ symbol }: { symbol: string }) {
  const [cat, setCat] = useState<BacktestStrategy[]>([]);
  const [strategy, setStrategy] = useState("rsi");
  const [params, setParams] = useState<Record<string, number>>({});
  const [res, setRes] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.backtestCatalog().then((c) => {
      setCat(c);
      const s = c.find((x) => x.key === strategy) || c[0];
      if (s) { setStrategy(s.key); setParams({ ...s.params }); }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setRes(null); }, [symbol]);

  const pickStrategy = (key: string) => {
    setStrategy(key);
    const s = cat.find((x) => x.key === key);
    if (s) setParams({ ...s.params });
    setRes(null);
  };

  const run = async () => {
    setLoading(true);
    try { setRes(await api.backtest(symbol, strategy, params)); }
    catch { setRes({ available: false, error: "Backtest fehlgeschlagen" }); }
    finally { setLoading(false); }
  };

  const cur = cat.find((x) => x.key === strategy);
  const beats = res?.available && res.return_pct != null && res.buyhold_pct != null && res.return_pct > res.buyhold_pct;

  return (
    <GlassCard className="mb-4">
      <div className="mb-3 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Backtesting-Lab</h3>
        <span className="text-[11px] text-muted-foreground/50">Regel-Strategie auf 2 Jahren Historie · immer vs Buy &amp; Hold</span>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Strategie</label>
          <select value={strategy} onChange={(e) => pickStrategy(e.target.value)}
            className="rounded-lg border border-border bg-black/20 px-2 py-1.5 text-sm outline-none">
            {cat.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </div>
        {Object.keys(params).map((k) => (
          <div key={k}>
            <label className="mb-1 block text-xs text-muted-foreground">{k}</label>
            <input type="number" value={params[k]}
              onChange={(e) => setParams((p) => ({ ...p, [k]: parseInt(e.target.value) || 0 }))}
              className="w-20 rounded-lg border border-border bg-black/20 px-2 py-1.5 text-sm outline-none focus:border-primary/50" />
          </div>
        ))}
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-1.5 text-sm font-medium text-primary hover:bg-primary/25 disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Backtesten
        </button>
      </div>

      {cur && <p className="mb-3 text-[11px] text-muted-foreground/60">{cur.desc}</p>}

      {res && !res.available && (
        <p className="text-sm text-muted-foreground">{res.error || "Kein Ergebnis"}</p>
      )}

      {res?.available && (
        <>
          <div className={cn("mb-3 rounded-lg border p-3",
            beats ? "border-success/30 bg-success/5" : "border-border/60 bg-muted/20")}>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-sm">
                Strategie <b className={cn("font-mono", good(res.return_pct))}>{pct(res.return_pct)}</b>
              </span>
              <span className="text-sm text-muted-foreground">
                Buy &amp; Hold <b className="font-mono text-foreground">{pct(res.buyhold_pct)}</b>
              </span>
              <span className={cn("text-xs", beats ? "text-success" : "text-muted-foreground")}>
                {beats ? "schlägt Buy & Hold" : "unter Buy & Hold"}
              </span>
            </div>
          </div>

          {res.equity_curve && res.buyhold_curve && (
            <div className="mb-3">
              <EquityChart strat={res.equity_curve} bh={res.buyhold_curve} />
              <div className="mt-1 flex gap-4 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-primary" /> Strategie</span>
                <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 border-t border-dashed border-muted-foreground" /> Buy &amp; Hold</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { k: "Sharpe", v: res.sharpe ?? "—" },
              { k: "Max. Drawdown", v: pct(res.max_drawdown_pct) },
              { k: "Trefferquote", v: res.win_rate_pct != null ? `${res.win_rate_pct}%` : "—" },
              { k: "Trades", v: res.trades ?? "—" },
            ].map((m) => (
              <div key={m.k} className="rounded-lg bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">{m.k}</p>
                <p className="mt-0.5 font-mono text-sm font-bold">{m.v}</p>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground/50">
            Zeitraum {res.from} – {res.to}. Historischer Regel-Backtest zu Analysezwecken. Vergangene Performance ≠ Zukunft, keine Empfehlung.
          </p>
        </>
      )}
    </GlassCard>
  );
}
