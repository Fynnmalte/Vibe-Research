import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Plus, BookOpen, Newspaper, ExternalLink, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, type SectorOverview } from "@/lib/api";
import sectorsData from "@/data/sectors.json";

export function SectorDetail() {
  const { key } = useParams();
  const sector = sectorsData.sectors.find((s) => s.key === key);
  const [ov, setOv] = useState<SectorOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sector) return;
    setLoading(true);
    api.sectorOverview((sector as any).wiki || "", (sector as any).radar || "")
      .then(setOv)
      .catch(() => setOv({ overview: null, news: [] }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!sector) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Sektor nicht gefunden. <Link to="/sectors" className="text-primary">Zurück zu den Sektoren</Link>
      </div>
    );
  }

  const aiContext =
    `Sektor: ${sector.label}\nPositionierung: ${sector.tagline}\nWertschöpfungskette: ` +
    (sector.nodes.length ? sector.nodes.join(", ") : "(Glieder werden noch aufbereitet)") +
    (ov?.overview ? `\n\nÜberblick (Wikipedia): ${ov.overview.extract}` : "") +
    (ov?.news?.length ? `\n\nAktuelle Meldungen: ${ov.news.slice(0, 6).map((n) => n.zh || n.title).join("; ")}` : "");

  return (
    <div>
      <Link to="/sectors" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Sektoren
      </Link>

      <PageHeader
        title={sector.label}
        subtitle={sector.tagline}
        actions={
          <AskAiButton
            context={aiContext}
            label="KI diesen Sektor aufschlüsseln lassen"
            suggestions={["Ordne diesen Sektor kurz ein", "Wertschöpfungskette und Engpässe", "Wer sind die wichtigsten Player", "Welche Chancen und Risiken"]}
          />
        }
      />

      {/* Überblick (Wikipedia) */}
      {loading ? (
        <GlassCard className="mb-4">
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Überblick lädt…
          </div>
        </GlassCard>
      ) : ov?.overview ? (
        <GlassCard className="mb-4">
          <div className="flex gap-4">
            {ov.overview.thumbnail && (
              <img src={ov.overview.thumbnail} alt="" className="hidden h-20 w-20 shrink-0 rounded-lg object-cover sm:block" />
            )}
            <div>
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                <BookOpen className="h-4 w-4 text-primary" /> Überblick
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{ov.overview.extract}</p>
              {ov.overview.url && (
                <a href={ov.overview.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary/80 hover:text-primary">
                  Wikipedia <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </GlassCard>
      ) : null}

      {/* Kern-Glieder / Platzhalter */}
      {sector.verified ? (
        <GlassCard className="mb-4">
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Kern-Glieder der Wertschöpfungskette ({sector.nodes.length})</h3>
          <div className="flex flex-wrap gap-2.5">
            {sector.nodes.map((n) => (
              <span key={n} className="rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-primary/20">
                {n}
              </span>
            ))}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> Eigene beobachtete Titel an ein Glied hängen? Daten bleiben lokal, kein Upload.
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Wertschöpfungskette</h3>
          <p className="text-sm text-muted-foreground">
            Das Gliedergerüst ist noch nicht verifiziert. Nutze oben rechts »KI diesen Sektor aufschlüsseln lassen« —
            die KI baut die Kette anhand von Überblick und aktuellen Meldungen auf.
          </p>
        </GlassCard>
      )}

      {/* Nachrichten aus dem Radar */}
      <GlassCard>
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Newspaper className="h-4 w-4 text-primary" /> Aktuelle Meldungen
        </h3>
        {loading ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> lädt…</p>
        ) : !ov?.news?.length ? (
          <p className="text-sm text-muted-foreground/60">
            Keine Meldungen gecacht. Im <Link to="/intel" className="text-primary">Nachrichten-Radar</Link> einmal »Aktualisieren«, dann erscheinen sie hier.
          </p>
        ) : (
          <div className="space-y-2">
            {ov.news.map((n, i) => (
              <a key={i} href={n.url} target="_blank" rel="noreferrer"
                className="group flex items-baseline gap-3 border-b border-border/30 pb-2 text-sm last:border-0">
                <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground/70">{n.time}</span>
                <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{n.source}</span>
                <span className="flex-1 group-hover:text-primary">{n.zh || n.title}</span>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/0 group-hover:text-primary/60" />
              </a>
            ))}
          </div>
        )}
      </GlassCard>

      <Disclaimer />
    </div>
  );
}
