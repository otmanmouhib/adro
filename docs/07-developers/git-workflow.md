# Git Workflow

**Status:** draft
**Last reviewed:** 2026-10-12

The full model lives in
[docs/00-platform/branching-strategy.md](../00-platform/branching-strategy.md).
This page is the cheat sheet.

## Branch map

    master        production, tagged releases only
      ▲
      │ merge commit
    release/vX.Y.Z
      ▲
      │ merge commit
    develop       integration, waiting station
      ▲
      │ squash
    feature/<scope>/<name>

## Recipes

### New feature

    git checkout develop
    git pull
    git checkout -b feature/firmware/mqtt-reconnect
    # work
    git add -A
    git commit -m "feat(firmware): add MQTT reconnect backoff"
    git push -u origin feature/firmware/mqtt-reconnect
    # open PR → develop (squash)

### Planned release

    git checkout develop
    git checkout -b release/v0.2.0
    # version bumps, manifest
    git push -u origin release/v0.2.0
    # open PR → master (merge commit)

### Emergency hotfix

    git checkout master
    git checkout -b hotfix/firmware/watchdog-reset
    # minimal fix
    git push -u origin hotfix/firmware/watchdog-reset
    # open PR → master (merge commit)

### Back-merge after release or hotfix

    git checkout develop
    git checkout -b chore/back-merge-v0.2.0
    git merge --no-ff origin/master -m "chore: back-merge v0.2.0 into develop"
    git push -u origin chore/back-merge-v0.2.0
    # open PR → develop (squash)

### Sync local after a merge

    bash scripts/sync.sh
    # or with cleanup:
    bash scripts/sync.sh feature/firmware/mqtt-reconnect

## Local hooks

| Hook | Blocks |
|---|---|
| pre-commit | commits on `master` |
| pre-push | direct push to `master` / `develop` / `release/*` / `hotfix/*`; runs `scripts/audit.sh` |
| commit-msg | non-Conventional commit messages |

Install: `git config core.hooksPath .githooks`

## Related

- [Branching strategy](../00-platform/branching-strategy.md)
- [release-guide.md](release-guide.md)
