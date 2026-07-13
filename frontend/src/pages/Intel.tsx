import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Rss, RefreshCw, Loader2, ExternalLink, AlertCircle, Sparkles, Lightbulb } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { SaveNoteButton } from "@/components/ui/SaveNoteButton";
import { api, ApiError, type RadarData, type Industry } from "@/lib/api";
import { hasLlm, chatStream } from "@/lib/llm";
import { cn } from "@/lib/utils";

interface Digest { loading?: boolean; text?: string; err?: string; needKey?: boolean }

function InvestmentNewsPanel() {
  const [data, setData] = useState<RadarData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState("ai");
  const [refreshing, setRefreshing] = useState(false);
  const [digests, setDigests] = useState<Record<string, Digest>>({});
  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });

  useEffect(() => {
    api.radar().then(setData).catch((e) => setErr(e instanceof ApiError ? e.message : "Laden fehlgeschlagen"));
  }, []);

  const refresh = async () => {
    setRefreshing(true); setErr(null);
    try { setData(await api.radarRefresh()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Aktualisieren fehlgeschlagen"); }
    finally { setRefreshing(false); }
  };

  const industries: Industry[] = data?.industries || [];
  const cur = industries.find((i) => i.key === active) || industries[0];
  const hasData = !!data?.generated_at;

  const genDigest = async (ind: Industry) => {
    if (!hasLlm()) { setDigests((d) => ({ ...d, [ind.key]: { needKey: true } })); return; }
    setDigests((d) => ({ ...d, [ind.key]: { loading: true } }));
    const ctx = ind.items.slice(0, 25).map((it) => `[${it.time}] ${it.source}｜${it.zh || it.title}`).join("\n");
    const prompt =
      `Hier aktuelle News zum Sektor »${ind.name}«. Bitte extrahiere 3-5 »Kernpunkte heute«: je ein Satz (≤40 Wörter), ` +
      `nur objektive Darstellung wichtiger Ereignisse / Trends, keine Titel-Empfehlung, keine Kurs-Prognose, keine Beratung. Direkt als »- «-Liste, keine überflüssigen Zusätze.\n\n${ctx}`;
    try {
      let acc = "";
      await chatStream([{ role: "user", content: prompt }], `News zum Sektor ${ind.name}`, {
        onDelta: (t) => { acc += t; setDigests((d) => ({ ...d, [ind.key]: { text: acc } })); },
      });
    } catch (e) {
      setDigests((d) => ({ ...d, [ind.key]: { err: e instanceof ApiError ? e.message : "Erstellung fehlgeschlagen" } }));
    }
  };

  // Alle Sektor-Kernpunkte auf einmal extrahieren (seriell, mit Fortschritt; Einzel-Sektor-Button bleibt)
  const genAll = async () => {
    if (!hasLlm()) { if (cur) setDigests((d) => ({ ...d, [cur.key]: { needKey: true } })); return; }
    const targets = industries.filter((i) => i.items.length > 0);
    setBulk({ running: true, done: 0, total: targets.length });
    for (const ind of targets) {
      await genDigest(ind);
      setBulk((b) => ({ ...b, done: b.done + 1 }));
    }
    setBulk((b) => ({ ...b, running: false }));
  };

  const dg = cur ? digests[cur.key] : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {hasData ? `${data!.stats.total_sources} öffentliche Quellen · letzte ${data!.recent_days} Tage · aktualisiert ${data!.generated_at}` : "12 Sektoren · 108 öffentliche Quellen"}
        </span>
        <div className="flex items-center gap-2">
          {hasData && (
            <button onClick={genAll} disabled={bulk.running || refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary shadow-glow hover:bg-primary/25 disabled:opacity-50">
              {bulk.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {bulk.running ? `Extrahiere ${bulk.done}/${bulk.total}` : "Alle Kernpunkte extrahieren"}
            </button>
          )}
          <button onClick={refresh} disabled={refreshing || bulk.running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {refreshing ? "Lädt…" : "Aktualisieren"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {!hasData && !err ? (
        <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground/70">
          Noch keine News abgerufen, oben <b className="text-foreground">»Aktualisieren«</b> klicken (ca. 20-40 Sek.).
        </div>
      ) : (
        <>
          {/* Sektor-Filter — Pills mit warmoranger Umrandung */}
          <div className="mb-4 flex flex-wrap gap-2">
            {industries.map((ind) => (
              <button key={ind.key} onClick={() => setActive(ind.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                  active === ind.key
                    ? "border-primary bg-primary/15 font-medium text-primary shadow-glow"
                    : "border-primary/25 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                )}>
                <span className="h-2 w-2 rounded-full" style={{ background: ind.accent }} />
                {ind.name}<span className="text-muted-foreground/50">{ind.items.length}</span>
              </button>
            ))}
          </div>

          {cur && (
            <>
              {/* Zusammenfassungsbox Kernpunkte heute (warmoranger Rahmen) */}
              <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                    <Lightbulb className="h-4 w-4" /> Kernpunkte heute · {cur.name}
                  </span>
                  {(dg?.text || dg?.err || dg?.needKey) && (
                    <button onClick={() => genDigest(cur)} className="text-xs text-muted-foreground hover:text-primary">Erneut extrahieren</button>
                  )}
                </div>
                {dg?.loading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> KI liest die News dieses Sektors…</p>
                ) : dg?.text ? (
                  <>
                    <div className="prose prose-sm prose-invert max-w-none text-foreground"><ReactMarkdown remarkPlugins={[remarkGfm]}>{dg.text}</ReactMarkdown></div>
                    <div className="mt-2"><SaveNoteButton kind="Kernpunkte" title={`${cur.name} Kernpunkte heute`} content={dg.text} /></div>
                  </>
                ) : dg?.needKey ? (
                  <p className="text-sm text-muted-foreground">Noch keine KI verbunden. <Link to="/settings" className="text-primary">Erst deine KI verbinden</Link>, dann die Kernpunkte dieses Sektors per Klick extrahieren.</p>
                ) : dg?.err ? (
                  <p className="text-sm text-destructive">{dg.err}</p>
                ) : (
                  <button onClick={() => genDigest(cur)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/25">
                    <Sparkles className="h-4 w-4" /> KI die Kernpunkte extrahieren lassen
                  </button>
                )}
              </div>

              {/* News-Liste */}
              <div className="space-y-2">
                {cur.items.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground/60">In den letzten {data!.recent_days} Tagen keine Updates in diesem Sektor</p>
                ) : (
                  cur.items.map((it, i) => (
                    <a key={i} href={it.url} target="_blank" rel="noreferrer"
                      className="group flex items-baseline gap-3 border-b border-border/30 pb-2 text-sm last:border-0">
                      <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground/70">{it.time}</span>
                      <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{it.source}</span>
                      <span className="flex-1 group-hover:text-primary">{it.zh || it.title}</span>
                      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/0 group-hover:text-primary/60" />
                    </a>
                  ))
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}


export function Intel() {
  return (
    <div>
      <PageHeader title="Nachrichten-Radar" subtitle="12 Sektoren globale RSS-News; die KI extrahiert je Sektor die Kernpunkte" />

      <GlassCard glow>
        <div className="mb-3 flex items-center gap-2">
          <Rss className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Investment News</h3>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">investment-news</span>
        </div>
        <InvestmentNewsPanel />
      </GlassCard>

      <p className="mt-3 text-[11px] text-muted-foreground/60">
        Nur Aggregation öffentlicher Infos, keine Empfehlung, keine Kurs-Prognose. Sektor-News sind nach einer Compliance-Wortliste gefiltert; die Kernpunkte extrahiert deine selbst konfigurierte KI.
      </p>
      <Disclaimer />
    </div>
  );
}
