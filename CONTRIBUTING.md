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
