# Glossary

**Status:** draft
**Last reviewed:** 2026-10-12

## Tiers

| Term | Meaning |
|---|---|
| Edge tier | ESP32-S3 devices that sense and actuate |
| Hub tier | Local Control Hub — Raspberry Pi, MQTT broker, automation |
| Cloud tier | DDNS Server — mini PC, remote access, TLS, DDNS |

## Devices

| Term | Meaning |
|---|---|
| Switch Station V0 | 4-channel 220VAC SSR actuator |
| Dosing Station V0 | 4-channel peristaltic pump controller |
| OneSense V0 | Multi-parameter water sensing node |
| SixSense V0 | Continuous reservoir monitoring node |
| device_id | lowercase identifier, e.g. `switchstation01` |

## MQTT

| Term | Meaning |
|---|---|
| topic | `adro/{site}/{device_class}/{device_id}/{subtopic}` |
| telemetry | device → hub sensor readings |
| command | hub → device action request |
| ack | device → hub command confirmation |
| status | device → hub retained online/offline |
| config | hub → device retained configuration |
| LWT | Last Will and Testament — retained "offline" on unexpected disconnect |
| QoS | Quality of Service level (0, 1, 2) |
| retained | message persists on broker for new subscribers |

## Repository

| Term | Meaning |
|---|---|
| monorepo | single Git repo containing all Adro components |
| tier | one of edge, hub, cloud |
| scope | commit scope, e.g. `firmware`, `hardware`, `hub` |
| manifest | `docs/releases/vX.Y.Z.md` — binds versions + SHAs |
| audit | `scripts/audit.sh` — pre-push validation suite |
| waiting station | informal name for `develop` |

## Runtime

| Term | Meaning |
|---|---|
| adro.local | mDNS hostname of the hub |
| adro-cloud.local | mDNS hostname of the cloud gateway |
| Adro-Setup | first-boot Wi-Fi hotspot SSID |
| Adro-Hub | runtime Wi-Fi hotspot SSID |
| adro-net | docker network on the hub |
| adro-cloud-net | docker network on the cloud server |
| /opt/adro/config | runtime config path on hub and cloud |

## Related

- [software architecture](../00-platform/software-architecture.md)
- [Branching strategy](../00-platform/branching-strategy.md)
