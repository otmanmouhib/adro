# dosing-station-v0 Firmware Changelog

## [1.0.15] - 2026-11-07
### Added
- Four pump channels (second L298N: pumps 3-4 on GPIO 32/33 and 16/17, provisional).
- `dose_now` accepts a `request_id`; telemetry reports `last_dose_command` (accepted/error) and per-channel `active_request_id`/`last_request_id` so the hub can confirm each dose.
- Hardware-timer stop for every dose; larger MQTT buffer for 4-channel telemetry.
### Changed
- Stations upgraded from 2 pumps start pumps 3-4 at 5 mL / 0 mL/s (flow must be configured).

## [1.0.12] - 2026-10-16
### Added
- Hub MQTT claim, status, command, configuration, and telemetry protocol.
- Independent timed dosing controls and persisted configuration for two pumps.
- Persist dose volume in mL and measured pump flow in mL/s; ESP derives safe runtime.
- Dashboard telemetry reporting and safe pump-off behavior on boot.

## [1.0.0] - 2026-10-11
### Added
- Initial firmware stub.
