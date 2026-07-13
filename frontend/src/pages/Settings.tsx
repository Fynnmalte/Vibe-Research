import { useState } from "react";
import { KeyRound, Sparkles, ShieldCheck, Check, Trash2, Terminal } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { toast } from "sonner";
import { loadLlm, saveLlm, clearLlm } from "@/lib/llm";
import { loadAccessKey, saveAccessKey } from "@/lib/api";
import { subscriptionModels, apiModels, PROVIDER_BASE, isCliProvider, aiModels, type ProviderId } from "@/lib/ai-models";

export function Settings() {
  const existing = loadLlm();
  const existingIsCli = existing ? isCliProvider(existing.provider) : false;

  const [mode, setMode] = useState<"api" | "subscription">(existing && existingIsCli ? "subscription" : "api");
  // Abo: gewählte CLI-model-id
  const [cliId, setCliId] = useState(existing && existingIsCli ? existing.model : "");
  // API: gewählte model-id + editierbare baseURL / model / key
  const firstApi = apiModels[0];
  const [apiId, setApiId] = useState(existing && !existingIsCli ? existing.model : firstApi.id);
  const [baseURL, setBaseURL] = useState(existing && !existingIsCli ? existing.baseURL : (PROVIDER_BASE[firstApi.provider] || ""));
  const [modelName, setModelName] = useState(existing && !existingIsCli ? existing.model : firstApi.id);
  const [apiKey, setApiKey] = useState(existing && !existingIsCli ? existing.apiKey : "");
  // Backend-Zugriffsschlüssel (entspricht VR_API_KEY beim Deployment); bei lokaler Nutzung ohne Auth leer lassen
  const [accessKey, setAccessKey] = useState(loadAccessKey());

  const providerOf = (id: string): ProviderId => aiModels.find((m) => m.id === id)?.provider ?? "openai-compatible";

  const pickApiModel = (id: string) => {
    const m = apiModels.find((x) => x.id === id);
    if (!m) return;
    setApiId(id);
    setModelName(id);
    setBaseURL(PROVIDER_BASE[m.provider] || "");
  };

  const saveApi = () => {
    if (!baseURL.trim() || !apiKey.trim() || !modelName.trim()) {
      toast.error("Bitte Base URL, API Key und Model ausfüllen");
      return;
    }
    saveLlm({ provider: providerOf(apiId), baseURL: baseURL.trim(), apiKey: apiKey.trim(), model: modelName.trim() });
    toast.success("Lokal gespeichert, »KI fragen / Rückblick« ist jetzt überall verfügbar");
  };

  const saveSubscription = () => {
    const m = subscriptionModels.find((x) => x.id === cliId);
    if (!m || m.comingSoon) {
      toast.error("Bitte ein verfügbares Abo wählen (mit »bald verfügbar« markierte werden noch nicht unterstützt)");
      return;
    }
    saveLlm({ provider: m.provider, baseURL: "", apiKey: "", model: m.id });
    toast.success(`Abo »${m.name}« gewählt, »KI fragen / Rückblick« nutzt überall das lokale ${m.name}`);
  };

  const forget = () => {
    clearLlm();
    setApiKey("");
    setCliId("");
    toast.success("Lokale Konfiguration gelöscht");
  };

  const saveAccess = () => {
    const k = accessKey.trim();
    saveAccessKey(k);
    setAccessKey(k);
    toast.success(k ? "Backend-Zugriffsschlüssel gespeichert (lokal)" : "Backend-Zugriffsschlüssel gelöscht");
  };

  return (
    <div>
      <PageHeader title="KI verbinden" subtitle="Einmal konfigurieren, dann nutzen »KI fragen« und »Rückblick« überall dein eigenes Modell" />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/25 bg-success/5 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <span>Der API Key bleibt <b className="text-foreground">nur in deinem lokalen Browser</b> und wird nur bei deiner Frage an dein eigenes Backend gesendet, um das Modell aufzurufen — kein Upload, nicht im Repository. Alle Analysen stammen von deinem Modell, dieses Produkt kalibriert nicht.</span>
      </div>

      {/* Zwei Verbindungsarten */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <GlassCard glow={mode === "subscription"} onClick={() => setMode("subscription")}
          className={mode === "subscription" ? "ring-1 ring-primary/40" : "opacity-80"}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Abo-Verbindung</h3>
            {mode === "subscription" && <Check className="ml-auto h-4 w-4 text-primary" />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Nutzt eine lokal eingeloggte KI-CLI (Claude Code / Qwen / DeepSeek / Codex…) mit deinem Abo-Kontingent, <b className="text-foreground">ohne API Key</b>. Backend muss lokal laufen.</p>
        </GlassCard>

        <GlassCard glow={mode === "api"} onClick={() => setMode("api")}
          className={mode === "api" ? "ring-1 ring-primary/40" : "opacity-80"}>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">API-Verbindung</h3>
            {mode === "api" && <Check className="ml-auto h-4 w-4 text-primary" />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">API Key einfügen, unterstützt DeepSeek / Doubao / MiniMax / OpenAI / OpenRouter / jeden kompatiblen Endpunkt. <b className="text-foreground">Sofort einsatzbereit.</b></p>
        </GlassCard>
      </div>

      <GlassCard>
        {mode === "subscription" ? (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Wähle eine lokal installierte und eingeloggte CLI. Das Vibe-Research-Backend nutzt sie mit deinem Abo-Kontingent zum Antworten, <b className="text-foreground">ohne Key</b>.
              <span className="text-muted-foreground/60">(Nur verfügbar, wenn das Backend lokal läuft; für Rückblick / Kernpunkte heute / KI-Fragen zu Aktien.)</span>
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {subscriptionModels.map((m) => {
                const on = cliId === m.id;
                return (
                  <button key={m.id} disabled={m.comingSoon} onClick={() => setCliId(m.id)}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      m.comingSoon
                        ? "cursor-not-allowed border-border/50 opacity-40"
                        : on
                        ? "border-primary/50 bg-primary/10"
                        : "border-border hover:bg-muted/40"
                    }`}>
                    <Terminal className={`h-4 w-4 shrink-0 ${on ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        {m.name}
                        {m.comingSoon && <span className="rounded bg-muted/60 px-1 py-0.5 text-[9px] text-muted-foreground">bald verfügbar</span>}
                        {on && <Check className="h-3.5 w-3.5 text-primary" />}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{m.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={saveSubscription} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25">
                Speichern
              </button>
              {existing && (
                <button onClick={forget} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" /> Löschen
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Modell wählen</label>
              <select value={apiId} onChange={(e) => pickApiModel(e.target.value)}
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50">
                {apiModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} —— {m.description}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Base URL</label>
              <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.deepseek.com"
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Model</label>
              <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Modellname (bei Doubao die ep-… Endpunkt-ID)"
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">API Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…"
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
            </div>

            <div className="flex items-center gap-2">
              <button onClick={saveApi} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25">
                Speichern (lokal)
              </button>
              {existing && (
                <button onClick={forget} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" /> Löschen
                </button>
              )}
            </div>
          </div>
        )}
      </GlassCard>

      {/* Backend-Zugriffsschlüssel: nur nötig, wenn das Backend beim Deployment VR_API_KEY gesetzt hat (Schutz im öffentlichen Netz) */}
      <GlassCard className="mt-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-primary" /> Backend-Zugriffsschlüssel (optional)
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Nur nötig, wenn das Backend beim Deployment <code className="rounded bg-muted/50 px-1">VR_API_KEY</code> gesetzt hat (Schutz bei öffentlichem Deployment) — dann denselben Wert eintragen;
          bei lokaler Nutzung ohne Auth leer lassen. Wird ebenfalls nur im lokalen Browser gespeichert.
        </p>
        <div className="flex items-center gap-2">
          <input type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder="Muss mit VR_API_KEY des Backends übereinstimmen"
            className="flex-1 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          <button onClick={saveAccess} className="rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/25">
            Speichern
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
