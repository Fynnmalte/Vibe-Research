// Notizen — KI-Rückblicke / Kernpunkte / KI-Fragen lokal speichern, als persönliche Research-Aufzeichnung.
// Nur in lokalem localStorage, kein Upload, nicht im Repository. Entspricht Ebene 7 »Sammlung« des Research-Frameworks.

export interface Note {
  id: string;
  kind: string;   // Rückblick / Kernpunkte / KI-Frage
  title: string;  // z.B. »Tagesrückblick 2026-07-04«, »KI-Rechenleistung Kernpunkte«, »KI fragen · 600519«
  content: string; // Markdown-Inhalt
  ts: number;      // Speicher-Zeitstempel (ms)
}

const KEY = "vr-notes";
const MAX = 200;

export function loadNotes(): Note[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function persist(notes: Note[]) {
  localStorage.setItem(KEY, JSON.stringify(notes.slice(0, MAX)));
}

// Neue Notiz nach oben. Gibt die aktualisierte vollständige Liste zurück.
export function addNote(kind: string, title: string, content: string): Note[] {
  const note: Note = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    title,
    content,
    ts: Date.now(),
  };
  const next = [note, ...loadNotes()];
  persist(next);
  return next;
}

export function deleteNote(id: string): Note[] {
  const next = loadNotes().filter((n) => n.id !== id);
  persist(next);
  return next;
}

export function clearNotes() {
  localStorage.removeItem(KEY);
}
