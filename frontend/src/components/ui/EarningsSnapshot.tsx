// Ergebnis-Schnellüberblick: neuestes Ergebnis + Forward-Konsens + Bewertungs-Perzentil in einer »Fazit-zuerst«-Karte gebündelt.
// Reine Frontend-Berechnung (Daten liegen bereits im State der Aktienseite). Compliance: nur objektive mechanische Einordnung von Fakten, keine Empfehlung, Prognose oder Bewertung.
// Die »Fazit zuerst + Signal-Tags«-Struktur ist an das equity-research skill von anthropics/financial-services angelehnt,
// aber ohne dessen Rating/Kursziel, nur mit objektiven A-Aktien-Kennzahlen.

import { ClipboardList } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import type { Valuation, Financials, ValPercentile } from "@/lib/api";

// Zahl aus einem String mit Einheit/Symbol extrahieren ("+15.2%" ergibt 15.2; nicht möglich = null).
const num = (s: string | number | null | undefined): number | null => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isNaN(n) ? null : n;
};

// A-Aktien-Konvention: positiv = rot, negativ = grün.
const yoyColor = (s: string | null | undefined) => {
  const n = num(s);
  return n == null ? "text-muted-foreground" : n > 0 ? "text-danger" : n < 0 ? "text-success" : "text-muted-foreground";
};

interface Props {
  val: Valuation;
  fin: Financials | null;
  pctl: ValPercentile | null;
}

export function EarningsSnapshot({ val, fin, pctl }: Props) {
  if (!fin || (!fin.revenue && !fin.net_profit)) return null;

  const revYoy = num(fin.revenue_yoy);
  const npYoy = num(fin.net_profit_yoy);
  const roe = num(fin.roe);
  const pePctile = pctl?.metrics.pe_ttm?.percentile ?? null;

  // Signal-Tags (objektive mechanische Einordnung, ohne Kauf/Verkauf-Tendenz).
  const tags: string[] = [];
  if (revYoy != null) tags.push(`Umsatz ${revYoy >= 30 ? "starkes Wachstum" : revYoy >= 0 ? "positives Wachstum" : "rückläufig"}`);
  if (revYoy != null && npYoy != null) tags.push(npYoy >= revYoy ? "Gewinn wächst schneller als Umsatz" : "Gewinn wächst langsamer als Umsatz");
  if (roe != null) tags.push(`${roe >= 15 ? "hohe" : roe >= 8 ? "mittlere" : "niedrige"} ROE ${roe}%`);
  if (pePctile != null) tags.push(`KGV ${pePctile < 30 ? "niedriges" : pePctile <= 70 ? "mittleres" : "hohes"} Perzentil ${Math.round(pePctile)}%`);
  if (val.peg != null) tags.push(`PEG ${val.peg}`);

  // Forward-Konsens (so viele Punkte wie vorhanden).
  const fwd: string[] = [];
  if (val.eps_26e != null) fwd.push(`Konsens 26E EPS ${val.eps_26e}`);
  if (val.pe_26e != null) fwd.push(`Forward-KGV ${val.pe_26e}`);
  if (val.digest_years != null && val.digest_years > 0) fwd.push(`Bewertungs-Amortisation ${val.digest_years} J`);
  if (val.analyst_count > 0) fwd.push(`${val.analyst_count} Analysten-Abdeckung`);

  return (
    <GlassCard glow className="mb-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <ClipboardList className="h-4 w-4 text-primary" /> Ergebnis-Schnellüberblick
        {fin.period && <span className="text-xs font-normal text-muted-foreground/60">· {fin.period}</span>}
      </h3>
      <p className="mb-3 text-[11px] text-muted-foreground/60">
        Neuestes Ergebnis + Forward-Konsens + Bewertungsposition auf einen Blick. Objektive Daten mechanisch eingeordnet, keine Kauf/Verkauf-Empfehlung.
      </p>

      {/* Fazit zuerst: die zwei Schlagzeilen-Zahlen */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Gesamtumsatz</p>
          <p className="mt-0.5 font-mono text-lg font-bold">{fin.revenue ?? "—"}</p>
          {fin.revenue_yoy && <p className={cn("text-xs", yoyColor(fin.revenue_yoy))}>YoY {fin.revenue_yoy}</p>}
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Nettogewinn (Konzern)</p>
          <p className="mt-0.5 font-mono text-lg font-bold">{fin.net_profit ?? "—"}</p>
          {fin.net_profit_yoy && <p className={cn("text-xs", yoyColor(fin.net_profit_yoy))}>YoY {fin.net_profit_yoy}</p>}
        </div>
      </div>

      {/* Signal-Tags (wichtige Beobachtungen) */}
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs text-primary">{t}</span>
          ))}
        </div>
      )}

      {/* Forward-Konsens */}
      {fwd.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="text-muted-foreground/60">Forward-Erwartung: </span>{fwd.join(" · ")}
        </p>
      )}
    </GlassCard>
  );
}
