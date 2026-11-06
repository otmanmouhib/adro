// Runtime config, generated at container start into /config.js (see docker-entrypoint.sh).
const runtime = window.__ADRO_CONFIG__ || {};

export const config = {
  title: runtime.title || "Adro Hub",
  brokerUrl: runtime.brokerUrl || "",
};
