#!/bin/bash
set -e
HITS=$(git ls-files -i -c --exclude-standard || true)
if [ -n "$HITS" ]; then
  echo "ERROR: Files tracked despite .gitignore:"
  echo "$HITS"
  exit 1
fi
echo "OK: No tracked-ignored files"
