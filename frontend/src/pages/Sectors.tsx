import { Link } from "react-router-dom";
import { Flame, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import sectorsData from "@/data/sectors.json";

export function Sectors() {
  const sectors = sectorsData.sectors;
  const hotCount = sectors.filter((s) => s.hot).length;

  return (
    <div>
      <PageHeader
        title="Sektoren"
        subtitle={`Wertschöpfungsketten-Gerüst von ${sectors.length} gefragten Sektoren · nur Glieder, keine Titel`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sectors.map((s) => (
          <Link key={s.key} to={`/sectors/${s.key}`}>
            <GlassCard glow={s.hot} className="flex h-full flex-col justify-between">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-base font-bold">{s.label}</h3>
                  {s.hot && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      <Flame className="h-3 w-3" /> Gefragt
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{s.tagline}</p>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3 text-xs">
                <span className="text-muted-foreground">
                  {s.verified ? `${s.nodes.length} Glieder` : "Glieder in Aufbereitung"}
                </span>
                <ChevronRight className="h-4 w-4 text-primary" />
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground/60">
        Insgesamt {sectors.length} Sektoren, davon {hotCount} gefragt · Glieder werden laufend per Echtzeit verifiziert
      </p>
      <Disclaimer />
    </div>
  );
}
