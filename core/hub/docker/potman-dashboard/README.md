# Lightweight Hub Dashboard

This Preact and Vite dashboard is a lightweight alternative to the existing
Next.js hub dashboard. Both use the same MQTT device topics and controls.

## Local development

Use Node.js 22, then run:

```sh
npm install
ADRO_SYSTEMS_FILE="$HOME/adro-systems.json" npm run api
```

In another terminal:

```sh
npm run dev
```

Open the URL printed by Vite. `npm run build` creates the static files in
`dist/`; `npm run preview` serves that build locally. Device operations
require an accessible MQTT broker and compatible devices.
The development API command stores systems in the specified file.

## Container

The hub Compose stack provides `potman-dashboard` on port 80 alongside the
existing dashboard on port 8081. From the parent directory, build and start it
with `docker compose up --build potman-dashboard` after preparing the hub
configuration required by the Mosquitto service.

The Systems page creates named standalone systems and maps their circulation
pump, feed pump or valve, solution A and B, and pH-down pumps to claimed device
channels.
After saving an assignment, its channel's controls and settings appear on the
system card. Controls are disabled while the device is offline or live
telemetry is unavailable. Only online devices are offered for new assignments;
saved assignments remain visible if a device goes offline. A channel may
belong to only one component across all systems.

System configurations are stored on the hub in the `potman-systems-data`
Docker volume and shared between browsers. Device display names still come
from each browser's local storage; MAC addresses identify devices consistently.
The storage service has no authentication, like the existing dashboard and
local MQTT broker, so restrict access to trusted networks. Do not remove the
volume when updating containers if you want to keep system configurations.
The dashboard image starts both nginx and the configuration API automatically.
When using `docker run` instead of Compose, mount a volume at `/data` to retain
systems when the container is removed.

At container startup, `ADRO_TITLE` sets the sidebar title and
`ADRO_BROKER_URL` optionally sets the browser's MQTT WebSocket URL. When the
URL is empty, the dashboard uses the browser's hostname on port 9001 (using
`wss` when the page is served over HTTPS). The broker must be reachable from
the browser, not just from the container.

Container deployment and device controls have not yet been verified on the
target Raspberry Pi.
