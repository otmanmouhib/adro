# Switch Station V0 Firmware Changelog

## [1.0.45] - 2026-10-16
### Fixed
- Apply and persist timer edits for one SSR channel without modifying other channels.

## [1.0.44] - 2026-10-16
### Added
- Independent per-SSR automatic cycling settings persisted in EEPROM and reported in telemetry.

## [1.0.43] - 2026-10-16
### Fixed
- Clear retained claim commands after transitions to prevent replay-driven reboot loops.
- Keep unclaimed devices unsubscribed from the unclaim topic.

## [1.0.0] - 2026-10-12
### Added
- Initial firmware release.
- 4-channel SSR control (GPIO 4/5/6/7, active-high).
- mDNS broker resolution (`adro.local`).
- MQTT envelope payloads `{ts, seq, v, dev, data}`.
- Retained LWT status (online/offline) at QoS 1.
- Per-channel manual on/off with optional `duration_s` auto-off.
- Global automation mode with per-channel on/off cycle timers.
- RGB LED status indicator.
- EEPROM persistence for automation flag + per-channel state/timers.
- NTP sync via IP (no DNS dependency).
- OTA with SHA256 verification.
- Scheduled reboot every 6 hours.
- Exponential MQTT reconnect backoff.
- Reboot on mDNS resolution failure.
