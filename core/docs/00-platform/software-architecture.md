# Adro Platform — Software Architecture

**Status:** draft
**Version:** 0.1.0
**Last reviewed:** 2026-10-12

---

## 1. Purpose

This document defines the software architecture of the Adro smart farming
platform. It is the single source of truth for:

- System layers and their responsibilities
- Device roles
- Communication protocol (MQTT topics, payload schema)
- Data and control flows
- Offline behavior
- Security model
- Naming conventions

All other architecture docs (water flow, hub, cloud, per-device) derive from
this one.

---

## 2. System overview

Adro is a three-tier IoT platform for hydroponic and water quality automation.

    ┌──────────────────────────────────────────────────────────────┐
    │  CLOUD TIER — DDNS Server (mini PC)                          │
    │  remote access · dashboards · WhatsApp · DDNS · TLS          │
    └───────────────────────────┬──────────────────────────────────┘
                                │
                                │ WireGuard / HTTPS / MQTT (TLS)
                                │
    ┌───────────────────────────┴──────────────────────────────────┐
    │  HUB TIER — Local Control Hub (Raspberry Pi)                 │
    │  offline automation · MQTT broker · dashboards · hotspot     │
    └───────────────────────────┬──────────────────────────────────┘
                                │
                                │ Wi-Fi / MQTT (LAN)
                                │
    ┌────────────┬──────────────┼──────────────┬────────────────────┐
    │            │              │              │                    │
    ▼            ▼              ▼              ▼                    ▼
 Switch      Dosing         OneSense       SixSense              (future)
 Station     Station        node           node
 4× SSR      4× pump        multi-sensor   continuous

**Key principle:** the hub is authoritative. Devices trust the hub.
The hub trusts the cloud. If the cloud is unreachable, the hub keeps
running autonomously and buffers changes for later sync.

---

## 3. Tier responsibilities

### 3.1 Edge tier — ESP32-S3 devices

| Responsibility | Not responsible for |
|---|---|
| Read sensors, drive actuators | Decision making |
| Talk MQTT to the hub | Long-term storage |
| Cache config locally | User interface |
| OTA firmware update | Cross-device coordination |

**Devices:**

| Device | Role | Channels |
|---|---|---|
| Switch Station V0 | 220VAC SSR actuator | 4 independent |
| Dosing Station V0 | Peristaltic pump controller | 4 pumps |
| OneSense V0 | Multi-parameter sensing node | pH, EC, temp, level |
| SixSense V0 | Continuous reservoir monitoring | 6 sensors |

### 3.2 Hub tier — Local Control Hub (Raspberry Pi)

| Responsibility | Not responsible for |
|---|---|
| MQTT broker (mosquitto) | Public internet exposure |
| Automation rules engine | Long-term analytics |
| Local dashboard + command | Multi-site coordination |
| Device discovery + registration | |
| Wi-Fi hotspot (fallback) | |

**Containers:** `adro-mosquitto`, `adro-commander`, `adro-dashboard`,
`adro-discovery`, `adro-watchtower`, `adro-portainer`

### 3.3 Cloud tier — DDNS Server (mini PC)

| Responsibility | Not responsible for |
|---|---|
| Public gateway / reverse proxy | Real-time device control |
| Dynamic DNS | Automation logic |
| Remote dashboard | Local network access |
| WhatsApp notifications | |
| TLS termination | |
| Backup + uptime monitoring | |

**Containers:** `adro-traefik`, `adro-certbot`, `adro-mosquitto`,
`adro-noip-duc`, `adro-remote-commander`, `adro-waha`, `adro-watchtower`,
`adro-portainer`, `adro-homepage`, `adro-uptime-kuma`, `adro-redis`

---

## 4. Communication protocol

### 4.1 Transport

- **MQTT 3.1.1** over TCP
- LAN: plain MQTT on port 1883 (hub ↔ devices)
- WAN: MQTT over TLS on port 8883 (hub ↔ cloud)
- Payload: JSON (UTF-8)

