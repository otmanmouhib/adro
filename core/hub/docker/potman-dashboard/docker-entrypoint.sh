#!/bin/sh
# Generate runtime config (nginx:alpine runs /docker-entrypoint.d/*.sh at start).
set -eu

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

cat > /usr/share/nginx/html/config.js <<EOF
window.__ADRO_CONFIG__ = {
  title: "$(esc "${ADRO_TITLE:-Adro Hub}")",
  brokerUrl: "$(esc "${ADRO_BROKER_URL:-}")"
};
EOF
