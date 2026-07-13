#!/usr/bin/env bash
# Fragt den RapidAPI-Key (Yahoo Finance) ab und schreibt ihn korrekt nach .env.
# Key wird nicht angezeigt und landet nicht in der Shell-History.
set -euo pipefail
cd "$(dirname "$0")"

HOST="${1:-yahoo-finance-real-time1.p.rapidapi.com}"
printf 'RapidAPI-Key (X-RapidAPI-Key) einfügen und Enter: '
read -r KEY
KEY="${KEY//[[:space:]]/}"   # Leerzeichen/Zeilenumbrüche entfernen

if [ -z "$KEY" ]; then echo "Kein Key eingegeben, abgebrochen."; exit 1; fi

# .env MERGEN statt überschreiben: nur die YH_RAPIDAPI_*-Zeilen ersetzen/ergänzen,
# alle anderen Keys (FMP_API_KEY, TELEGRAM_*) bleiben erhalten.
touch .env
tmp="$(mktemp)"
grep -vE '^(YH_RAPIDAPI_KEY|YH_RAPIDAPI_HOST)=' .env > "$tmp" || true
printf 'YH_RAPIDAPI_KEY=%s\nYH_RAPIDAPI_HOST=%s\n' "$KEY" "$HOST" >> "$tmp"
mv "$tmp" .env
chmod 600 .env
echo "Gespeichert in .env (${#KEY} Zeichen, Host $HOST) — übrige Keys erhalten. Jetzt ./start.sh ausführen."
