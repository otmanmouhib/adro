# Adro Platform

Open smart farming platform for hydroponic and water quality automation.

## Overview
Adro is a modular IoT platform for precision agriculture:
- **Edge devices** (ESP32-S3) for sensing and actuation
- **Local Control Hub** (Raspberry Pi) for offline automation
- **Cloud Gateway** (mini PC) for remote management

## Components
| Component | Purpose |
|-----------|---------|
| [Switch Station V0](hardware/switch-station-v0/) | 4-channel 220VAC SSR actuator |
| [Dosing Station V0](hardware/dosing-station-v0/) | 4-channel peristaltic pump controller |
| [OneSense V0](hardware/onesense-v0/) | Multi-parameter water sensing node |
| [SixSense V0](hardware/sixsense-v0/) | Continuous main reservoir monitoring |
| [Local Control Hub](hub/) | On-site automation brain |
| [DDNS Server](cloud/) | Cloud gateway and remote portal |

## Quick Start
1. Read `docs/00-platform/software-architecture.md`
2. Build device: `hardware/switch-station-v0/` + `firmware/switch-station-v0/`
3. Deploy hub: `hub/image/` + `hub/docker/`
4. Deploy cloud: `cloud/image/` + `cloud/docker/`

## Rules
- One `.git` at the root. No submodules, no subtrees.
- Every folder has a `README.md`.
- Docs stay in sync with code.
- Releases are tagged and manifested.

See [LICENSE](LICENSE) and [CONTRIBUTING.md](CONTRIBUTING.md).
