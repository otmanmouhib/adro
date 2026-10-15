"use client";

import { useEffect, useState } from "react";
import ClaimDialog from "@/components/ClaimDialog";
import {
  connectMqtt,
  HELLO_TOPIC,
  STATUS_TOPIC,
  parseTopic,
} from "@/lib/mqtt";

export default function DevicesPage() {
  const [devices, setDevices] = useState({}); // mac -> device
  const [claiming, setClaiming] = useState(null);
  const [connected, setConnected] = useState(false);

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

        let data;
        try {
          data = JSON.parse(payload.toString());
        } catch {
          return;
        }

        if (parsed.kind === "hello") {
          // hello payload: { mac, type, fw, ip, model, capabilities }
          setDevices((prev) => ({
            ...prev,
            [parsed.mac]: {
              ...prev[parsed.mac],
              mac: parsed.mac,
              type: data.type || prev[parsed.mac]?.type || "unknown",
              fw: data.fw,
              ip: data.ip,
              model: data.model || "unknown",
              capabilities: data.capabilities,
              status: prev[parsed.mac]?.status || "unclaimed",
              lastSeen: Date.now(),
            },
          }));
        }

        if (parsed.kind === "status") {
          // status payload: envelope with data.state = "online" | "offline"
          const state = data?.data?.state;
          if (!state) return;
          setDevices((prev) => ({
            ...prev,
            [parsed.mac]: {
              ...prev[parsed.mac],
              mac: parsed.mac,
              type: parsed.type,
              status: state,
              lastSeen: Date.now(),
            },
          }));
        }
      });
    })();

    return () => {
      cancelled = true;
      if (client) client.end(true);
    };
  }, []);

  const list = Object.values(devices);

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

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-zinc-500 dark:border-zinc-700">
          {connected
            ? "Searching for devices…"
            : "Waiting for broker connection…"}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((d) => (
            <li
              key={d.mac}
              className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
            >
              <div>
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
              </div>

              {!d.name && (
                <button
                  type="button"
                  onClick={() => setClaiming(d)}
                  className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Claim
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {claiming && (
        <ClaimDialog
          device={claiming}
          onClose={() => setClaiming(null)}
          onClaimed={(updated) => {
            setDevices((prev) => ({
              ...prev,
              [updated.mac]: updated,
            }));
            setClaiming(null);
          }}
        />
      )}
    </div>
  );
}