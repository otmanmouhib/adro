#!/bin/bash
set -e
if ! command -v python3 >/dev/null 2>&1; then
  echo "SKIP: python3 not found"
  exit 0
fi
if ! python3 -c "import yaml" 2>/dev/null; then
  echo "SKIP: PyYAML not installed (pip install pyyaml / pacman -S python-yaml)"
  exit 0
fi

fail=0
found=0
while IFS= read -r f; do
  found=1
  printf "  %-60s " "$f"
  if python3 -c "import yaml; yaml.safe_load(open('$f'))" 2>/dev/null; then
    echo "OK"
  else
    echo "FAIL"
    python3 -c "import yaml; yaml.safe_load(open('$f'))" 2>&1 | tail -3 | sed 's/^/      /'
    fail=1
  fi
done < <(find . -path ./.git -prune -o \( -name '*.yml' -o -name '*.yaml' \) -print | sort)

if [ $found -eq 0 ]; then
  echo "  (no YAML files found)"
fi
[ $fail -eq 0 ] || exit 1
echo "OK: All YAML valid"
