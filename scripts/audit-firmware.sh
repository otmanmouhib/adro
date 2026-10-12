#!/bin/bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
for dev_dir in firmware/*/; do
  name=$(basename "$dev_dir")
  [ "$name" = "_shared" ] && continue
  echo "  firmware/$name"

  if [ -f "$dev_dir/VERSION" ]; then
    echo "    OK   VERSION = $(cat "$dev_dir/VERSION")"
  else
    echo "    FAIL VERSION missing"
    fail=1
  fi

  [ -f "$dev_dir/README.md" ]         && echo "    OK   README"         || echo "    WARN README missing"
  [ -f "$dev_dir/platformio.ini" ]    && echo "    OK   platformio.ini" || echo "    WARN platformio.ini missing"
  [ -f "$dev_dir/docs/CHANGELOG.md" ] && echo "    OK   CHANGELOG"      || echo "    WARN CHANGELOG missing"
  [ -f "$dev_dir/docs/MEMORY.md" ]    && echo "    OK   MEMORY"         || echo "    WARN MEMORY missing"

  src=$(find "$dev_dir/src" \( -name '*.ino' -o -name '*.cpp' -o -name '*.c' \) 2>/dev/null | wc -l)
  [ "$src" -gt 0 ] && echo "    OK   src ($src file(s))" || echo "    WARN no source files"
done

echo ""
echo "  version consistency:"
if ! bash scripts/check-version-consistency.sh | sed 's/^/    /'; then
  fail=1
fi

if [ $fail -eq 0 ]; then
  echo "OK: firmware audit"
else
  echo "FAIL: firmware audit"
  exit 1
fi
