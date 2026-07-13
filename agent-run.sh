#!/usr/bin/env bash
# Ein Überwachungslauf (Thesen prüfen → Telegram + Journal). Für cron/launchd geeignet.
# Loggt mit Zeitstempel; verhindert per Lock parallele Läufe.
set -euo pipefail
cd "$(dirname "$0")"

LOCK="/tmp/vibe-agent.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') übersprungen (läuft bereits)"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

[ -f .env ] && { set -a; . ./.env; set +a; }

# CA-Bundle (certifi) — macOS/python.org-Python hat keins; sonst scheitern HTTPS
# (Datenquellen) und die Telegram-API still.
if [ -z "${SSL_CERT_FILE:-}" ]; then
  CERT="$(backend/.venv/bin/python -c 'import certifi,sys; sys.stdout.write(certifi.where())' 2>/dev/null || true)"
  [ -n "$CERT" ] && export SSL_CERT_FILE="$CERT" REQUESTS_CA_BUNDLE="$CERT"
fi

cd backend  # agent.py liegt hier → importierbar
OUT="$(.venv/bin/python -c 'import agent, json; print(json.dumps(agent.run_once(), ensure_ascii=False))' 2>&1)"
echo "$(date '+%F %T') $OUT"
