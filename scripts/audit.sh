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

run "branch"                 bash scripts/check-branch.sh
run "clean tree"             bash scripts/check-clean-tree.sh
run "no nested .git"         bash scripts/check-no-nested-git.sh
run "no tracked-ignored"     bash scripts/check-no-tracked-ignored.sh
run "version consistency"    bash scripts/check-version-consistency.sh
run "YAML syntax"            bash scripts/check-yaml.sh

echo "═══════════════════════════════════════════════════════════"
echo "  ✔ All checks passed"
echo "═══════════════════════════════════════════════════════════"