### 4.2 Topic schema

    adro/{site}/{device_class}/{device_id}/{subtopic}

| Field | Values | Notes |
|---|---|---|
| `site` | `main`, `greenhouse1`, `nursery1` | multi-site ready |
| `device_class` | `switch`, `dosing`, `sense`, `hub`, `cloud` | |
| `device_id` | `switchstation01`, `sixsense01` | lowercase, no separator |
| `subtopic` | see table below | |

**Subtopic table:**

| Subtopic | Direction | QoS | Retain |
|---|---|---|---|
| `telemetry` | device → hub | 0 | no |
| `status` | device → hub | 1 | yes (LWT) |
| `command` | hub → device | 1 | no |
| `ack` | device → hub | 1 | no |
| `config` | hub → device | 1 | yes |
| `error` | device → hub | 1 | no |

**Examples:**

    adro/main/switch/switchstation01/telemetry
    adro/main/switch/switchstation01/command
    adro/main/switch/switchstation01/status
    adro/main/sense/sixsense01/telemetry
    adro/main/dosing/dosingstation01/command
    adro/main/hub/status
    adro/main/cloud/status

### 4.3 Payload format

Every message uses the same envelope:

    {
      "ts":   1697107200,
      "seq":  42,
      "v":    "1.0.0",
      "dev":  "switchstation01",
      "data": { ... }
    }

| Field | Type | Notes |
|---|---|---|
| `ts` | int (unix seconds) | device clock, best effort |
| `seq` | int | per-device monotonic counter |
| `v` | string (semver) | firmware version sending the message |
| `dev` | string | device_id (must match topic) |
| `data` | object | payload-specific |

**Example — telemetry from SixSense:**

    {
      "ts": 1697107200,
      "seq": 421,
      "v": "1.0.0",
      "dev": "sixsense01",
      "data": {
        "ph": 6.42,
        "ec": 1.87,
        "temp_c": 22.4,
        "level_cm": 34.2,
        "flow_lpm": 0.0,
        "orp_mv": 412
      }
    }

**Example — command to Switch Station:**

    {
      "ts": 1697107205,
      "seq": 88,
      "v": "1.0.0",
      "dev": "switchstation01",
      "data": {
        "action": "set_channel",
        "channel": 2,
        "state": "on",
        "duration_s": 60
      }
    }

### 4.4 QoS and retention

- Telemetry: QoS 0 — loss tolerated, next sample comes in seconds
- Commands: QoS 1 — must be delivered exactly once
- Status: QoS 1, retained — new subscribers see last state immediately
- Config: QoS 1, retained — device receives latest config on reconnect

---

## 5. Data flows

### 5.1 Sensor → dashboard (telemetry)

    SixSense  ──telemetry──►  Hub mosquitto
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              Commander       Dashboard        Cloud
              (rules)         (local UI)    (via TLS bridge)

### 5.2 Command → actuator (control)

    Dashboard  ──command──►  Hub mosquitto  ──command──►  Switch Station
                                    │
                                    ▼
                                Commander
                                (validate,
                                 log,
                                 forward)

### 5.3 Cross-tier sync

The hub publishes a **site digest** to the cloud every 60 seconds:

    adro/main/hub/digest

    {
      "ts": 1697107260,
      "v": "0.1.0",
      "dev": "hub",
      "data": {
        "devices_online": 4,
        "devices_total": 4,
        "alerts_last_min": 0,
        "buffer_size": 0
      }
    }

Cloud keeps a mirror of hub state for remote access.

---

## 6. Offline behavior

**Cloud unreachable:**

- Hub keeps running all local automation
- Commands issued locally still work
- Telemetry buffered in Redis (cap: 24h)
- On reconnect: buffered telemetry flushed to cloud
- Cloud sends its own queued commands on reconnect

