#!/usr/bin/env bash
# Produktionsstart (von launchd oder manuell): .env laden, Backend serviert
# App + API auf http://127.0.0.1:8900. Voraussetzung: frontend/dist gebaut.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then set -a; . ./.env; set +a; fi

# launchd startet Dienste mit minimalem PATH (/usr/bin:/bin:…). Damit die
# Abo-KI-Anbindung (CLI wie `claude` / `codex`, oft via nvm/homebrew/npm-global
# installiert) gefunden wird, den vollen PATH der Login-Shell übernehmen.
if [ -x /bin/zsh ]; then
  LOGIN_PATH="$(/bin/zsh -lic 'printf %s "$PATH"' 2>/dev/null || true)"
  [ -n "$LOGIN_PATH" ] && export PATH="$LOGIN_PATH"
fi

# macOS/python.org-Python liefert kein CA-Bundle mit — ohne das schlägt jede
# HTTPS-Verifikation fehl (Yahoo/RapidAPI liefern dann still leere Daten).
# certifi aus dem venv als Standard-Bundle setzen, falls nicht schon gesetzt.
if [ -z "${SSL_CERT_FILE:-}" ]; then
  CERT="$(backend/.venv/bin/python -c 'import certifi,sys; sys.stdout.write(certifi.where())' 2>/dev/null || true)"
  [ -n "$CERT" ] && export SSL_CERT_FILE="$CERT" REQUESTS_CA_BUNDLE="$CERT"
fi

cd backend
exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8900
