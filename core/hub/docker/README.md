# Hub Docker Stack

> Part of the Adro Platform monorepo. See the root [README](../../README.md).

The [lightweight dashboard](potman-dashboard/README.md) runs on port 80.
The existing dashboard remains available on port 8081 for comparison.

The OTA server listens on port 8000 and serves files from `../ota`, the same
directory used by FileBrowser. Upload each device's manifest and firmware under
a device-type directory (for example, `../ota/dosing/manifest.json`). The
manifest must include `version` and `firmware_url`; `sha256` is optional.
