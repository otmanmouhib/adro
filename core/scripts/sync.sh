#!/bin/bash
set -e

BRANCH="${1:-}"
BASE="${2:-develop}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "▶ Fetching and pruning..."
git fetch --all --prune

if [ -n "$BRANCH" ]; then
  CURRENT=$(git rev-parse --abbrev-ref HEAD)
  if [ "$CURRENT" = "$BRANCH" ]; then
    echo "▶ Switching off $BRANCH → $BASE"
    git checkout "$BASE"
  fi

  echo "▶ Deleting local branch: $BRANCH"
  git branch -D "$BRANCH" 2>/dev/null || echo "  (not present locally)"

  echo "▶ Deleting remote branch: $BRANCH"
  git push origin --delete "$BRANCH" 2>/dev/null || echo "  (not present on origin)"
fi

echo "▶ Switching to $BASE"
git checkout "$BASE"

echo "▶ Pulling $BASE"
git pull

echo ""
echo "▶ Last 3 commits:"
git log --oneline -3
echo ""
echo "▶ Branches:"
git branch
echo ""
echo "▶ Status:"
git status -s
echo ""
echo "✔ Sync complete."
