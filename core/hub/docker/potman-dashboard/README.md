# Lightweight Hub Dashboard

This Preact and Vite dashboard is a lightweight alternative to the existing
Next.js hub dashboard. Both use the same MQTT device topics and controls.

## Local development

Use Node.js 22, then run:

```sh
npm install
npm run dev
```

Open the URL printed by Vite. `npm run build` creates the static files in
`dist/`; `npm run preview` serves that build locally. Device operations
require an accessible MQTT broker and compatible devices.

## Container

The hub Compose stack provides `potman-dashboard` on port 80 alongside the
existing dashboard on port 8081. From the parent directory, build and start it
with `docker compose up --build potman-dashboard` after preparing the hub
configuration required by the Mosquitto service.

At container startup, `ADRO_TITLE` sets the sidebar title and
`ADRO_BROKER_URL` optionally sets the browser's MQTT WebSocket URL. When the
URL is empty, the dashboard uses the browser's hostname on port 9001 (using
`wss` when the page is served over HTTPS). The broker must be reachable from
the browser, not just from the container.

Container deployment and device controls have not yet been verified on the
target Raspberry Pi.
