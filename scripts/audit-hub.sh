#!/bin/bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
echo "  hub"

if [ -f hub/VERSION ]; then
  echo "    OK   VERSION = $(cat hub/VERSION)"
else
  echo "    FAIL VERSION missing"
  fail=1
fi

[ -f hub/README.md ]              && echo "    OK   README"              || echo "    WARN README missing"
[ -f hub/image/README.md ]        && echo "    OK   image/README"        || echo "    WARN image/README missing"
[ -f hub/image/firstboot.sh ]     && echo "    OK   firstboot.sh"        || echo "    WARN firstboot.sh missing"
[ -f hub/docker/docker-compose.yml ] && echo "    OK   docker-compose.yml" || echo "    WARN docker-compose.yml missing"
[ -f hub/raspap/raspap.conf ]     && echo "    OK   raspap.conf"         || echo "    WARN raspap.conf missing"
[ -f hub/raspap/hostapd.conf ]    && echo "    OK   hostapd.conf"        || echo "    WARN hostapd.conf missing"
[ -f hub/raspap/dnsmasq.conf ]    && echo "    OK   dnsmasq.conf"        || echo "    WARN dnsmasq.conf missing"

if [ -d hub/image/pi-gen ] && [ -n "$(ls -A hub/image/pi-gen 2>/dev/null)" ]; then
  echo "    OK   pi-gen/ has files"
else
  echo "    WARN pi-gen/ empty"
fi

if [ -d hub/image/overlay ] && [ -n "$(ls -A hub/image/overlay 2>/dev/null)" ]; then
  echo "    OK   overlay/ has files"
else
  echo "    WARN overlay/ empty"
fi

if [ $fail -eq 0 ]; then
  echo "OK: hub audit"
else
  echo "FAIL: hub audit"
  exit 1
fi
