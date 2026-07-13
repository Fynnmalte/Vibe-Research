import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, FileText, Trash2, Download, Loader2, FolderOpen } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, downloadReport, type MyReport } from "@/lib/api";
import { cn } from "@/lib/utils";

const fmtSize = (b: number) =>
  b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(0)}KB` : `${(b / 1048576).toFixed(1)}MB`;
const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });

// Datei als dataURL lesen (inkl. base64); das Backend entfernt das data:-Präfix.
const fileToB64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function MyReports() {
  const [reports, setReports] = useState<MyReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setReports(await api.myReports());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Analysen-Liste konnte nicht geladen werden");
    }
  };
  useEffect(() => {
    load();
  }, []);

  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    setErr(null);
    try {
      for (const f of Array.from(files)) {
        const b64 = await fileToB64(f);
        await api.uploadReport(f.name, b64);
      }
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: MyReport) => {
    if (!confirm(`»${r.name}« löschen? (wird auch aus dem lokalen Archivordner entfernt)`)) return;
    try {
      await api.deleteReport(r.id);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen");
    }
  };

  const download = async (r: MyReport) => {
    try {
      await downloadReport(r.id, r.name);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Download fehlgeschlagen");
    }
  };

  const grouped = useMemo(() => {
    const g: Record<string, MyReport[]> = {};
    for (const r of reports) (g[r.industry] ||= []).push(r);
    // »Nicht kategorisiert« ans Ende, Rest nach Anzahl absteigend
    return Object.entries(g).sort((a, b) =>
      a[0] === "Nicht kategorisiert" ? 1 : b[0] === "Nicht kategorisiert" ? -1 : b[1].length - a[1].length,
    );
  }, [reports]);

  return (
    <div>
      <PageHeader
        title="Meine Analysen"
        subtitle="Eigene Analysen zum Archivieren hierher ziehen, automatisch nach Branche sortiert. Dateien bleiben nur im lokalen Deployment-Ordner, kein Upload, nicht in irgendein Repository."
      />

      {/* Upload-Bereich */}
      <GlassCard className="mb-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-10 text-center transition-colors",
            drag ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-primary/5",
          )}
        >
          {busy ? (
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          ) : (
            <Upload className="h-7 w-7 text-primary" />
          )}
          <p className="text-sm font-medium">
            {busy ? "Lädt hoch…" : "Analysen hierher ziehen oder klicken, um Dateien zu wählen"}
          </p>
          <p className="text-xs text-muted-foreground/70">
            Unterstützt PDF / Word / txt / md / Tabellen / Bilder, je ≤ 25MB, Mehrfachauswahl möglich
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt,.md,.markdown,.csv,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </GlassCard>

      {err && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {/* Liste (nach Branche gruppiert) */}
      {reports.length === 0 ? (
        <GlassCard>
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <FolderOpen className="h-8 w-8 text-muted-foreground/40" />
            Noch keine archivierten Analysen. Zieh deine gesammelten Analysen in das Feld oben, sie werden automatisch nach Branche sortiert.
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {grouped.map(([industry, items]) => (
            <GlassCard key={industry}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <span className="rounded bg-primary/15 px-2 py-0.5 text-xs text-primary">{industry}</span>
                <span className="text-xs font-normal text-muted-foreground">{items.length} Stück</span>
              </h3>
              <div className="divide-y divide-border/30">
                {items.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 py-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground/60">
                        {fmtSize(r.size)} · {fmtDate(r.ts)}
                      </p>
                    </div>
                    <button
                      onClick={() => download(r)}
                      className="shrink-0 text-muted-foreground/60 hover:text-primary"
                      title="Herunterladen"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(r)}
                      className="shrink-0 text-muted-foreground/50 hover:text-destructive"
                      title="Löschen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <Disclaimer />
    </div>
  );
}
