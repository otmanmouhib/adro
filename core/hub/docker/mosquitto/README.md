# Adro Hub — Mosquitto Broker

Containerized Mosquitto broker running on the hub. Provides the local
MQTT transport for the LAN and bridges to the remote broker over WAN.

## Listeners

| Port | Protocol | Auth | Purpose |
|------|----------|------|---------|
| 1883 | MQTT     | none | LAN devices (ESP32 stations) |
| 9001 | WebSocket| none | Browser dashboards |

Anonymous access is intentional — the hub is a trusted LAN.

## Bridge

The container can bridge to a remote broker (e.g. `adro.ddns.net:1883`).
Bridge is **only enabled if `BRIDGE_USERNAME` and `BRIDGE_PASSWORD` are set**.

### Topic scoping

To avoid relaying unrelated topics and to prevent loops when multiple hubs
connect to the same remote broker, the bridge uses prefix remapping:

| Direction | Local topic | Remote topic |
|-----------|-------------|--------------|
| out | `farmLab/...` | `hubs/<SITE_ID>/farmLab/...` |
| in  | `farmLab/cmd/...` | `cmd/<SITE_ID>/...` |

This means:
- Every hub's telemetry is namespaced by `<SITE_ID>` on the cloud broker.
- Each hub only receives its own commands.
- Demo/test topics from the cloud don't leak onto the LAN.

## Environment variables

Set in `/opt/adro-config/site.env` on the hub:

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `SITE_ID` | yes (for bridge) | `unknown` | Namespace on the cloud broker |
| `BRIDGE_REMOTE_HOST` | no | `adro.ddns.net` | Remote broker hostname |
| `BRIDGE_REMOTE_PORT` | no | `1883` | Remote broker port |
| `BRIDGE_USERNAME` | yes (for bridge) | — | Remote broker username |
| `BRIDGE_PASSWORD` | yes (for bridge) | — | Remote broker password |
| `BRIDGE_CLIENT_ID` | no | `adro-hub-bridge` | MQTT client ID (must be unique) |

If `BRIDGE_USERNAME` or `BRIDGE_PASSWORD` is missing, the container starts
in **local-only mode** (no bridge section rendered).

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Builds the image (eclipse-mosquitto + gettext) |
| `docker-entrypoint.sh` | Renders config from env, starts mosquitto |
| `mosquitto.conf.template` | Config with `${VAR}` placeholders |
| `README.md` | This file |

## Build & run

From `core/hub/docker/`:

```sh
docker compose build mosquitto
docker compose up -d mosquitto
docker compose logs -f mosquitto