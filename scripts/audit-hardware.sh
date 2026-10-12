#!/bin/bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
for board_dir in hardware/*/; do
  name=$(basename "$board_dir")
  [ "$name" = "_shared" ] && continue
  echo "  hardware/$name"

  if [ -f "$board_dir/VERSION" ]; then
    echo "    OK   VERSION = $(cat "$board_dir/VERSION")"
  else
    echo "    FAIL VERSION missing"
    fail=1
  fi

  [ -f "$board_dir/README.md" ]    && echo "    OK   README"    || echo "    WARN README missing"
  [ -f "$board_dir/CHANGELOG.md" ] && echo "    OK   CHANGELOG" || echo "    WARN CHANGELOG missing"

  bom=$(find "$board_dir/bom" -name '*.csv' 2>/dev/null | wc -l)
  [ "$bom" -gt 0 ] && echo "    OK   BOM ($bom file(s))" || echo "    WARN no BOM csv"

  ger=$(find "$board_dir/gerbers" -type f 2>/dev/null | wc -l)
  [ "$ger" -gt 0 ] && echo "    OK   gerbers ($ger)" || echo "    WARN no gerbers"

  ren=$(find "$board_dir/renders" -type f 2>/dev/null | wc -l)
  [ "$ren" -gt 0 ] && echo "    OK   renders ($ren)" || echo "    WARN no renders"

  # KiCad DRC only when a KiCad project exists
  kicad_any=$(find "$board_dir" -maxdepth 1 \
    \( -name '*.kicad_pro' -o -name '*.kicad_sch' -o -name '*.kicad_pcb' \) \
    2>/dev/null | wc -l)

  if [ "$kicad_any" -gt 0 ]; then
    pcb=$(find "$board_dir" -maxdepth 1 -name '*.kicad_pcb' 2>/dev/null | head -n1)
    if [ -n "$pcb" ]; then
      if command -v kicad-cli >/dev/null 2>&1; then
        if kicad-cli pcb drc --exit-code-violations "$pcb" >/dev/null 2>&1; then
          echo "    OK   KiCad DRC"
        else
          echo "    FAIL KiCad DRC"
          fail=1
        fi
      else
        echo "    WARN kicad-cli not installed — DRC skipped"
      fi
    else
      echo "    WARN KiCad project present but no .kicad_pcb"
    fi
  fi
done

if [ $fail -eq 0 ]; then
  echo "OK: hardware audit"
else
  echo "FAIL: hardware audit"
  exit 1
fi
