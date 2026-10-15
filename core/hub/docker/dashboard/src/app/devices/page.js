"use client";

import { useEffect, useState } from "react";
import ClaimDialog from "@/components/ClaimDialog";
import { connectMqtt, DISCOVERY_TOPIC } from "@/lib/mqtt";

export default function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [claiming, setClaiming] = useState(null);

  useEffect(() => {
    let client;
    let cancelled = false;

    (async () => {
      client = await connectMqtt();
      if (cancelled) {
        client.end(true);
        return;
      }

      client.on("connect", () => {
        client.subscribe(DISCOVERY_TOPIC);
      });

      client.on("message", (_topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());
          setDevices((prev) => {
            const idx = prev.findIndex((d) => d.id === data.id);
            if (idx === -1) return [...prev, data];
            const next = [...prev];
            next[idx] = data;
            return next;
          });
        } catch {
          // ignore malformed payloads
        }
      });
    })();

    return () => {
      cancelled = true;
      if (client) client.end(true);
    };
  }, []);

  return (
    <div className="max-w-3xl">
      <h1 className="mb-3 text-3xl font-semibold tracking-tight">Devices</h1>
      <p className="mb-8 leading-7 text-zinc-600 dark:text-zinc-400">
        Nearby Adro devices that have announced themselves on the local
        network. Select one to claim it to this hub.
      </p>

      {devices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-zinc-500 dark:border-zinc-700">
          Searching for devices…
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
            >
              <div>
                <div className="font-medium">{d.name || d.id}</div>
                <div className="text-sm text-zinc-500">
                  {d.model || "Unknown model"} · {d.ip || "no IP"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClaiming(d)}
                className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Claim
              </button>
            </li>
          ))}
        </ul>
      )}

      {claiming && (
        <ClaimDialog
          device={claiming}
          onClose={() => setClaiming(null)}
          onClaimed={(updated) => {
            setDevices((prev) =>
              prev.map((d) => (d.id === updated.id ? updated : d)),
            );
            setClaiming(null);
          }}
        />
      )}
    </div>
  );
}