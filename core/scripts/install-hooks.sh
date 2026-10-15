#!/bin/bash
set -e
HOOK_DIR=".git/hooks"
mkdir -p "$HOOK_DIR"

cat > "$HOOK_DIR/pre-commit" <<'INNER'
#!/bin/bash
branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "master" ]; then
  echo "ERROR: Direct commits to 'master' are blocked."
  echo "       Switch to develop: git checkout develop"
  exit 1
fi
INNER
chmod +x "$HOOK_DIR/pre-commit"

cat > "$HOOK_DIR/pre-push" <<'INNER'
#!/bin/bash
exec bash core/scripts/audit.sh
INNER
chmod +x "$HOOK_DIR/pre-push"

echo "✔ Hooks installed in $HOOK_DIR"
echo "  pre-commit → blocks commits on master"
echo "  pre-push   → runs core/scripts/audit.sh before every push"
