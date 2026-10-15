# Adro Platform

Open-core smart farming platform for hydroponic and water quality automation.

## Overview
Adro is a modular IoT platform for precision agriculture:
- **Edge devices** (ESP32-S3) for sensing and actuation
- **Local Control Hub** (Raspberry Pi) for offline automation
- **Cloud Gateway** (mini PC) for remote management

## Licensing Model

Adro uses an **Open Core** model:

| Directory | License | Scope |
|-----------|---------|-------|
| [`core/`](core/) | [MIT](LICENSE) | Fully functional platform for a single farm or small cooperative |
| [`enterprise/`](enterprise/) | [Proprietary](LICENSE-EE) | Multi-site management, advanced analytics, enterprise integrations *(not yet implemented)* |

The `core/` directory is open source and welcomes contributions.
The `enterprise/` directory is proprietary and not open to external contributions.

For commercial licensing of enterprise features, contact [your email].

## Core Components

| Component | Purpose |
|-----------|---------|
| [Switch Station V0](core/hardware/switch-station-v0/) | 4-channel 220VAC SSR actuator |
| [Dosing Station V0](core/hardware/dosing-station-v0/) | 4-channel peristaltic pump controller |
| [OneSense V0](core/hardware/onesense-v0/) | Multi-parameter water sensing node |
| [SixSense V0](core/hardware/sixsense-v0/) | Continuous main reservoir monitoring |
| [Local Control Hub](core/hub/) | On-site automation brain |
| [DDNS Server](core/cloud/) | Cloud gateway and remote portal |

## Quick Start
1. Read [`core/docs/00-platform/software-architecture.md`](core/docs/00-platform/software-architecture.md)
2. Build device: `core/hardware/switch-station-v0/` + `core/firmware/switch-station-v0/`
3. Deploy hub: `core/hub/image/` + `core/hub/docker/`
4. Deploy cloud: `core/cloud/image/` + `core/cloud/docker/`

## Repository Rules
- One `.git` at the root. No submodules, no subtrees.
- Every folder has a `README.md`.
- Docs stay in sync with code.
- Releases are tagged and manifested.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions to `core/` require signing a Contributor License Agreement (CLA).

## Branching & Governance

- [Branching strategy](core/docs/00-platform/branching-strategy.md)
- [Contributing](CONTRIBUTING.md)
- [Global repository rules](core/docs/00-platform/global-repository.md)

## License

- Core: [MIT](LICENSE)
- Enterprise: [Proprietary](LICENSE-EE)