# Adro Branching Strategy

**Status:** active
**Applies to:** the entire Adro monorepo

## Branch roles

| Branch | Base | Merges into | Merge method | Lifetime |
|---|---|---|---|---|
| `master` | — | — | — | permanent |
| `develop` | `master` | `master` (via release) | merge commit | permanent |
| `feature/<scope>/<name>` | `develop` | `develop` | squash | until merged |
| `release/<version>` | `develop` | `master` + back to `develop` | merge commit | until tagged |
| `hotfix/<name>` | `master` | `master` + back to `develop` | merge commit | until merged |

**Scopes:** `hardware`, `firmware`, `hub`, `cloud`, `docs`, `scripts`, `ci`

## Flow

    master        production, tagged releases only
      ▲
      │ merge commit (via PR)
      │
    release/vX.Y.Z
      ▲
      │ merge commit (via PR)
      │
    develop       integration, day-to-day
      ▲
      │ squash (via PR)
      │
    feature/<scope>/<name>

## Rules

1. No direct commits or pushes to `master`.
2. `master` accepts merges only from `release/*` or `hotfix/*`.
3. `release/*` branches from `develop`.
4. `hotfix/*` branches from `master`.
5. Every merge to `master` is tagged `vX.Y.Z`.
6. After merging a release or hotfix to `master`, back-merge `master` into `develop`.
7. Never force-push `master`, `release/*`, or `hotfix/*`.
8. Feature branches squash into `develop`.
9. Release branches merge-commit into `master` (never squash).
10. All commits follow Conventional Commits.

## Naming

    feature/firmware/mqtt-reconnect
    feature/hardware/switch-station-gpio8
    feature/docs/hub-containers
    release/v0.2.0
    hotfix/firmware/version-mismatch

## Enforcement layers

| Layer | What | Where |
|---|---|---|
| Server | branch rulesets | GitHub → Settings → Rules |
| CI | branch-name check | `.github/workflows/ci.yml` |
| Local | git hooks | `.git/hooks/*` (via `scripts/install-hooks.sh`) |
| Convention | commit messages | `.git/hooks/commit-msg` |

