#!/bin/bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
echo "  cloud"

if [ -f cloud/VERSION ]; then
  echo "    OK   VERSION = $(cat cloud/VERSION)"
else
  echo "    FAIL VERSION missing"
  fail=1
fi

[ -f cloud/README.md ]                && echo "    OK   README"              || echo "    WARN README missing"
[ -f cloud/image/README.md ]          && echo "    OK   image/README"        || echo "    WARN image/README missing"
[ -f cloud/image/autoinstall.yaml ]   && echo "    OK   autoinstall.yaml"    || echo "    WARN autoinstall.yaml missing"
[ -f cloud/image/firstboot.sh ]       && echo "    OK   firstboot.sh"        || echo "    WARN firstboot.sh missing"
[ -f cloud/docker/docker-compose.yml ] && echo "    OK   docker-compose.yml" || echo "    WARN docker-compose.yml missing"

if [ -d cloud/image/overlay ] && [ -n "$(ls -A cloud/image/overlay 2>/dev/null)" ]; then
  echo "    OK   overlay/ has files"
else
  echo "    WARN overlay/ empty"
fi

if [ -d cloud/config/env.examples ] && [ -n "$(ls -A cloud/config/env.examples 2>/dev/null)" ]; then
  echo "    OK   env.examples/ has files"
else
  echo "    WARN env.examples/ empty"
fi

if [ $fail -eq 0 ]; then
  echo "OK: cloud audit"
else
  echo "FAIL: cloud audit"
  exit 1
fi
