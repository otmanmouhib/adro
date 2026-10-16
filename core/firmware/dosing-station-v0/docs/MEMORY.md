# dosing-station-v0 — Memory Notes

- MCU: ESP32-S3-WROOM-1
- Flash: 8 MB target board
- EEPROM: 128 bytes allocated; two 20-byte pump records store mL, mL/s, interval, automation, and last dose
- MQTT: 1024-byte packet buffer

## Pump outputs
- Pump 1 H-bridge: IN1 GPIO 26, IN2 GPIO 27
- Pump 2 H-bridge: IN1 GPIO 14, IN2 GPIO 12
- This firmware version supports two physical pumps. Add channels only after the board GPIO/driver map is verified.
- Dose configuration: 5–50 mL and 1–10 mL/s; flow defaults to 0 until configured.
