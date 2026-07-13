import { Info } from "lucide-react";

// Neutraler Haftungsausschluss — Produktausrichtung: zeigt nur objektiv öffentliche Daten/Ranglisten, keine Empfehlung, keine Prognose, neutral; die Richtung gibt die eigene KI des Nutzers vor.
export function Disclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        Vibe-Research zeigt nur objektiv öffentliche Daten und Ranglisten, empfiehlt keine Einzelaktien, prognostiziert keine Kurse und stellt keine Anlageberatung dar.
      </p>
    );
  }
  return (
    <div className="mt-8 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Vibe-Research ist ein neutrales Werkzeug zur Informationsaufbereitung und KI-Anbindung. Ranglisten (Limit-up-Serien / Umsatz usw.) sind alle <b className="text-foreground">objektive öffentliche Daten</b>; dieses Produkt <b className="text-foreground">zeigt nur Fakten, empfiehlt keine Einzelaktien, prognostiziert keine Kurse, nennt keine Kauf/Verkauf-Zeitpunkte und stellt keine Anlageberatung dar</b>;
        alle Analyserichtungen im Dashboard stammen von deiner selbst konfigurierten KI und stehen in keinem Zusammenhang mit diesem Produkt. Bitte selbst prüfen, eigenständig entscheiden, Risiko trägst du selbst.
      </span>
    </div>
  );
}
