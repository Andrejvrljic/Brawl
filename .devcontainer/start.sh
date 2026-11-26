#!/usr/bin/env bash
# Startet den Spielserver im Hintergrund, sobald der Codespace läuft.
cd "$(dirname "$0")/.."
pkill -f "server/index.js" 2>/dev/null || true
setsid nohup npm start > /tmp/kistenkrawall.log 2>&1 < /dev/null &
# Port öffentlich machen, damit Freunde ohne GitHub-Konto mitspielen können
if [ -n "$CODESPACE_NAME" ]; then
  for i in $(seq 1 20); do
    curl -fs http://127.0.0.1:3000/health >/dev/null 2>&1 && break
    sleep 1
  done
  gh codespace ports visibility 3000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
  echo ""
  echo "  Brawl Engine läuft! Link für deine Freunde:"
  echo "  https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  echo ""
fi
