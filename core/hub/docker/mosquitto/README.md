# Mosquitto — Adro Hub broker

Local MQTT broker that bridges to the cloud broker over an authenticated MQTT connection.

## How it works

The image contains **only** a template (`mosquitto.conf.template`). At container start:

1. `docker-entrypoint.sh` reads env vars
2. Runs `envsubst` to render the template into `/mosquitto/config/mosquitto.conf`
3. Starts mosquitto

Env vars come from `/opt/adro-config/site.env` (mounted via `env_file` in compose).
The file is **never committed** — it holds the site's unique credentials.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | builds the image with gettext + entrypoint |
| `docker-entrypoint.sh` | renders config, starts broker |
| `mosquitto.conf.template` | config with `${BRIDGE_*}` placeholders |
| `/opt/adro-config/site.env` (on machine) | real credentials |

## Local-only mode

If `BRIDGE_USERNAME`/`BRIDGE_PASSWORD` are empty, the entrypoint skips the bridge section entirely.
The broker runs as a pure local broker.

## Testing

    docker exec -it adro-mosquitto mosquitto_sub -t 'adro/#' -v

## Related

- [software architecture](../../../docs/00-platform/software-architecture.md)
