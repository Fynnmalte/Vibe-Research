// Watchlist (beobachtete Aktien) — nur in lokalem localStorage, kein Upload, nicht im Repository.
// Kurse über /api/w/quote (Yahoo); beim Rückblick werden die Watchlist-Kurse mit an die eigene KI des Nutzers gegeben.

const KEY = "vr-watchlist";

// Yahoo-Schreibweise: AAPL (US), SAP.DE (Xetra), 0700.HK (Hongkong), BRK-B (Klasse B), ^GDAXI (Index).
// Bewusst permissiv — was Yahoo nicht kennt, fällt beim Abruf einfach raus.
const SYMBOL = /^[A-Z0-9^][A-Z0-9.\-]{0,11}$/;

const normalize = (s: string) => s.trim().toUpperCase();

export function loadWatch(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.map(normalize).filter((c) => SYMBOL.test(c)) : [];
  } catch {
    return [];
  }
}

export function saveWatch(codes: string[]) {
  localStorage.setItem(KEY, JSON.stringify(codes));
}

// Extrahiert Symbole aus beliebigem Text (Komma / Leerzeichen / Zeilenumbruch getrennt).
export function parseCodes(raw: string): string[] {
  const tokens = raw.split(/[,;\s]+/).map(normalize).filter(Boolean);
  return Array.from(new Set(tokens.filter((t) => SYMBOL.test(t))));
}

// Fügt eine Reihe eingegebener Symbole zur bestehenden Watchlist hinzu, gibt die deduplizierte neue Liste + tatsächliche Anzahl neuer Einträge zurück.
export function addCodes(existing: string[], raw: string): { next: string[]; added: number } {
  const incoming = parseCodes(raw).filter((c) => !existing.includes(c));
  return { next: [...existing, ...incoming], added: incoming.length };
}
