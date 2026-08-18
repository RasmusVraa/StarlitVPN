#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="$ROOT/host.py"
chmod +x "$HOST"
CHROME_ID="${CHROME_ID:-fgefnlplpplkhobagcpieacdkghcpbdg}"
FIREFOX_ID="${FIREFOX_ID:-starlitvpn@starlit-moon.ru}"

write_chrome() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/com.starlitvpn.host.json" <<EOF
{
  "name": "com.starlitvpn.host",
  "description": "StarlitVPN Xray native host",
  "path": "$HOST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$CHROME_ID/"]
}
EOF
}

write_firefox() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/com.starlitvpn.host.json" <<EOF
{
  "name": "com.starlitvpn.host",
  "description": "StarlitVPN Xray native host",
  "path": "$HOST",
  "type": "stdio",
  "allowed_extensions": ["$FIREFOX_ID"]
}
EOF
}

case "$(uname -s)" in
  Darwin)
    write_chrome "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    write_chrome "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    write_chrome "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    write_firefox "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
    ;;
  *)
    write_chrome "$HOME/.config/google-chrome/NativeMessagingHosts"
    write_chrome "$HOME/.config/chromium/NativeMessagingHosts"
    write_chrome "$HOME/.config/microsoft-edge/NativeMessagingHosts"
    write_firefox "$HOME/.mozilla/native-messaging-hosts"
    ;;
esac

python3 "$HOST" --ensure-core
echo "Native host registered. Load the unpacked extension and restart the browser."
