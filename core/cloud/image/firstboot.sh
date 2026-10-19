#!/bin/bash
# Adro DDNS Server — first boot
set -e
echo "[adro-cloud] first boot"

mkdir -p /opt/adro/config /opt/adro/logs
# TODO: wizard, hostname, DDNS keys, Let's Encrypt
