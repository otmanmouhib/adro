# Contributing to Adro

## Branching
| Branch | Purpose |
|--------|---------|
| main | production, always buildable |
| develop | integration for next release |
| feature/<name> | new feature or fix |
| release/<version> | release preparation |
| hotfix/<name> | emergency fix from main |

## Commits (Conventional Commits)
Format: <type>(<scope>): <description>

Types: feat, fix, docs, hardware, firmware, hub, cloud, chore, refactor, test
Scopes: switch-station, dosing-station, onesense, sixsense, hub, cloud, docs, scripts, ci

Examples:
  feat(switch-station): add per-channel PWM control
  fix(sixsense): correct EC temperature compensation coefficient
  docs(hub): update container-by-container report

## Rules
- One .git folder at the root. No submodules, no subtrees.
- Every folder has a README.md.
- Docs update in the same commit as the source change.
- Never commit secrets. Use .env.example templates.
- firmware/<device>/VERSION must match currentFirmwareVersion in source.

## Tagging
  git tag -a v0.1.0 -m "Adro Platform Release v0.1.0"
  git push origin v0.1.0

## Branching

See [docs/00-platform/branching-strategy.md](docs/00-platform/branching-strategy.md)
for the full model.

Quick rules:
- Work on `feature/<scope>/<name>` off `develop`
- Squash into `develop`
- Release via `release/<version>` → merge commit into `master`
- Hotfix via `hotfix/<name>` off `master`
- No direct pushes to `master`

## Quick Reference — Branching

| Goal | Branch from | Merge into | Method |
|---|---|---|---|
| New feature | `develop` | `develop` | Squash |
| Planned release | `develop` | `master` | Merge commit |
| Emergency fix | `master` | `master` | Merge commit |
| After release / hotfix | `master` | `develop` | Merge commit |

**Never** commit directly to `master`. Every change ships through a PR.
