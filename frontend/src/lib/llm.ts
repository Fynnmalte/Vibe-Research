// Nutzer-LLM-Konfiguration (nur in lokalem localStorage, kein Upload, nicht im Repository) + System-KI-Dialogaufrufe.

import { ApiError, authHeaders } from "./api";
import { isCliProvider, type ProviderId } from "./ai-models";

export interface LlmConfig {
  provider: ProviderId;
  baseURL: string; // bei CLI-Abo leer lassen
  apiKey: string;  // bei CLI-Abo leer lassen
  model: string;
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  trace: { tool: string; args: Record<string, unknown> }[];
  rounds: number;
}

const KEY = "vr-llm";

export function loadLlm(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as LlmConfig;
    // Abo (CLI): model reicht, ohne Key; API: braucht baseURL + Key + model.
    const ok = c.model && (isCliProvider(c.provider) || (c.baseURL && c.apiKey));
    return ok ? c : null;
  } catch {
    return null;
  }
}

export function saveLlm(cfg: LlmConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export function clearLlm() {
  localStorage.removeItem(KEY);
}

export function hasLlm(): boolean {
  return loadLlm() !== null;
}

export interface ChatHandlers {
  onDelta?: (text: string) => void;             // Antwort blockweise streamen
  onTool?: (tool: string, args: Record<string, unknown>) => void; // KI hat ein Datentool aufgerufen
}

// Backend /api/chat streamend aufrufen (NDJSON: ein Event pro Zeile {type: tool|delta|done|error}).
// Streamt und ruft onDelta/onTool auf; gibt das kumulierte finale {content, trace, rounds} zurück.
// signal: Aufrufer kann AbortController.signal übergeben, um beim Schließen/Frage-Wechsel abzubrechen (spart Abo/API-Kontingent).
export async function chatStream(messages: ChatMsg[], context: string, handlers: ChatHandlers = {}, signal?: AbortSignal): Promise<ChatResult> {
  const llm = loadLlm();
  if (!llm) throw new ApiError("Noch keine KI verbunden, bitte zuerst unter »KI verbinden« konfigurieren", 400);

  let resp: Response;
  try {
    resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ messages, context, llm }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e; // bewusster Abbruch, unverändert an Aufrufer werfen
    throw new ApiError("Keine Verbindung zum Backend, bitte zuerst das Backend starten (uvicorn app:app --port 8900)", 0);
  }
  // Konfigurationsfehler (fehlender Key / CLI nicht installiert) werden vor Streambeginn als HTTP 400 zurückgegeben
  if (!resp.ok) {
    let body: any = null;
    try { body = await resp.json(); } catch { /* ignore */ }
    if (resp.status === 401) {
      throw new ApiError("Das Backend hat Zugriffs-Auth aktiviert (VR_API_KEY): bitte unten auf der Seite »KI verbinden« den Backend-Zugriffsschlüssel eintragen", 401);
    }
    throw new ApiError(body?.detail || `HTTP ${resp.status}`, resp.status);
  }
  if (!resp.body) throw new ApiError("Kein Antwort-Stream vom Backend", 502);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let trace: ChatResult["trace"] = [];
  let rounds = 0;
  let errMsg: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let ev: any;
      try { ev = JSON.parse(t); } catch { continue; }
      if (ev.type === "delta") { content += ev.text; handlers.onDelta?.(ev.text); }
      else if (ev.type === "tool") { handlers.onTool?.(ev.tool, ev.args || {}); }
      else if (ev.type === "done") { trace = ev.trace || []; rounds = ev.rounds || 0; }
      else if (ev.type === "error") { errMsg = ev.message; }
    }
  }
  if (errMsg) throw new ApiError(errMsg, 502);
  return { content, trace, rounds };
}

// Nicht-streamende Convenience-Hülle (für Aufrufer ohne zeichenweise UI).
export function chat(messages: ChatMsg[], context: string): Promise<ChatResult> {
  return chatStream(messages, context);
}
