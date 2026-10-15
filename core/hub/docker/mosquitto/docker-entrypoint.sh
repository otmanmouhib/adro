#!/bin/sh
set -e

# Defaults (used if env not set)
: "${BRIDGE_REMOTE_HOST:=adro.ddns.net}"
: "${BRIDGE_REMOTE_PORT:=1883}"
: "${BRIDGE_CLIENT_ID:=farmbridge_bridge}"

# Log which site we're running as (never log password)
echo "[adro-mosquitto] site=${SITE_ID:-<none>} user=${BRIDGE_USERNAME:-<none>}"

# If no bridge credentials, start in local-only mode
if [ -z "${BRIDGE_USERNAME}" ] || [ -z "${BRIDGE_PASSWORD}" ]; then
  echo "[adro-mosquitto] no bridge credentials — starting local-only"
  sed '/^# BRIDGE_START$/,$d' /etc/adro/mosquitto.conf.template \
    > /mosquitto/config/mosquitto.conf
else
  echo "[adro-mosquitto] rendering bridge config"
  envsubst < /etc/adro/mosquitto.conf.template \
    > /mosquitto/config/mosquitto.conf
fi

exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