**Hub unreachable:**

- Devices enter "safe mode":
  - Switch Station: all SSR channels off
  - Dosing Station: pumps off
  - Sensors: continue sampling, buffer locally (cap: 1h)
- Devices retry hub connection with exponential backoff
- On reconnect: buffered telemetry flushed, safe mode exits

**Device unreachable:**

- Hub marks device offline after 3 missed heartbeats (90 s)
- Dashboard shows red
- Cloud receives `alert` message if offline > 5 min

---

## 7. Security model

| Layer | Mechanism |
|---|---|
| Wi-Fi (setup) | WPA2, `Adro-Setup` hotspot, password printed on device label |
| Wi-Fi (hub) | WPA2, `Adro-Hub` hotspot, user-chosen password |
| MQTT (LAN) | username/password per device, ACL restricts topic access |
| MQTT (WAN) | TLS + client certificate per site |
| Cloud API | HTTPS via Traefik, Let's Encrypt certs |
| SSH | key-only, no password |
| Device onboarding | first-boot wizard, per-device credentials |

**Rules:**

- No secrets in Git
- No default passwords in firmware — generated on first boot
- Certificates rotated by certbot every 90 days
- MQTT ACL: each device can only pub/sub its own topics

---

## 8. Naming conventions

| Item | Convention | Example |
|---|---|---|
| mDNS (hub) | `adro.local` | |
| mDNS (cloud) | `adro-cloud.local` | |
| Device hostname | `<device_id>.local` | `switchstation01.local` |
| MQTT topic root | `adro/...` | |
| Docker network (hub) | `adro-net` | |
| Docker network (cloud) | `adro-cloud-net` | |
| Container names | `adro-<service>` | `adro-mosquitto` |
| Image names | `adro/<service>` | `adro/commander` |
| Config path | `/opt/adro/config/` | |
| Log path | `/opt/adro/logs/` | |
| Hotspot SSID (first boot) | `Adro-Setup` | |
| Hotspot SSID (hub runtime) | `Adro-Hub` | |
| Release artifacts | `adro-<tier>-v<semver>.<ext>` | `adro-hub-v0.1.0.img.xz` |

---

## 9. Versioning

Three independent version streams, bound together in release manifests.

| Stream | File | Governs |
|---|---|---|
| Platform | `/VERSION` | whole monorepo release |
| Firmware | `firmware/<device>/VERSION` | device firmware |
| Hardware | `hardware/<board>/VERSION` | PCB revision |

Protocol version is separate: `v` field in payloads (currently `1.0.0`).
Breaking changes to the payload schema bump protocol to `2.0.0`.

---

## 10. Failure handling

| Failure | Detection | Response |
|---|---|---|
| Device offline | 3 missed heartbeats | mark offline, alert after 5 min |
| Hub offline | cloud-side ping | buffer commands, queue alerts |
| Cloud offline | hub-side ping | continue locally, buffer |
| MQTT broker down | container health check | restart by compose policy |
| Corrupt config | schema validation | fall back to last-good |
| OTA failure | bootloader rollback | revert to previous firmware |

---

## 11. Open questions

- [ ] Multi-site coordination — hub-to-hub sync? (post-v1)
- [ ] Local voice control via HA integration? (post-v1)
- [ ] Sensor calibration workflow — UI or CLI? (v1)
- [ ] Historical data storage — hub-only or cloud archive? (v1)
- [ ] Backup strategy — automated hub → cloud snapshot? (v1)

---

## 12. References

- [Branching strategy](branching-strategy.md)
- [Water flow architecture](water-flow-architecture.md) *(pending)*
- [Global repository rules](global-repository.md) *(pending)*
- Per-device hardware reports: `docs/01-hardware/`
- Per-device firmware reports: `docs/02-firmware/`
- Hub reports: `docs/03-hub/`
- Cloud reports: `docs/04-cloud/`
