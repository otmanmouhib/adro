# Mosquitto — Adro Cloud broker

Central MQTT broker. Every hub connects here over an authenticated bridge.
Per-site ACL prevents one hub from reading or writing another's topics.

## Authentication

- `allow_anonymous false` — no unauthenticated access
- `password_file /mosquitto/config/passwd` — user hashes
- `acl_file /mosquitto/config/acl` — per-user topic permissions

Both files live on the cloud machine, **not in git**.

## Adding a new site

On the cloud server:

    docker exec adro-cloud-mosquitto \
      mosquitto_passwd -b /mosquitto/config/passwd site-XXX <PASSWORD>

Append to `acl`:

    user site-XXX
    topic readwrite adro/site-XXX/#

Reload:

    docker restart adro-cloud-mosquitto

## Revoking a site

    docker exec adro-cloud-mosquitto \
      mosquitto_passwd -D /mosquitto/config/passwd site-XXX

Remove their block from `acl`. Restart.

## Testing

    docker exec -it adro-cloud-mosquitto \
      mosquitto_sub -u adro-admin -P <admin-pass> -t '#' -v

## Related

- [software architecture](../../../docs/00-platform/software-architecture.md)
