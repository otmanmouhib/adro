"use client";

import { useEffect, useRef, useState } from "react";
import ClaimDialog from "@/components/ClaimDialog";
import SwitchDetails from "@/components/SwitchDetails";
import {
  commandTopic,
  configTopic,
  connectMqtt,
  HELLO_TOPIC,
  STATUS_TOPIC,
  TELEMETRY_TOPIC,
  parseTopic,
  requestClaimState,
} from "@/lib/mqtt";

const DEVICE_NAMES_KEY = "adro.deviceNames";

function getSavedDeviceNames() {
  try {
    return JSON.parse(window.localStorage.getItem(DEVICE_NAMES_KEY) || "{}");
  } catch {
    return {};
  }
}

function publishMqtt(client, topic, data) {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify({ data }), { qos: 1 }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

export default function DevicesPage() {
  const [devices, setDevices] = useState({}); // mac -> device
  const [claiming, setClaiming] = useState(null);
  const [connected, setConnected] = useState(false);
  const [changingClaim, setChangingClaim] = useState(null);
  const [claimError, setClaimError] = useState(null);
  const [selectedMac, setSelectedMac] = useState(null);
  const [detailsError, setDetailsError] = useState(null);
  const clientRef = useRef(null);

  useEffect(() => {
    let client;
    let cancelled = false;

    (async () => {
      console.log(
        "[MQTT] connecting to",
        typeof window !== "undefined"
          ? `ws://${window.location.hostname}:9001`
          : "ws://adro.local:9001",
      );

      client = await connectMqtt();
      clientRef.current = client;
      console.log("[MQTT] client object created");

      if (cancelled) {
        client.end(true);
        return;
      }

      client.on("connect", () => {
        console.log("[MQTT] CONNECTED — subscribing");
        setConnected(true);
        client.subscribe(HELLO_TOPIC, { qos: 1 });
        client.subscribe(STATUS_TOPIC, { qos: 1 });
        client.subscribe(TELEMETRY_TOPIC, { qos: 1 });
      });

      client.on("error", (err) => {
        console.error("[MQTT] ERROR", err);
      });

      client.on("close", () => {
        console.log("[MQTT] CLOSED");
        setConnected(false);
      });

      client.on("offline", () => {
        console.log("[MQTT] OFFLINE");
        setConnected(false);
      });

      client.on("reconnect", () => {
        console.log("[MQTT] RECONNECTING");
      });

      client.on("message", (topic, payload) => {
        console.log("[MQTT] MESSAGE", topic, payload.toString());

        const parsed = parseTopic(topic);
        if (!parsed) return;

        if (parsed.kind === "status" && payload.length === 0) {
          const savedName = getSavedDeviceNames()[parsed.mac];
          setDevices((prev) => ({
            ...prev,
            [parsed.mac]: {
              ...prev[parsed.mac],
              mac: parsed.mac,
              type: parsed.type,
              name: prev[parsed.mac]?.name || savedName,
              claimed: false,
              status: "unclaimed",
            },
          }));
          return;
        }

        let data;
        try {
          data = JSON.parse(payload.toString());
        } catch {
          return;
        }

        if (parsed.kind === "hello") {
          // hello payload: { mac, type, fw, ip, model, capabilities }
          const savedName = getSavedDeviceNames()[parsed.mac];
          setDevices((prev) => ({
            ...prev,
            [parsed.mac]: {
              ...prev[parsed.mac],
              mac: parsed.mac,
              type: data.type || prev[parsed.mac]?.type || "unknown",
              name: prev[parsed.mac]?.name || savedName,
              fw: data.fw,
              ip: data.ip,
              model: data.model || "unknown",
              capabilities: data.capabilities,
              claimed: false,
              status: "unclaimed",
              lastSeen: Date.now(),
            },
          }));
        }

        if (parsed.kind === "status") {
          // status payload: envelope with data.state = "online" | "offline"
          const state = data?.data?.state;
          if (!state) return;
          const savedName = getSavedDeviceNames()[parsed.mac];
          setDevices((prev) => ({
            ...prev,
            [parsed.mac]: {
              ...prev[parsed.mac],
              mac: parsed.mac,
              type: parsed.type,
              name: prev[parsed.mac]?.name || savedName,
              claimed: state === "online" || state === "offline",
              status: state,
              lastSeen: Date.now(),
            },
          }));
        }

        if (parsed.kind === "telemetry") {
          const telemetry = data?.data;
          if (!Array.isArray(telemetry?.channels)) return;
          const savedName = getSavedDeviceNames()[parsed.mac];
          setDevices((prev) => ({
            ...prev,
            [parsed.mac]: {
              ...prev[parsed.mac],
              mac: parsed.mac,
              type: parsed.type,
              name: prev[parsed.mac]?.name || savedName,
              claimed: true,
              status: "online",
              fw: data.v || prev[parsed.mac]?.fw,
              telemetry,
              lastTelemetry: Date.now(),
            },
          }));
        }
      });
    })();

    return () => {
      cancelled = true;
      if (clientRef.current === client) clientRef.current = null;
      if (client) client.end(true);
    };
  }, []);

  function sendDeviceCommand(device, command) {
    const client = clientRef.current;
    if (!client?.connected) {
      return Promise.reject(new Error("Dashboard is disconnected from the broker"));
    }
    return publishMqtt(client, commandTopic(device.type, device.mac), command);
  }

  function saveDeviceConfig(device, config) {
    const client = clientRef.current;
    if (!client?.connected) {
      return Promise.reject(new Error("Dashboard is disconnected from the broker"));
    }
    return publishMqtt(client, configTopic(device.type, device.mac), config);
  }

  function openDevice(device) {
    setSelectedMac(device.mac);
    setDetailsError(null);
    sendDeviceCommand(device, { action: "get_state" }).catch((error) => {
      setDetailsError(error.message || "Could not request device state");
    });
  }

  async function unclaimDevice(device) {
    setChangingClaim(device.mac);
    setClaimError(null);
    try {
      await requestClaimState(device, false);
      const names = getSavedDeviceNames();
      delete names[device.mac];
      window.localStorage.setItem(DEVICE_NAMES_KEY, JSON.stringify(names));
      setDevices((prev) => ({
        ...prev,
        [device.mac]: { ...prev[device.mac], claimed: false, status: "unclaimed", name: undefined },
      }));
      if (selectedMac === device.mac) setSelectedMac(null);
    } catch (error) {
      setClaimError(error.message || "Unclaim failed");
    } finally {
      setChangingClaim(null);
    }
  }

  const list = Object.values(devices);
  const selectedDevice = selectedMac ? devices[selectedMac] : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">
          Devices
        </h1>
        <p className="leading-7 text-zinc-600 dark:text-zinc-400">
          Nearby Adro devices that have announced themselves on the local
          network. Select one to claim it to this hub.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-2 text-xs">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            connected ? "bg-green-500" : "bg-red-500"
          }`}
        />
        <span className="text-zinc-500">
          {connected ? "Connected to broker" : "Disconnected from broker"}
        </span>
      </div>
      {claimError && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">{claimError}</p>
      )}

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-zinc-500 dark:border-zinc-700">
          {connected
            ? "Searching for devices…"
            : "Waiting for broker connection…"}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((d) => (
            <li key={d.mac} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => (d.claimed ? openDevice(d) : setClaiming(d))}
                className="block min-h-40 w-full p-5 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700 dark:hover:bg-zinc-800/60"
              >
                <div className="font-medium">
                  {d.name || d.model || d.mac}
                </div>
                <div className="text-sm text-zinc-500">
                  {d.type} · {d.model || "unknown model"}
                </div>
                <div className="mt-1 font-mono text-xs text-zinc-400">
                  {d.mac}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      d.status === "online"
                        ? "bg-green-500"
                        : d.status === "offline"
                          ? "bg-zinc-400"
                          : "bg-yellow-500"
                    }`}
                  />
                  <span className="text-zinc-500">
                    {d.status || "unclaimed"}
                    {d.ip ? ` · ${d.ip}` : ""}
                  </span>
                </div>
                {d.capabilities && (
                  <div className="mt-1 text-xs text-zinc-400">
                    {d.capabilities}
                  </div>
                )}
                <div className="mt-4 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  {d.claimed ? "Open switch controls" : "Claim this switch"}
                  <span aria-hidden="true"> →</span>
                </div>
              </button>

              <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
                {d.claimed ? (
                <button
                  type="button"
                  onClick={() => unclaimDevice(d)}
                  disabled={changingClaim === d.mac}
                  className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {changingClaim === d.mac ? "Unclaiming…" : "Unclaim"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setClaiming(d)}
                  className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Claim
                </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {claiming && (
        <ClaimDialog
          device={claiming}
          onClose={() => setClaiming(null)}
          onClaimed={(updated) => {
            const names = getSavedDeviceNames();
            names[updated.mac] = updated.name;
            window.localStorage.setItem(DEVICE_NAMES_KEY, JSON.stringify(names));
            setDevices((prev) => ({
              ...prev,
              [updated.mac]: { ...updated, claimed: true },
            }));
            setClaiming(null);
          }}
        />
      )}
      {selectedDevice?.claimed && (
        <SwitchDetails
          device={selectedDevice}
          brokerConnected={connected}
          error={detailsError}
          onClose={() => setSelectedMac(null)}
          onCommand={(command) => sendDeviceCommand(selectedDevice, command)}
          onSaveConfig={(config) => saveDeviceConfig(selectedDevice, config)}
        />
      )}
    </div>
  );
}