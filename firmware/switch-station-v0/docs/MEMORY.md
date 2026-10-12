# Switch Station V0 — Memory Notes

## Target
- MCU: ESP32-S3-WROOM-1 (DevKitC-1 for v0 bringup)
- Flash: 8 MB
- PSRAM: 8 MB (unused in v0)

## Resources
- Free heap after boot: ~250 KB (measured, TBD)
- Static buffers: WiFiClient + PubSubClient + ArduinoJson `<768>` envelope
- EEPROM: 64 bytes reserved (uses ~50)

## Notes
- ArduinoJson v6 used (`DynamicJsonDocument`) to allow runtime-sized payloads
- Envelope doc sized 512 bytes, command/config doc sized 768 bytes
- If OOM errors appear, reduce command doc to 512 and move `channel_on_s` parsing to two-pass

## History
- 2026-10-12: v1.0.0 initial — 4 channels, OTA, mDNS
