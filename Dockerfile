# Vibe-Research als ein Container — bündelt Node-Build + Python-Runtime.
# Der Nutzer braucht nur Docker, sonst nichts (kein Python/Node lokal).
#
#   docker compose up -d      → App auf http://localhost:8900
#
# Hinweis: KI-Abo-Verbindung (lokale CLI wie `claude`) geht im Container NICHT —
# der Container sieht deine Host-CLI nicht. Im Docker-Betrieb die API-Verbindung
# nutzen (eigener Key in „KI verbinden"). Nativ (./autostart.sh) für Abo-Modus.

# ---- Stufe 1: Frontend bauen (Node) ----
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stufe 2: Python-Runtime (serviert Backend-API + gebautes Frontend) ----
FROM python:3.12-slim AS runtime
# ca-certificates: HTTPS zu CNBC/Yahoo/FMP. curl: Healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# gebautes Frontend an den von app.py erwarteten Ort: /app/frontend/dist
COPY --from=frontend /app/frontend/dist /app/frontend/dist

# Nutzerdaten (Portfolio / Notizen / Analysen) liegen in .cache → als Volume mounten
VOLUME ["/app/backend/.cache"]

EXPOSE 8900
# im Container an alle Interfaces binden, damit der Host-Port-Mapping greift
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8900"]
