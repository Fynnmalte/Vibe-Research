import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2 } from "lucide-react";
import { api, type WSearchHit } from "@/lib/api";

// Aktiensuche über Name / Ticker / ISIN. Auswahl → /stock-data?symbol=… (Detailseite lädt automatisch).
export function StockSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<WSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced Suche: 250ms nach letzter Eingabe.
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) { setHits([]); setOpen(false); return; }
    timer.current = window.setTimeout(() => {
      setLoading(true);
      api.wSearch(term)
        .then((r) => { setHits(r); setActive(0); setOpen(true); })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [q]);

  const pick = (h: WSearchHit) => {
    setOpen(false);
    setQ("");
    nav(`/stock-data?symbol=${encodeURIComponent(h.symbol)}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || hits.length === 0) {
      if (e.key === "Enter" && q.trim()) nav(`/stock-data?symbol=${encodeURIComponent(q.trim().toUpperCase())}`);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(hits[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-lg">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-black/20 px-3 focus-within:border-primary/50">
        {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => hits.length && setOpen(true)}
          placeholder="Aktie suchen — Name, Ticker oder ISIN (z.B. Siemens, AAPL, DE0007164600)"
          className="w-full bg-transparent py-2 text-sm outline-none"
        />
      </div>

      {open && hits.length > 0 && (
        <div className="glass absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-border/60 p-1 shadow-lg">
          {hits.map((h, i) => (
            <button
              key={h.symbol}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(h)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${i === active ? "bg-primary/15" : "hover:bg-muted/40"}`}
            >
              <span className="w-24 shrink-0 truncate font-mono text-xs text-primary">{h.symbol}</span>
              <span className="flex-1 truncate">{h.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{h.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
