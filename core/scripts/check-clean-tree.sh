#!/bin/bash
set -e
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree not clean:"
  git status --short
  exit 1
fi
echo "OK: Working tree clean"
