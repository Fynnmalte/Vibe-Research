#!/usr/bin/env bash
# Startet Backend (:8900) und Frontend (:5899). Beenden mit Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")"

cleanup() { echo; echo "Stoppe Server…"; kill 0; }
trap cleanup EXIT INT TERM

# RapidAPI-Key (Yahoo Finance) aus .env laden — Primärquelle für US/EU/HK.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# CA-Bundle (certifi) setzen — python.org-Python auf macOS hat sonst keins,
# HTTPS-Verifikation (Yahoo/RapidAPI) schlägt dann fehl.
if [ -z "${SSL_CERT_FILE:-}" ]; then
  CERT="$(backend/.venv/bin/python -c 'import certifi,sys; sys.stdout.write(certifi.where())' 2>/dev/null || true)"
  [ -n "$CERT" ] && export SSL_CERT_FILE="$CERT" REQUESTS_CA_BUNDLE="$CERT"
fi
[ -n "${YH_RAPIDAPI_KEY:-}" ] && echo "Datenquelle: RapidAPI (Key aktiv)" || echo "Datenquelle: anonymes Yahoo (kein Key — drosselt)"
[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && echo "Telegram-Agent: konfiguriert" || echo "Telegram-Agent: aus (kein Bot-Token)"

echo "Backend  → http://127.0.0.1:8900"
(cd backend && .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8900) &

echo "Frontend → http://localhost:5899"
(cd frontend && npm run dev) &

wait
