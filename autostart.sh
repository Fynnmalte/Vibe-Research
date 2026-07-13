#!/usr/bin/env bash
# Vibe Research als macOS-Hintergrunddienst (launchd):
#   ./autostart.sh install     Frontend bauen + Dienst einrichten (startet bei Login)
#   ./autostart.sh update      nach Code-Änderung/git pull: neu bauen + neu starten
#   ./autostart.sh restart     Dienst neu starten (z. B. nach .env-Änderung)
#   ./autostart.sh status      läuft er? + Health-Check
#   ./autostart.sh uninstall   Dienst entfernen (z. B. bevor ./start.sh Dev-Modus)
# Danach: App läuft dauerhaft auf http://127.0.0.1:8900 — im Browser öffnen und
# über „Zum Dock hinzufügen" als App installieren.
set -euo pipefail
cd "$(dirname "$0")"

LABEL="wiki.viberesearch.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/vibe-research.log"
URL="http://127.0.0.1:8900"

build_frontend() {
  echo "Baue Frontend (npm run build)…"
  (cd frontend && npm run build)
}

write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PWD/serve.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
}

start_service() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
}

health() {
  for _ in $(seq 1 20); do
    if curl -sf "$URL/api/health" >/dev/null 2>&1; then
      echo "✓ läuft: $URL"
      return 0
    fi
    sleep 0.5
  done
  echo "✗ Health-Check fehlgeschlagen — Log: $LOG"
  return 1
}

case "${1:-}" in
  install)
    [ -x backend/.venv/bin/python ] || { echo "backend/.venv fehlt — erst Backend-Setup ausführen."; exit 1; }
    build_frontend
    write_plist
    start_service
    health
    echo "Fertig. Startet ab jetzt automatisch bei jedem Login."
    echo "Als App: $URL öffnen → Chrome: Adressleiste-Installieren-Symbol / Safari: Ablage → Zum Dock hinzufügen."
    ;;
  update)
    build_frontend
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    health
    ;;
  restart)
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    health
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "Dienst geladen ($LABEL)"
      health || true
    else
      echo "Dienst nicht installiert. → ./autostart.sh install"
    fi
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Dienst entfernt. (Dev-Modus wieder frei: ./start.sh)"
    ;;
  *)
    grep '^#   ' "$0" | sed 's/^#   //'
    exit 1
    ;;
esac
