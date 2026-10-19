#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "═══════════════════════════════════════════════════════════"
echo "  Adro pre-push audit"
echo "═══════════════════════════════════════════════════════════"
echo ""

run() {
  local name="$1"; shift
  echo "▶ $name"
  if "$@"; then
    echo ""
  else
    echo ""
    echo "✘ FAILED: $name"
    exit 1
  fi
}

# ── Cross-cutting ────────────────────────────────────────────
run "branch"                 bash scripts/check-branch.sh
run "clean tree"             bash scripts/check-clean-tree.sh
run "no nested .git"         bash scripts/check-no-nested-git.sh
run "no tracked-ignored"     bash scripts/check-no-tracked-ignored.sh
run "YAML syntax"            bash scripts/check-yaml.sh

# ── Per-domain ───────────────────────────────────────────────
echo "── Hardware ───────────────────────────────────────────────"
run "hardware"               bash scripts/audit-hardware.sh
echo "── Firmware ───────────────────────────────────────────────"
run "firmware"               bash scripts/audit-firmware.sh
echo "── Hub ────────────────────────────────────────────────────"
run "hub"                    bash scripts/audit-hub.sh
echo "── Cloud ──────────────────────────────────────────────────"
run "cloud"                  bash scripts/audit-cloud.sh

echo "═══════════════════════════════════════════════════════════"
echo "  ✔ All checks passed"
echo "═══════════════════════════════════════════════════════════"
