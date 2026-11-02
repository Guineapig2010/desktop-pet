#!/bin/bash
# Double-click me (macOS). First run installs everything, then starts Albuquerque Buddy.
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display dialog "Albuquerque Buddy needs Node.js.\n\nInstall the LTS version from nodejs.org, then double-click Start Buddy.command again." buttons {"Open nodejs.org"} default button 1' >/dev/null && open "https://nodejs.org/en/download"
  exit 1
fi
if [ ! -d node_modules/electron/dist ]; then
  echo "First run: installing (takes a minute)…"
  npm install || { echo "npm install failed"; read -r -p "Press Enter to close"; exit 1; }
fi
echo "Starting Albuquerque Buddy… (you can close this window; quit him from the menu-bar icon)"
nohup npm start >/dev/null 2>&1 &
sleep 2
