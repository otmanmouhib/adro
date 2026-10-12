#!/bin/bash
set -e
for board in hardware/*/; do
  name=$(basename "$board")
  [ "$name" = "_shared" ] && continue
  echo "Exporting gerbers for $name"
  # TODO: kicad-cli pcb export gerbers "$board/${name}.kicad_pcb"
done
