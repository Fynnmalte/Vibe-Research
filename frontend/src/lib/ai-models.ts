// Modell-Liste für die KI-Verbindung (portiert aus SDesign-opensource / open-design, für Vibe-Research angepasst).
// Zwei Arten:
//   Abo-Version (provider "cli-*") = ruft eine lokal eingeloggte CLI mit Abo-Kontingent auf, ohne API Key (nur lokal self-hosted).
//   API-Version = eigenen Key eintragen, über OpenAI-kompatibles /chat/completions.
// Der Key bleibt immer nur im lokalen Browser und wird mit der Anfrage an dein eigenes Backend gesendet; kein Upload, nicht im Repository.

export type ProviderId =
  | "deepseek"
  | "silicon"
  | "openai"
  | "minimax"
  | "openrouter"
  | "groq"
  | "together"
  | "mimo"
  | "openai-compatible"
  | "cli-claude"
  | "cli-qwen"
  | "cli-deepseek"
  | "cli-codex"
  | "cli-opencode"
  | "cli-cursor"
  | "cli-kimi";

export interface ModelConfig {
  id: string;        // tatsächlicher model-Name für Endpunkt/CLI
  name: string;      // Markenname in der Dropdown-Anzeige
  description: string;
  provider: ProviderId;
  comingSoon?: boolean; // true = gelistet, aber noch nicht wählbar (in Entwicklung)
}

export const isCliProvider = (p: ProviderId): boolean => p.startsWith("cli-");

// Standard-Endpunkt-Adressen je API-Provider (OpenAI-kompatibel). Bei Auswahl wird baseURL automatisch gefüllt, Nutzer trägt nur den Key ein.
export const PROVIDER_BASE: Partial<Record<ProviderId, string>> = {
  deepseek: "https://api.deepseek.com",
  silicon: "https://api.siliconflow.cn/v1",
  openai: "https://api.openai.com/v1",
  minimax: "https://api.minimaxi.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  mimo: "", // Privates Gateway, baseURL muss selbst eingetragen werden
  "openai-compatible": "", // Beliebiger kompatibler Endpunkt, selbst eintragen
};

export const aiModels: ModelConfig[] = [
  // —— Abo-Version (ohne API Key, ruft lokal eingeloggte CLI) ——
  { id: "claude-code", name: "Claude Code", description: "Nutzt lokales Claude-Abo", provider: "cli-claude" },
  { id: "qwen-code", name: "Qwen Code", description: "Qwen-Code-Abo", provider: "cli-qwen" },
  { id: "deepseek-cli", name: "DeepSeek CLI", description: "DeepSeek lokales CLI-Abo", provider: "cli-deepseek" },
  { id: "codex", name: "Codex", description: "OpenAI-Codex-Abo (erfordert codex login)", provider: "cli-codex" },
  { id: "opencode", name: "OpenCode", description: "OpenCode-Abo", provider: "cli-opencode", comingSoon: true },
  { id: "cursor-agent", name: "Cursor Agent", description: "Cursor-Agent-Abo", provider: "cli-cursor", comingSoon: true },
  { id: "kimi", name: "Kimi", description: "Kimi-Abo", provider: "cli-kimi", comingSoon: true },
  // —— API-Version (eigenen Key eintragen) ——
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", description: "DeepSeek offiziell · schnell & günstig · Denk-/Nicht-Denk-Modus", provider: "deepseek" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", description: "DeepSeek offiziell · Flaggschiff · stärkstes Reasoning", provider: "deepseek" },
  { id: "deepseek-ai/DeepSeek-V3", name: "SiliconFlow · DeepSeek V3", description: "SiliconFlow", provider: "silicon" },
  { id: "gpt-4o", name: "OpenAI GPT-4o", description: "OpenAI", provider: "openai" },
  { id: "MiniMax-M2", name: "MiniMax M2", description: "MiniMax Hailuo", provider: "minimax" },
  { id: "doubao-pro", name: "Doubao Pro", description: "Volcano Ark · Reasoning-Endpunkt-ID eintragen (ep-…)", provider: "openai-compatible" },
  { id: "openai/gpt-4o", name: "OpenRouter · GPT-4o", description: "OpenRouter-Aggregator (beliebige model-id möglich)", provider: "openrouter" },
  { id: "llama-3.3-70b-versatile", name: "Groq · Llama 3.3 70B", description: "Groq ultraschnelles Reasoning", provider: "groq" },
  { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Together · Llama 3.3 70B", description: "Together AI", provider: "together" },
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", description: "Xiaomi MiMo (eigenes Gateway nötig)", provider: "mimo" },
  { id: "custom", name: "Anderer OpenAI-kompatibler", description: "Beliebiger kompatibler Endpunkt, baseURL/model selbst eintragen", provider: "openai-compatible" },
];

export const subscriptionModels = aiModels.filter((m) => isCliProvider(m.provider));
export const apiModels = aiModels.filter((m) => !isCliProvider(m.provider));
