const BROKER_URL =
  process.env.NEXT_PUBLIC_ADRO_BROKER_URL || "ws://adro.local:9001";

export const DISCOVERY_TOPIC = "adro/discovery/esp";

export function claimTopic(deviceId) {
  return `adro/claim/${deviceId}`;
}

export async function connectMqtt() {
  const mqtt = (await import("mqtt")).default;
  return mqtt.connect(BROKER_URL);
}