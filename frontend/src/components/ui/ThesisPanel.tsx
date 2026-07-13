import { useEffect, useState } from "react";
import { Target, Plus, Trash2, Check, X, Loader2, PencilLine } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, type Thesis, type ThesisEval, type ThesisCond } from "@/lib/api";
import { cn } from "@/lib/utils";

const METRICS: Record<string, string> = {
  price: "Kurs",
  change_pct: "Tagesveränderung %",
  pe: "KGV (TTM)",
  forward_pe: "Forward-KGV",
  eps: "EPS",
  mcap: "Marktkapitalisierung",
  week52_pos: "52W-Position %",
};
const OPS = ["<", "<=", ">", ">=", "==", "!="];

export function ThesisPanel({ symbol, onContext }: { symbol: string; onContext?: (s: string) => void }) {
  const [thesis, setThesis] = useState<Thesis | null>(null);
  const [evalx, setEvalx] = useState<ThesisEval | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [conds, setConds] = useState<ThesisCond[]>([]);
  const [journalInput, setJournalInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.thesisGet(symbol).then(({ thesis, evaluation }) => {
      setThesis(thesis);
      setEvalx(evaluation);
      if (onContext) onContext(contextOf(thesis, evaluation));
    }).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [symbol]);

  const startEdit = () => {
    setText(thesis?.text || "");
    setConds(thesis?.conditions?.length ? [...thesis.conditions] : [{ metric: "pe", op: "<", value: 25 }]);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const t = await api.thesisSave(symbol, text, conds.filter((c) => Number.isFinite(c.value)));
      setThesis(t);
      setEditing(false);
      load();
    } finally { setBusy(false); }
  };

  const del = async () => {
    if (!confirm("These und Journal löschen?")) return;
    await api.thesisDelete(symbol);
    setThesis(null); setEvalx(null);
  };

  const addJournal = async () => {
    const c = journalInput.trim();
    if (!c) return;
    setBusy(true);
    try { setThesis(await api.thesisJournal(symbol, "Notiz", c)); setJournalInput(""); }
    finally { setBusy(false); }
  };

  const setCond = (i: number, patch: Partial<ThesisCond>) =>
    setConds((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <GlassCard className="mb-4">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Meine These</h3>
        {evalx?.exists && evalx.total ? (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
            evalx.all_ok ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
            {evalx.held}/{evalx.total} Annahmen halten
          </span>
        ) : null}
        {thesis && !editing && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={startEdit} className="text-muted-foreground hover:text-primary" title="Bearbeiten"><PencilLine className="h-3.5 w-3.5" /></button>
            <button onClick={del} className="text-muted-foreground hover:text-destructive" title="Löschen"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Warum hältst / beobachtest du diese Aktie? Deine These in eigenen Worten."
            className="w-full resize-y rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Überprüfbare Bedingungen (werden gegen Live-Daten geprüft):</p>
            <div className="space-y-2">
              {conds.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select value={c.metric} onChange={(e) => setCond(i, { metric: e.target.value })}
                    className="rounded-lg border border-border bg-black/20 px-2 py-1.5 text-sm outline-none">
                    {Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}
                    className="rounded-lg border border-border bg-black/20 px-2 py-1.5 text-sm outline-none">
                    {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input type="number" value={c.value}
                    onChange={(e) => setCond(i, { value: parseFloat(e.target.value) })}
                    className="w-24 rounded-lg border border-border bg-black/20 px-2 py-1.5 text-sm outline-none focus:border-primary/50" />
                  <button onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))}
                    className="text-muted-foreground/50 hover:text-destructive"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setConds((cs) => [...cs, { metric: "pe", op: "<", value: 25 }])}
              className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
              <Plus className="h-3.5 w-3.5" /> Bedingung hinzufügen
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/25 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Speichern
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Abbrechen</button>
          </div>
        </div>
      ) : !thesis ? (
        <div className="py-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Halte fest, <b className="text-foreground">warum</b> du diese Aktie beobachtest — und welche Bedingungen deine These stützen.
            Vibe-Research prüft sie laufend gegen die Live-Daten und meldet, wenn eine Annahme kippt. Das bieten Broker nicht.
          </p>
          <button onClick={startEdit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/25">
            <Plus className="h-4 w-4" /> These anlegen
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {thesis.text && <p className="whitespace-pre-wrap text-sm text-foreground">{thesis.text}</p>}

          {evalx?.checks && evalx.checks.length > 0 && (
            <div className="space-y-1.5">
              {evalx.checks.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {c.ok === null
                    ? <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />
                    : c.ok
                    ? <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                    : <X className="h-3.5 w-3.5 shrink-0 text-danger" />}
                  <span className="text-muted-foreground">{c.label} {c.op} {c.value}</span>
                  <span className={cn("ml-auto font-mono text-xs", c.ok === null ? "text-muted-foreground/50" : c.ok ? "text-success" : "text-danger")}>
                    aktuell {c.actual ?? "—"}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-muted-foreground/50">Stand {evalx.as_of} · deterministisch gegen Live-Daten geprüft, keine KI</p>
            </div>
          )}

          {/* Journal */}
          <div className="border-t border-border/40 pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Journal</p>
            <div className="mb-2 flex gap-2">
              <input value={journalInput} onChange={(e) => setJournalInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addJournal()}
                placeholder="Notiz zur These hinzufügen…"
                className="flex-1 rounded-lg border border-border bg-black/20 px-3 py-1.5 text-sm outline-none focus:border-primary/50" />
              <button onClick={addJournal} disabled={busy}
                className="rounded-lg bg-primary/15 px-3 py-1.5 text-sm text-primary hover:bg-primary/25 disabled:opacity-50"><Plus className="h-4 w-4" /></button>
            </div>
            {thesis.journal.length === 0 ? (
              <p className="text-xs text-muted-foreground/50">Noch keine Einträge. Speichere KI-Briefings oder eigene Notizen hier als datierten Verlauf.</p>
            ) : (
              <div className="space-y-2">
                {thesis.journal.map((e, i) => (
                  <div key={i} className="border-b border-border/30 pb-2 last:border-0">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
                      <span className="rounded bg-muted/50 px-1.5 py-0.5">{e.kind}</span>
                      <span className="font-mono">{e.ts}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{e.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </GlassCard>
  );
}

// Kontext-String für das KI-Briefing (These + Auswertung), damit die KI sie berücksichtigt.
function contextOf(t: Thesis | null, e: ThesisEval): string {
  if (!t) return "";
  const checks = (e.checks || []).map((c) =>
    `${c.label} ${c.op} ${c.value} → aktuell ${c.actual ?? "—"} (${c.ok === null ? "unbekannt" : c.ok ? "hält" : "verletzt"})`).join("; ");
  return `\nMeine These: ${t.text}` + (checks ? `\nBedingungen: ${checks}` : "");
}
