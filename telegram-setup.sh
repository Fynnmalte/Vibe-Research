#!/usr/bin/env bash
# Telegram einrichten — mit Sofort-Prüfung.
# 1) Bot bei @BotFather: /newbot oder /token → Token holen.
# 2) dem Bot in Telegram IRGENDEINE Nachricht schicken.
# 3) dieses Skript ausführen, Token einfügen.
set -euo pipefail
cd "$(dirname "$0")"

printf 'Telegram Bot-Token einfügen und Enter: '
read -r TOKEN
# nur echte Leerraumzeichen entfernen (Space/Tab/Zeilenumbruch), Token selbst unangetastet
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
[ -z "$TOKEN" ] && { echo "Kein Token eingegeben."; exit 1; }

# --- Token sofort bei Telegram prüfen ---
ME=$(curl -s -m10 "https://api.telegram.org/bot${TOKEN}/getMe")
if ! printf '%s' "$ME" | grep -q '"ok":true'; then
  DESC=$(printf '%s' "$ME" | grep -o '"description":"[^"]*"' | cut -d'"' -f4)
  echo "❌ Token UNGÜLTIG (Telegram: ${DESC:-unbekannt})."
  echo "   → @BotFather: /token senden, Bot wählen, den DORT angezeigten Token nehmen."
  echo "   → Der Teil nach dem : muss anders sein als beim alten Token."
  exit 1
fi
BOT=$(printf '%s' "$ME" | grep -o '"username":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "✅ Token gültig — Bot: @${BOT}"

# --- Chat-ID aus letzten Updates ---
CHAT=$(curl -s -m10 "https://api.telegram.org/bot${TOKEN}/getUpdates" \
  | grep -oE '"chat":\{"id":-?[0-9]+' | grep -oE '\-?[0-9]+$' | tail -1)
if [ -z "$CHAT" ]; then
  echo "⚠️  Keine Chat-ID gefunden. Schick @${BOT} in Telegram eine Nachricht, dann Skript nochmal."
  exit 1
fi
echo "✅ Chat-ID: ${CHAT}"

# --- speichern (nur Telegram-Zeilen ersetzen) ---
touch .env
grep -v -E '^TELEGRAM_(BOT_TOKEN|CHAT_ID)=' .env > .env.tmp || true
printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\n' "$TOKEN" "$CHAT" >> .env.tmp
mv .env.tmp .env

# --- Test-Nachricht sofort ---
SENT=$(curl -s -m10 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT}" \
  --data-urlencode "text=✅ Vibe-Research verbunden. Ab jetzt kommen hier deine Hinweise.")
if printf '%s' "$SENT" | grep -q '"ok":true'; then
  echo "✅ Test-Nachricht gesendet — schau in Telegram. Jetzt ./start.sh neu starten."
else
  echo "⚠️  Gespeichert, aber Test-Senden fehlgeschlagen: $SENT"
fi
