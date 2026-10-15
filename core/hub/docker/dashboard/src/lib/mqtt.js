const BROKER_URL =
  process.env.NEXT_PUBLIC_ADRO_BROKER_URL || "ws://adro.local:9001";

export const HELLO_TOPIC = "adro/unclaimed/+/hello";
export const STATUS_TOPIC = "adro/devices/+/+/status";

export function claimTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/claimed`;
}

export function unclaimTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/unclaimed`;
}

export function telemetryTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/telemetry`;
}

export function commandTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/command`;
}

export function parseTopic(topic) {
  // adro/unclaimed/<mac>/hello
  // adro/devices/<type>/<mac>/<suffix>
  const parts = topic.split("/");
  if (parts[0] !== "adro") return null;

  if (parts[1] === "unclaimed" && parts[3] === "hello") {
    return { kind: "hello", mac: parts[2] };
  }
  if (parts[1] === "devices" && parts.length === 5) {
    return {
      kind: parts[4],       // status | telemetry | claimed | unclaimed | command | config
      type: parts[2],
      mac: parts[3],
    };
  }
  return null;
}

export async function connectMqtt() {
  const mqtt = (await import("mqtt")).default;
  return mqtt.connect(BROKER_URL);
}