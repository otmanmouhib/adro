#!/bin/sh
set -e

# ── Defaults (used if env not set) ──────────────────────
: "${BRIDGE_REMOTE_HOST:=adro.ddns.net}"
: "${BRIDGE_REMOTE_PORT:=1883}"
: "${BRIDGE_CLIENT_ID:=adro-hub-bridge}"
: "${SITE_ID:=unknown}"

# ── Resolve HUB_MAC ─────────────────────────────────────
# Priority: env var > physical interface MAC > hostname.
# Compose mounts /sys at /host-sys (read-only) so we can walk the
# network class tree. We accept only physical interfaces — those with
# a /device symlink — which excludes docker0, veth*, br-*, lo.
: "${HUB_MAC:=}"
if [ -z "$HUB_MAC" ] && [ -d /host-sys/class/net ]; then
  for iface_path in /host-sys/class/net/*; do
    iface=$(basename "$iface_path")

    # Skip loopback
    [ "$iface" = "lo" ] && continue

    # Only physical interfaces have a /device symlink
    [ ! -e "$iface_path/device" ] && continue

    if [ -r "$iface_path/address" ]; then
      mac=$(tr -d ':' < "$iface_path/address" | tr 'A-Z' 'a-z')
      if [ -n "$mac" ] && [ "$mac" != "000000000000" ]; then
        HUB_MAC="$mac"
        break
      fi
    fi
  done
fi
: "${HUB_MAC:=$(hostname | tr 'A-Z' 'a-z')}"
export HUB_MAC

# ── Log resolved identity (never log the password) ──────
echo "[adro-mosquitto] site=${SITE_ID} hub_mac=${HUB_MAC} user=${BRIDGE_USERNAME:-<none>}"

# ── Render config ───────────────────────────────────────
if [ -z "${BRIDGE_USERNAME}" ] || [ -z "${BRIDGE_PASSWORD}" ]; then
  echo "[adro-mosquitto] no bridge credentials — starting local-only"
  sed '/^# BRIDGE_START/,$d' /etc/adro/mosquitto.conf.template \
    > /mosquitto/config/mosquitto.conf
else
  echo "[adro-mosquitto] rendering bridge config for hub_mac=${HUB_MAC}"
  envsubst < /etc/adro/mosquitto.conf.template \
    > /mosquitto/config/mosquitto.conf
fi

# ── Hand off to mosquitto ───────────────────────────────
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf