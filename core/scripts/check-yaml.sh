#!/bin/bash
set -e

# Find a python interpreter that can import yaml.
# Preference order:
#   1. $ADRO_PYTHON if set
#   2. python3 on PATH
#   3. /usr/bin/python3
#   4. python on PATH
find_python() {
  local candidates=()
  [ -n "${ADRO_PYTHON:-}" ] && candidates+=("$ADRO_PYTHON")
  command -v python3 >/dev/null 2>&1 && candidates+=("$(command -v python3)")
  [ -x /usr/bin/python3 ] && candidates+=("/usr/bin/python3")
  command -v python  >/dev/null 2>&1 && candidates+=("$(command -v python)")

  for p in "${candidates[@]}"; do
    if "$p" -c "import yaml" 2>/dev/null; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

PY=$(find_python || true)

if [ -z "$PY" ]; then
  echo "SKIP: no python interpreter with PyYAML found."
  echo "      Install with: sudo pacman -S python-yaml"
  echo "      Or force one:  ADRO_PYTHON=/usr/bin/python3 bash scripts/check-yaml.sh"
  exit 0
fi

echo "Using: $PY ($("$PY" -c 'import yaml; print("PyYAML", yaml.__version__)'))"
echo ""

fail=0
found=0
while IFS= read -r f; do
  found=1
  printf "  %-60s " "$f"
  if "$PY" -c "import yaml; yaml.safe_load(open('$f'))" 2>/dev/null; then
    echo "OK"
  else
    echo "FAIL"
    "$PY" -c "import yaml; yaml.safe_load(open('$f'))" 2>&1 | tail -3 | sed 's/^/      /'
    fail=1
  fi
done < <(find . -path ./.git -prune -o \( -name '*.yml' -o -name '*.yaml' \) -print | sort)

if [ $found -eq 0 ]; then
  echo "  (no YAML files found)"
fi
[ $fail -eq 0 ] || exit 1
echo "OK: All YAML valid"
