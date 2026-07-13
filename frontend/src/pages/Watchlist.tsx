import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, X, RefreshCw, Star } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { api, type WQuote } from "@/lib/api";
import { loadWatch, saveWatch, addCodes } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

// Westliche Konvention: grün = steigend, rot = fallend.
const color = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted-foreground";
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
const num = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("de-DE", { maximumFractionDigits: 2 });

export function Watchlist() {
  const [codes, setCodes] = useState<string[]>(loadWatch);
  const [quotes, setQuotes] = useState<Record<string, WQuote>>({});
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const refresh = (cs: string[]) => {
    if (!cs.length) { setQuotes({}); return; }
    setLoading(true);
    api.wQuote(cs.join(",")).then(setQuotes).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { refresh(loadWatch()); }, []);

  const add = () => {
    const { next, added } = addCodes(codes, input);
    if (added === 0) {
      setHint(input.trim() ? "Kein neues Symbol erkannt (evtl. schon in der Watchlist)" : null);
      setInput("");
      return;
    }
    setCodes(next); saveWatch(next); setInput(""); setHint(`${added} hinzugefügt`);
    refresh(next);
  };
  const remove = (c: string) => {
    const next = codes.filter((x) => x !== c);
    setCodes(next); saveWatch(next); refresh(next);
  };

  const aiContext = useMemo(
    () =>
      codes.length
        ? "Meine Watchlist (lokal):\n" +
          codes
            .map((c) => {
              const q = quotes[c];
              return q
                ? `${q.name} (${c}) Kurs ${num(q.price)} ${q.currency ?? ""} ${pct(q.change_pct)} · ${q.exchange ?? ""}`
                : `${c} (Kurs nicht abrufbar)`;
            })
            .join("\n")
        : "Noch keine Watchlist-Titel.",
    [codes, quotes],
  );

  return (
    <div>
      <PageHeader
        title="Watchlist"
        subtitle="Titel im Stapel hinzufügen und auf einen Blick überblicken. Daten nur lokal, kein Upload."
        actions={
          codes.length > 0 && (
            <AskAiButton
              context={aiContext}
              label="KI die Watchlist lesen lassen"
              suggestions={["Wie haben sich diese Werte heute entwickelt", "Gruppiere sie nach Sektoren", "Was ist jeweils das größte Risiko"]}
            />
          )
        }
      />

      <GlassCard className="mb-4">
        <label className="mb-1.5 block text-xs text-muted-foreground">
          Stapel hinzufügen — Symbole einfügen (Komma / Leerzeichen / Zeilenumbruch getrennt).
          US-Ticker direkt (<code className="rounded bg-muted/50 px-1">AAPL</code>), Xetra mit{" "}
          <code className="rounded bg-muted/50 px-1">.DE</code>, Hongkong mit <code className="rounded bg-muted/50 px-1">.HK</code>.
        </label>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
            }}
            rows={2}
            placeholder={"z.B.: AAPL MSFT NVDA\nSAP.DE SIE.DE 0700.HK"}
            className="flex-1 resize-y rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <button
            onClick={add}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg bg-primary/15 px-4 text-sm font-medium text-primary shadow-glow hover:bg-primary/25"
          >
            <Plus className="h-4 w-4" /> Hinzufügen
          </button>
        </div>
        {hint && <p className="mt-2 text-xs text-muted-foreground/70">{hint}</p>}
      </GlassCard>

      <GlassCard glow>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <Star className="h-4 w-4 text-primary" /> Watchlist-Übersicht
            <span className="text-xs font-normal text-muted-foreground">({codes.length})</span>
          </h3>
          <button
            onClick={() => refresh(codes)}
            disabled={loading}
            className="text-muted-foreground hover:text-primary"
            title="Kurse aktualisieren"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
        {codes.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground/60">
            Noch keine Watchlist-Titel — oben eine Reihe Symbole einfügen, um sie im Stapel hinzuzufügen.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                  {["Name", "Symbol", "Kurs", "Veränd.%", "Vortagesschluss", "Währung", "Börse", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  const q = quotes[c];
                  return (
                    <tr key={c} className="border-b border-border/30">
                      <td className="px-2 py-2.5 font-medium">
                        <Link to={`/stock-data?symbol=${encodeURIComponent(c)}`} className="hover:text-primary">{q?.name || c}</Link>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-xs text-muted-foreground">{c}</td>
                      <td className={cn("px-2 py-2.5 font-mono", color(q?.change_pct))}>{q ? num(q.price) : "—"}</td>
                      <td className={cn("px-2 py-2.5 font-mono", color(q?.change_pct))}>{q ? pct(q.change_pct) : "—"}</td>
                      <td className="px-2 py-2.5 font-mono text-muted-foreground">{q ? num(q.prev_close) : "—"}</td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground">{q?.currency ?? "—"}</td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground">{q?.exchange ?? "—"}</td>
                      <td className="px-2 py-2.5">
                        <button
                          onClick={() => remove(c)}
                          className="text-muted-foreground/50 hover:text-destructive"
                          title="Entfernen"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <Disclaimer />
    </div>
  );
}
