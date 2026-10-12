#!/bin/bash
# Prints the current branch. Warns (not fails) if on master.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "master" ]; then
  echo "WARN: On 'master'. Day-to-day work belongs on 'develop'."
  echo "      (this is informational — master is fine at release time)"
else
  echo "OK: branch '$BRANCH'"
fi
