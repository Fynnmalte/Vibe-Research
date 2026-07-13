import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Loader2, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Plus, X, LayoutGrid, Globe } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, type WIndex, type WQuote, type WSector, type WMovers, type WStatus } from "@/lib/api";
import { hasLlm, chatStream } from "@/lib/llm";
import { SaveNoteButton } from "@/components/ui/SaveNoteButton";
import { loadWatch, saveWatch, addCodes } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

// Westliche Konvention: grün = steigend, rot = fallend (umgekehrt zur A-Aktien-Ansicht).
const pctColor = (p: number | null | undefined) =>
  p == null ? "text-muted-foreground" : p > 0 ? "text-success" : p < 0 ? "text-danger" : "text-muted-foreground";
const pctStr = (p: number | null | undefined) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p.toFixed(2)}%`);
const num = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("de-DE", { maximumFractionDigits: 2 });

export function DailyReview() {
  const [indices, setIndices] = useState<WIndex[]>([]);
  const [idxErr, setIdxErr] = useState(false);
  const [sectors, setSectors] = useState<WSector[]>([]);
  const [movers, setMovers] = useState<WMovers | null>(null);
  const [secDone, setSecDone] = useState(false);
  const [movDone, setMovDone] = useState(false);
  const [status, setStatus] = useState<WStatus | null>(null);

  const [review, setReview] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [needConfig, setNeedConfig] = useState(false);

  // Beobachtete Aktien (Watchlist, lokal gespeichert)
  const [watchCodes, setWatchCodes] = useState<string[]>(loadWatch);
  const [watchQuotes, setWatchQuotes] = useState<Record<string, WQuote>>({});
  const [watchInput, setWatchInput] = useState("");
  const [watchLoading, setWatchLoading] = useState(false);

  const loadAll = () => {
    setIdxErr(false);
    api.wIndices().then(setIndices).catch(() => setIdxErr(true));
    api.wSectors().then(setSectors).catch(() => {}).finally(() => setSecDone(true));
    api.wMovers(8).then(setMovers).catch(() => {}).finally(() => setMovDone(true));
    api.wStatus().then(setStatus).catch(() => {});
  };

  // "vor 3 Min." / "gerade eben" aus Sekundenalter der Kursdaten
  const freshLabel = (sec: number | null | undefined) => {
    if (sec == null) return null;
    if (sec < 90) return "gerade aktualisiert";
    const min = Math.round(sec / 60);
    if (min < 60) return `Kurse vor ${min} Min.`;
    const h = Math.round(min / 60);
    return `Kurse vor ${h} Std.`;
  };

  // Platzhalter: Anfrage noch offen = lädt; zurück aber leer = Quelle drosselt gerade (Yahoo antwortet mit HTTP 429)
  const pending = (done: boolean) => (
    <p className="py-6 text-center text-sm text-muted-foreground/60">
      {done
        ? "Keine Daten: Kursquelle antwortet gerade nicht (Drosselung oder außerhalb der Handelszeit). Später erneut aktualisieren."
        : "Lädt…"}
    </p>
  );

  const refreshWatch = (codes: string[]) => {
    if (!codes.length) { setWatchQuotes({}); return; }
    setWatchLoading(true);
    api.wQuote(codes.join(",")).then(setWatchQuotes).catch(() => {}).finally(() => setWatchLoading(false));
  };

  useEffect(() => {
    loadAll();
    refreshWatch(loadWatch());
  }, []);

  const addWatch = () => {
    const { next, added } = addCodes(watchCodes, watchInput);
    setWatchInput("");
    if (!added) return;
    setWatchCodes(next); saveWatch(next); refreshWatch(next);
  };

  const removeWatch = (c: string) => {
    const next = watchCodes.filter((x) => x !== c);
    setWatchCodes(next); saveWatch(next); refreshWatch(next);
  };

  const today = new Date().toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });

  const dataSummary = indices.length
    ? indices.map((i) => `${i.name} ${num(i.price)} (${pctStr(i.change_pct)})`).join("; ")
    : "(Indexdaten nicht abrufbar)";

  const sectorSummary = sectors.length
    ? `\nSektoren (Tagesperformance): ${sectors.map((s) => `${s.name} ${pctStr(s.change_pct)}`).join("; ")}`
    : "";

  const moversSummary = movers?.gainers.length
    ? `\nStärkste Werte: ${movers.gainers.slice(0, 5).map((m) => `${m.name} ${pctStr(m.change_pct)}`).join("; ")}` +
      `\nSchwächste Werte: ${movers.losers.slice(0, 5).map((m) => `${m.name} ${pctStr(m.change_pct)}`).join("; ")}`
    : "";

  const aiContext = `Marktdaten ${today}\nIndizes: ${dataSummary}${sectorSummary}${moversSummary}`;

  const runReview = async () => {
    setReviewErr(null);
    setNeedConfig(false);
    if (!hasLlm()) { setNeedConfig(true); return; }
    setReviewLoading(true);
    setReview("");
    const prompt =
      `Hier die objektiven Marktdaten von heute (USA, Deutschland, Europa, Hongkong):\n${aiContext}\n\n` +
      "Bitte erstelle auf Deutsch einen Tagesrückblick: allgemeine Marktentwicklung, Verhalten der wichtigsten Indizes, " +
      "auffällige Sektoren und Einzelwerte. Nur objektive Beschreibung und Analyse aus mehreren Blickwinkeln, " +
      "keine Kurs-Prognose, keine Titel-Empfehlung, keine Anlageberatung.";
    try {
      await chatStream([{ role: "user", content: prompt }], aiContext, {
        onDelta: (t) => setReview((r) => r + t),
      });
    } catch (e) {
      setReviewErr(e instanceof ApiError ? e.message : "Rückblick fehlgeschlagen");
    } finally {
      setReviewLoading(false);
    }
  };

  const moverRow = (m: WQuote, i: number) => (
    <Link key={m.symbol} to={`/stock-data?symbol=${encodeURIComponent(m.symbol)}`}
      className="flex items-center gap-3 border-b border-border/30 pb-1.5 text-sm last:border-0 hover:text-primary">
      <span className="w-5 shrink-0 text-xs text-muted-foreground/50">{i + 1}</span>
      <span className="flex-1 truncate" title={m.symbol}>{m.name}</span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{num(m.price)} {m.currency}</span>
      <span className={cn("w-20 shrink-0 text-right font-mono text-xs", pctColor(m.change_pct))}>{pctStr(m.change_pct)}</span>
    </Link>
  );

  return (
    <div>
      <PageHeader
        title="Tagesrückblick"
        subtitle={`${today} · Indizes / Sektoren / stärkste Bewegungen auf einen Blick, den Rückblick übernimmt deine KI`}
        actions={
          <AskAiButton
            context={aiContext}
            label="KI fragen"
            suggestions={["Wie lief der Markt heute", "Welche Sektoren führten", "Was ist am Markt bemerkenswert"]}
          />
        }
      />

      {/* Börsen-Handelszeit + Datenfrische */}
      {status && (
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {status.markets.map((m) => (
            <span key={m.key} className="inline-flex items-center gap-1.5" title={`Handelszeit ${m.hours} Ortszeit · lokal ${m.local_time}`}>
              <span className={cn("h-1.5 w-1.5 rounded-full", m.open ? "bg-success" : "bg-muted-foreground/40")} />
              {m.name}
              <span className={m.open ? "text-success" : "text-muted-foreground/60"}>{m.open ? "offen" : "zu"}</span>
            </span>
          ))}
          {freshLabel(status.stale_sec) && (
            <span className="ml-auto text-muted-foreground/60">{freshLabel(status.stale_sec)}</span>
          )}
        </div>
      )}

      {/* 1. Indizes */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <Globe className="h-4 w-4" /> Indizes
        </h3>
        <button onClick={loadAll} className="text-muted-foreground hover:text-primary" title="Aktualisieren">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {indices.length === 0
          ? [1, 2, 3, 4, 5, 6].map((i) => (
              <GlassCard key={i} className="p-3">
                <p className="text-xs text-muted-foreground">{idxErr ? "Kurse nicht verbunden" : "Lädt…"}</p>
                <p className="mt-1 font-mono text-lg font-bold text-muted-foreground/40">—</p>
              </GlassCard>
            ))
          : indices.map((i) => (
              <GlassCard key={i.key} className="p-3">
                <p className="truncate text-xs text-muted-foreground">{i.name}</p>
                <p className="truncate text-[10px] text-muted-foreground/40">{i.region}</p>
                <p className={cn("mt-1 font-mono text-lg font-bold", pctColor(i.change_pct))}>{num(i.price)}</p>
                <p className={cn("text-xs", pctColor(i.change_pct))}>{pctStr(i.change_pct)}</p>
              </GlassCard>
            ))}
      </div>

      {/* 2. Beobachtete Aktien */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">Beobachtete Aktien</h3>
        {watchCodes.length > 0 && (
          <button onClick={() => refreshWatch(watchCodes)} className="text-muted-foreground hover:text-primary" title="Kurse aktualisieren">
            {watchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      <GlassCard className="mb-6">
        <div className="mb-3 flex gap-2">
          <input
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value.slice(0, 80))}
            onKeyDown={(e) => e.key === "Enter" && addWatch()}
            placeholder="Symbole, z.B. AAPL SAP.DE 0700.HK"
            className="w-72 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <button onClick={addWatch}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25">
            <Plus className="h-4 w-4" /> Hinzufügen
          </button>
        </div>
        {watchCodes.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">
            Füge deine beobachteten Aktien hinzu — US-Ticker wie <code className="rounded bg-muted/50 px-1">AAPL</code>,
            Xetra mit <code className="rounded bg-muted/50 px-1">.DE</code>, Hongkong mit <code className="rounded bg-muted/50 px-1">.HK</code>.
            Daten lokal gespeichert, kein Upload.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {watchCodes.map((c) => {
              const q = watchQuotes[c];
              return (
                <div key={c} className="group relative rounded-lg bg-muted/25 p-3">
                  <button onClick={() => removeWatch(c)} title="Entfernen"
                    className="absolute right-1.5 top-1.5 z-10 text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <Link to={`/stock-data?symbol=${encodeURIComponent(c)}`} className="block">
                    <p className="truncate text-xs text-muted-foreground group-hover:text-primary" title={c}>{q?.name || c}</p>
                    <p className={cn("mt-1 font-mono text-lg font-bold", pctColor(q?.change_pct))}>{q ? num(q.price) : "—"}</p>
                    <p className={cn("text-xs", q ? pctColor(q.change_pct) : "text-muted-foreground/40")}>
                      {q ? `${pctStr(q.change_pct)} · ${q.currency ?? ""}` : c}
                    </p>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* 3. KI-Tagesrückblick */}
      <GlassCard glow className="mb-6">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> KI-Tagesrückblick</h3>
          <button onClick={runReview} disabled={reviewLoading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25 disabled:opacity-50">
            {reviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {review ? "Erneut analysieren" : "KI heute zusammenfassen lassen"}
          </button>
        </div>
        {needConfig && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
            Noch keine KI verbunden. <Link to="/settings" className="text-primary">Erst deine KI verbinden</Link>, dann Rückblick per Klick.
          </div>
        )}
        {reviewErr && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /> {reviewErr}
          </div>
        )}
        {review ? (
          <>
            <div className="prose prose-sm prose-invert mt-4 max-w-none text-foreground"><ReactMarkdown remarkPlugins={[remarkGfm]}>{review}</ReactMarkdown></div>
            {!reviewLoading && <div className="mt-3"><SaveNoteButton kind="Rückblick" title={`Tagesrückblick ${today}`} content={review} /></div>}
          </>
        ) : !needConfig && !reviewErr && !reviewLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Klick oben — das System packt die objektiven Tagesdaten zusammen und deine KI erstellt den Rückblick.{" "}
            <b className="text-foreground">Die Analyse kommt von ihr, wir liefern nur die Daten.</b>
          </p>
        ) : null}
      </GlassCard>

      {/* 4. Sektor-Performance */}
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <LayoutGrid className="h-4 w-4" /> Sektor-Performance
        </h3>
        <span className="text-[11px] text-muted-foreground/50">Tagesveränderung der Select-Sector-ETFs · objektive Daten</span>
      </div>
      <GlassCard className="mb-6">
        {sectors.length === 0 ? (
          pending(secDone)
        ) : (
          <div className="space-y-2">
            {sectors.map((s) => {
              const w = Math.min(100, Math.abs(s.change_pct) * 25); // ±4% füllt den Balken
              return (
                <div key={s.symbol} className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 truncate">{s.name}</span>
                  <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground/50">{s.symbol}</span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/30">
                    <div
                      className={cn("absolute top-0 h-full rounded-full", s.change_pct >= 0 ? "bg-success/60" : "bg-danger/60")}
                      style={s.change_pct >= 0 ? { left: "50%", width: `${w / 2}%` } : { right: "50%", width: `${w / 2}%` }}
                    />
                    <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
                  </div>
                  <span className={cn("w-16 shrink-0 text-right font-mono text-xs", pctColor(s.change_pct))}>{pctStr(s.change_pct)}</span>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* 5. Stärkste / schwächste Werte */}
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <TrendingUp className="h-4 w-4" /> Stärkste und schwächste Werte
        </h3>
        <span className="text-[11px] text-muted-foreground/50">
          {movers?.universe ? `aus ${movers.universe} Werten (DAX 40 + US-Large-Caps)` : "DAX 40 + US-Large-Caps"}
          {" "}· objektive Rangliste, keine Empfehlung / keine Prognose
        </span>
      </div>
      <div className="mb-2 grid gap-4 md:grid-cols-2">
        <GlassCard>
          <h4 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-success">
            <TrendingUp className="h-4 w-4" /> Stärkste
          </h4>
          {!movers?.gainers.length ? pending(movDone) : <div className="space-y-1.5">{movers.gainers.map(moverRow)}</div>}
        </GlassCard>
        <GlassCard>
          <h4 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-danger">
            <TrendingDown className="h-4 w-4" /> Schwächste
          </h4>
          {!movers?.losers.length ? pending(movDone) : <div className="space-y-1.5">{movers.losers.map(moverRow)}</div>}
        </GlassCard>
      </div>

      <Disclaimer />
    </div>
  );
}
