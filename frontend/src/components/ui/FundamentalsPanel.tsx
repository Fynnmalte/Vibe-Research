import { useEffect, useState } from "react";
import { Landmark, Loader2, AlertTriangle, ShieldAlert, Users, CalendarClock } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, type WFundamentals } from "@/lib/api";
import { cn } from "@/lib/utils";

const n = (v: number | null | undefined, suf = "") => (v == null ? "—" : `${v}${suf}`);
const pctc = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-foreground";
const money = (v: number | null | undefined) => {
  if (v == null) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)} Bio.`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} Mrd.`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)} Mio.`;
  return `${v}`;
};

function Tile({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{k}</p>
      <p className={cn("mt-0.5 font-mono text-sm font-bold", cls)}>{v}</p>
    </div>
  );
}

export function FundamentalsPanel({ symbol, onContext }: { symbol: string; onContext?: (s: string) => void }) {
  const [d, setD] = useState<WFundamentals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.wFundamentals(symbol)
      .then((r) => { setD(r); if (onContext) onContext(contextOf(r)); })
      .catch(() => setD({ available: false }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (loading) {
    return (
      <GlassCard className="mb-4">
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Fundamentaldaten lädt…
        </div>
      </GlassCard>
    );
  }
  if (!d?.available) return null;

  const v = d.valuation!, p = d.profitability!, b = d.balance!, a = d.analyst!, risk = d.risk!;
  const flags = risk.flags || [];
  const upside = a.price != null && a.target_mean ? ((a.target_mean / a.price - 1) * 100) : null;

  return (
    <GlassCard className="mb-4">
      <div className="mb-3 flex items-center gap-2">
        <Landmark className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Fundamental &amp; Risiko</h3>
        {d.next_earnings && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> Earnings {d.next_earnings}
          </span>
        )}
      </div>

      {/* Risiko-Ampel */}
      {flags.length > 0 ? (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-warning">
            <ShieldAlert className="h-4 w-4" /> Risiko-Ampel · {flags.length} Hinweis{flags.length > 1 ? "e" : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {flags.map((f, i) => (
              <span key={i} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                f.severity === "high" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning")}>
                <AlertTriangle className="h-3 w-3" /> {f.text}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-success/25 bg-success/5 p-3 text-xs text-success">
          Keine auffälligen Risiko-Schwellen ausgelöst (Bewertung, Verschuldung, Beta, Wachstum, Kursziel).
        </div>
      )}

      {/* Analysten */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-muted/20 p-3 text-sm">
        <span className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-muted-foreground" />
          <b className="capitalize">{a.recommendation ?? "—"}</b>
          <span className="text-xs text-muted-foreground">({a.count ?? "—"} Analysten)</span>
        </span>
        <span className="text-muted-foreground">Kursziel Ø <b className="font-mono text-foreground">{n(a.target_mean)}</b>
          <span className="text-xs"> ({n(a.target_low)}–{n(a.target_high)})</span>
        </span>
        {upside != null && (
          <span className={cn("text-xs", upside >= 0 ? "text-success" : "text-danger")}>
            {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% zum Ø-Ziel
          </span>
        )}
      </div>

      {/* Kennzahlen-Blöcke */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile k="Forward-KGV" v={n(v.forward_pe != null ? Math.round(v.forward_pe * 10) / 10 : null)} />
        <Tile k="PEG" v={n(v.peg != null ? Math.round(v.peg * 100) / 100 : null)} />
        <Tile k="Kurs/Buchwert" v={n(v.price_to_book != null ? Math.round(v.price_to_book * 10) / 10 : null)} />
        <Tile k="EV/EBITDA" v={n(v.ev_ebitda != null ? Math.round(v.ev_ebitda * 10) / 10 : null)} />

        <Tile k="ROE" v={n(p.roe, "%")} cls={pctc(p.roe)} />
        <Tile k="Nettomarge" v={n(p.profit_margin, "%")} cls={pctc(p.profit_margin)} />
        <Tile k="Umsatzwachstum" v={n(p.revenue_growth, "%")} cls={pctc(p.revenue_growth)} />
        <Tile k="Gewinnwachstum" v={n(p.earnings_growth, "%")} cls={pctc(p.earnings_growth)} />

        <Tile k="Verschuldung D/E" v={n(b.debt_to_equity != null ? Math.round(b.debt_to_equity) : null)} />
        <Tile k="Current Ratio" v={n(b.current_ratio != null ? Math.round(b.current_ratio * 100) / 100 : null)} />
        <Tile k="Free Cashflow" v={money(b.free_cashflow)} />
        <Tile k="Beta" v={n(risk.beta != null ? Math.round(risk.beta * 100) / 100 : null)} />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground/50">
        Fundamentaldaten Yahoo. Risiko-Ampel = objektive Schwellenwerte (mechanisch), keine Empfehlung.
      </p>
    </GlassCard>
  );
}

function contextOf(d: WFundamentals): string {
  if (!d.available) return "";
  const a = d.analyst!, p = d.profitability!, v = d.valuation!, b = d.balance!;
  const flags = (d.risk?.flags || []).map((f) => f.text).join("; ");
  return `\nFundamental: Analysten ${a.recommendation} (${a.count}), Kursziel Ø ${a.target_mean}. ` +
    `ROE ${p.roe}%, Nettomarge ${p.profit_margin}%, Umsatzwachstum ${p.revenue_growth}%, Gewinnwachstum ${p.earnings_growth}%. ` +
    `Forward-KGV ${v.forward_pe}, PEG ${v.peg}, Debt/Equity ${b.debt_to_equity}, Beta ${d.risk?.beta}. ` +
    (flags ? `Risiko-Hinweise: ${flags}. ` : "Keine Risiko-Schwellen ausgelöst. ") +
    (d.next_earnings ? `Nächste Earnings: ${d.next_earnings}.` : "");
}
