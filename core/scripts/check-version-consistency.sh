#!/bin/bash
set -e
fail=0
for device in firmware/*/; do
  version_file="$device/VERSION"
  [ -f "$version_file" ] || continue
  version=$(tr -d '[:space:]' < "$version_file")
  src_file=$(find "$device/src" -name "*.ino" -o -name "*.cpp" 2>/dev/null | head -n 1)
  if [ -z "$src_file" ]; then
    echo "WARN: No source file in $device"
    continue
  fi
  if ! grep -q "currentFirmwareVersion = \"$version\"" "$src_file"; then
    echo "ERROR: $device VERSION ($version) does not match source"
    fail=1
  else
    echo "OK: $device version $version"
  fi
done
[ $fail -eq 0 ] || exit 1
echo "All versions consistent"
