import { useState } from "react";
import { Check, BookmarkPlus } from "lucide-react";
import { addNote } from "@/lib/notes";

// Speichert ein KI-Ergebnis in den »Notizen«. Lokal, kein Upload.
export function SaveNoteButton({ kind, title, content }: { kind: string; title: string; content: string }) {
  const [saved, setSaved] = useState(false);
  if (!content.trim()) return null;
  return (
    <button
      onClick={() => { addNote(kind, title, content); setSaved(true); }}
      disabled={saved}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
    >
      {saved ? (<><Check className="h-3.5 w-3.5" /> Gespeichert</>) : (<><BookmarkPlus className="h-3.5 w-3.5" /> Speichern</>)}
    </button>
  );
}
