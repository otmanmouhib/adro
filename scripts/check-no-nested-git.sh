#!/bin/bash
set -e
NESTED=$(find . -mindepth 2 -name ".git" -type d || true)
if [ -n "$NESTED" ]; then
  echo "ERROR: Nested .git folders found:"
  echo "$NESTED"
  exit 1
fi
echo "OK: No nested .git folders"
