function getBrokerUrl() {
  // Server-side (SSR) — no window
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_ADRO_BROKER_URL || "ws://adro.local:9001";
  }
  // Client-side — use whatever host the browser is on
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:9001`;
}

export const HELLO_TOPIC = "adro/unclaimed/+/hello";
export const STATUS_TOPIC = "adro/devices/+/+/status";
export const TELEMETRY_TOPIC = "adro/devices/+/+/telemetry";

export function claimTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/claimed`;
}

export function unclaimTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/unclaimed`;
}

export function claimAckTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/claim-ack`;
}

export async function requestClaimState(device, claimed) {
  const client = await connectMqtt();
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const commandTopic = claimed
    ? claimTopic(device.type, device.mac)
    : unclaimTopic(device.type, device.mac);
  const ackTopic = claimAckTopic(device.type, device.mac);

  try {
    await new Promise((resolve, reject) => {
      if (client.connected) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => finish(new Error("Broker connection timed out")), 10000);
      const finish = (error) => {
        clearTimeout(timeout);
        client.removeListener("connect", onConnect);
        client.removeListener("error", onError);
        error ? reject(error) : resolve();
      };
      const onConnect = () => finish();
      const onError = (error) => finish(error);
      client.once("connect", onConnect);
      client.once("error", onError);
    });

    await new Promise((resolve, reject) => {
      client.subscribe(ackTopic, { qos: 1 }, (error) =>
        error ? reject(error) : resolve(),
      );
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        client.removeListener("message", onMessage);
        client.removeListener("error", onError);
        error ? reject(error) : resolve();
      };
      const timeout = setTimeout(
        () => finish(new Error("Device did not confirm the claim change")),
        15000,
      );
      const onError = (error) => finish(error);
      const onMessage = (topic, payload) => {
        if (topic !== ackTopic) return;
        try {
          const ack = JSON.parse(payload.toString());
          if (ack.requestId !== requestId) return;
          if (!ack.ok || ack.claimed !== claimed) {
            finish(new Error("Device could not save the claim state"));
            return;
          }
          finish();
        } catch {
          finish(new Error("Device sent an invalid claim acknowledgment"));
        }
      };

      client.on("message", onMessage);
      client.once("error", onError);
      client.publish(
        commandTopic,
        JSON.stringify({ mac: device.mac, type: device.type, requestId }),
        { qos: 1 },
        (error) => error && finish(error),
      );
    });
  } finally {
    client.end(true);
  }
}

export function telemetryTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/telemetry`;
}

export function commandTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/command`;
}

export function configTopic(deviceType, mac) {
  return `adro/devices/${deviceType}/${mac}/config`;
}

export function parseTopic(topic) {
  const parts = topic.split("/");
  if (parts[0] !== "adro") return null;

  if (parts[1] === "unclaimed" && parts[3] === "hello") {
    return { kind: "hello", mac: parts[2] };
  }
  if (parts[1] === "devices" && parts.length === 5) {
    return {
      kind: parts[4],
      type: parts[2],
      mac: parts[3],
    };
  }
  return null;
}

export async function connectMqtt() {
  const mqtt = (await import("mqtt")).default;
  return mqtt.connect(getBrokerUrl());
}