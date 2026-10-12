#!/bin/bash
set -e
VERSION=$(cat VERSION)
TAG="v$VERSION"
RELEASE_DIR="releases/$TAG"

if [ -d "$RELEASE_DIR" ]; then
  echo "ERROR: Release $TAG already exists"
  exit 1
fi

mkdir -p "$RELEASE_DIR"

for device in firmware/*/; do
  name=$(basename "$device")
  [ -f "$device/platformio.ini" ] || continue
  pio run -d "$device"
  cp "$device/.pio/build/"*/firmware.bin "$RELEASE_DIR/$name-firmware.bin" 2>/dev/null || true
done

bash scripts/build-hub-image.sh || true
bash scripts/build-cloud-iso.sh || true

( cd "$RELEASE_DIR" && sha256sum * > SHA256SUMS 2>/dev/null || true )

git tag -a "$TAG" -m "Adro Platform Release $TAG"
echo "Release $TAG created. Push with: git push origin $TAG"
