#!/bin/bash
set -e
for device in firmware/*/; do
  if [ -f "$device/platformio.ini" ]; then
    echo "Building $device"
    pio run -d "$device"
  fi
done
