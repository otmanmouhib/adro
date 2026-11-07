# dosing-station-v0 — Memory Notes

- MCU: classic ESP32 (`esp32dev` build target)
- EEPROM: 128 bytes allocated; four 16-byte pump records (from offset 8) store mL, mL/s and last dose
- MQTT: 2304-byte packet buffer; telemetry carries 4 channels plus dose-request acknowledgments

## Pump outputs
Two L298N drivers; every pump is an H-bridge channel driven with IN1 high / IN2 low.
Keep each driver's ENA/ENB jumpered or tied high.

| Channel | Role (assigned per system in the dashboard) | Driver | IN1 | IN2 |
| --- | --- | --- | --- | --- |
| 1 | Solution A | L298N #1 | GPIO 26 | GPIO 27 |
| 2 | Solution B | L298N #1 | GPIO 14 | GPIO 25 |
| 3 | pH down | L298N #2 | GPIO 32 | GPIO 33 |
| 4 | pH up | L298N #2 | GPIO 16 | GPIO 17 |

- Channel 2 IN2 is GPIO 25 (the earlier note of GPIO 12 was wrong; GPIO 12 is a strapping pin).
- Channels 3-4 pins are provisional placeholders: verify them against the final board before connecting pumps.
- Roles are only a suggested wiring order; the dashboard lets each system assign any channel to any dosing role.
- Only one pump runs at a time. A hardware esp_timer stops each dose even if Wi-Fi/MQTT blocks the main loop.
- Dose configuration: 5–50 mL and 1–10 mL/s; flow defaults to 0 until configured.
