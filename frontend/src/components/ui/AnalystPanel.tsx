import { useState } from "react";
import { Link } from "react-router-dom";
import { Users, Loader2, AlertCircle, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GlassCard } from "@/components/ui/GlassCard";
import { SaveNoteButton } from "@/components/ui/SaveNoteButton";
import { hasLlm, chatStream } from "@/lib/llm";
import { ApiError } from "@/lib/api";

// Analysten-Runde (angelehnt an Simons TradingAgents): mehrere KI-Standpunkte debattieren die
// Aktie und schließen mit einer ausgewogenen Synthese — alles aus dem Daten-Kontext, ein Aufruf.
const PROMPT =
  "Führe eine kurze Analysten-Runde zu dieser Aktie durch. Nutze ausschließlich die Daten im Kontext. " +
  "Gib nacheinander je einen prägnanten Standpunkt (2–3 Sätze) von:\n" +
  "**🐂 Bull-Analyst** (Chancen), **🐻 Bär-Analyst** (Gegenargumente), " +
  "**📊 Fundamental-Analyst** (Bewertung/Bilanz/Qualität), **📈 Technischer Analyst** (Trend/Momentum/RSI), " +
  "**🛡️ Risiko-Manager** (Risiko-Ampel/Beta/Verschuldung).\n" +
  "Schließe mit **⚖️ Synthese**: ein ausgewogenes Fazit, das beide Seiten wägt. " +
  "Keine Kauf/Verkauf-Empfehlung, keine Kursprognose, kein Timing — nur Einordnung. Antworte auf Deutsch, kompakt.";

export function AnalystPanel({ symbol, context }: { symbol: string; context: string }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [needConfig, setNeedConfig] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setErr(null); setNeedConfig(false);
    if (!hasLlm()) { setNeedConfig(true); return; }
    setLoading(true); setText("");
    try {
      await chatStream([{ role: "user", content: PROMPT }], context, {
        onDelta: (t) => setText((r) => r + t),
      });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Analysten-Runde fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassCard glow className="mb-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-semibold"><Users className="h-4 w-4 text-primary" /> Analysten-Runde</h3>
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/25 disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {text ? "Neue Runde" : "Runde starten"}
        </button>
      </div>

      {needConfig && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
          Noch keine KI verbunden. <Link to="/settings" className="text-primary">Erst deine KI verbinden</Link>.
        </div>
      )}
      {err && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {text ? (
        <>
          <div className="prose prose-sm prose-invert mt-4 max-w-none text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
          {!loading && <div className="mt-3"><SaveNoteButton kind="Analysten-Runde" title={`Analysten-Runde · ${symbol}`} content={text} /></div>}
        </>
      ) : !needConfig && !err && !loading ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Fünf KI-Perspektiven debattieren die Aktie (Bulle, Bär, Fundamental, Technik, Risiko) und schließen mit einer ausgewogenen Synthese —
          auf Basis aller Daten dieser Seite. <b className="text-foreground">Die Analyse kommt von deinem Modell.</b>
        </p>
      ) : null}
    </GlassCard>
  );
}
