#!/bin/bash
set -e
for dir in releases/v*/; do
  [ -d "$dir" ] || continue
  echo "Verifying $dir"
  ( cd "$dir" && sha256sum -c SHA256SUMS )
done
