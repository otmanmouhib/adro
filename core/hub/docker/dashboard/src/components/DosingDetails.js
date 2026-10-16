"use client";

import { useEffect, useState } from "react";

const PUMP_COUNT = 2;

function makeDraft(channels) {
  return Array.from({ length: PUMP_COUNT }, (_, index) => ({
    doseMs: channels[index]?.dose_ms ?? 5000,
    intervalSec: channels[index]?.interval_s ?? 3600,
  }));
}

function matchesConfig(channel, expected) {
  return Number(channel.dose_ms) === expected.doseMs &&
    Number(channel.interval_s) === expected.intervalSec;
}

export default function DosingDetails({
  device,
  brokerConnected,
  error,
  onClose,
  onCommand,
  onSaveConfig,
}) {
  const channels = device.telemetry?.channels || [];
  const hasTelemetry = channels.length === PUMP_COUNT;
  const [draft, setDraft] = useState(() => makeDraft(channels));
  const [dirtyPumps, setDirtyPumps] = useState({});
  const [pendingConfig, setPendingConfig] = useState({});
  const [pendingDose, setPendingDose] = useState({});
  const [pendingStop, setPendingStop] = useState({});
  const [pendingStopAll, setPendingStopAll] = useState(false);
  const [savedPump, setSavedPump] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (!hasTelemetry) return;
    if (Object.keys(dirtyPumps).length === 0) setDraft(makeDraft(channels));

    for (let index = 0; index < PUMP_COUNT; index++) {
      const pumpNumber = index + 1;
      const expected = pendingConfig[pumpNumber];
      if (expected && matchesConfig(channels[index], expected)) {
        setPendingConfig((current) => {
          if (current[pumpNumber] !== expected) return current;
          const next = { ...current };
          delete next[pumpNumber];
          return next;
        });
        setDirtyPumps((current) => {
          const next = { ...current };
          delete next[pumpNumber];
          return next;
        });
        setSavedPump(pumpNumber);
      }
    }

    setPendingDose((current) => {
      const next = { ...current };
      let changed = false;
      for (const pumpNumber of Object.keys(current)) {
        if (channels[Number(pumpNumber) - 1]?.state) {
          delete next[pumpNumber];
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setPendingStop((current) => {
      const next = { ...current };
      let changed = false;
      for (const pumpNumber of Object.keys(current)) {
        if (!channels[Number(pumpNumber) - 1]?.state) {
          delete next[pumpNumber];
          changed = true;
        }
      }
      return changed ? next : current;
    });
    if (pendingStopAll && channels.every((channel) => !channel.state)) {
      setPendingStopAll(false);
    }
  }, [channels, dirtyPumps, hasTelemetry, pendingConfig, pendingStopAll]);

  useEffect(() => {
    if (
      !pendingStopAll &&
      !Object.keys(pendingConfig).length &&
      !Object.keys(pendingDose).length &&
      !Object.keys(pendingStop).length
    ) return;

    const timeout = setTimeout(() => {
      setActionError("The dosing station did not confirm the change. Check that it is online and running the hub-compatible firmware.");
      setPendingStopAll(false);
      setPendingConfig({});
      setPendingDose({});
      setPendingStop({});
    }, 10000);
    return () => clearTimeout(timeout);
  }, [pendingConfig, pendingDose, pendingStop, pendingStopAll]);

  const isOnline = brokerConnected && device.status === "online";
  const pumpBusy = channels.some((channel) => channel.state) ||
    Object.keys(pendingDose).length > 0;

  async function runDose(pumpNumber) {
    setActionError(null);
    setPendingDose((current) => ({ ...current, [pumpNumber]: true }));
    try {
      await onCommand({ action: "dose_now", channel: pumpNumber });
    } catch (commandError) {
      setPendingDose((current) => {
        const next = { ...current };
        delete next[pumpNumber];
        return next;
      });
      setActionError(commandError.message || "Dose command could not be sent");
    }
  }

  async function stopPump(pumpNumber) {
    setActionError(null);
    setPendingStop((current) => ({ ...current, [pumpNumber]: true }));
    try {
      await onCommand({ action: "stop_pump", channel: pumpNumber });
    } catch (commandError) {
      setPendingStop((current) => {
        const next = { ...current };
        delete next[pumpNumber];
        return next;
      });
      setActionError(commandError.message || "Stop command could not be sent");
    }
  }

  async function stopAll() {
    setActionError(null);
    setPendingStopAll(true);
    try {
      await onCommand({ action: "stop_all" });
    } catch (commandError) {
      setPendingStopAll(false);
      setActionError(commandError.message || "Stop-all command could not be sent");
    }
  }

  async function savePumpConfig(pumpNumber) {
    const index = pumpNumber - 1;
    const expected = {
      doseMs: Number(draft[index].doseMs),
      intervalSec: Number(draft[index].intervalSec),
    };
    if (
      !Number.isInteger(expected.doseMs) ||
      expected.doseMs < 100 || expected.doseMs > 600000 ||
      !Number.isInteger(expected.intervalSec) ||
      expected.intervalSec < 60 || expected.intervalSec > 604800
    ) {
      setActionError("Dose time must be 100–600000 ms; interval must be 60–604800 seconds");
      return;
    }
    setActionError(null);
    setSavedPump(null);
    setPendingConfig((current) => ({ ...current, [pumpNumber]: expected }));
    try {
      await onSaveConfig({
        channel: pumpNumber,
        dose_ms: expected.doseMs,
        interval_s: expected.intervalSec,
      });
    } catch (commandError) {
      setPendingConfig((current) => {
        const next = { ...current };
        delete next[pumpNumber];
        return next;
      });
      setActionError(commandError.message || "Pump settings could not be saved");
    }
  }

  function updateDraft(pumpNumber, key, value) {
    setSavedPump(null);
    setDirtyPumps((current) => ({ ...current, [pumpNumber]: true }));
    setDraft((current) => current.map((pump, index) =>
      index === pumpNumber - 1 ? { ...pump, [key]: value } : pump,
    ));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dosing-details-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl dark:bg-zinc-900 sm:p-7"
      >
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Dosing station · 2 mapped pumps</p>
            <h2 id="dosing-details-title" className="mt-1 text-xl font-semibold">
              {device.name || device.model || device.mac}
            </h2>
            <p className="mt-1 font-mono text-xs text-zinc-500">{device.mac}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
            Close
          </button>
        </header>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {device.status === "online" ? "Online" : "Offline"}
            {device.fw ? ` · firmware ${device.fw}` : ""}
            {device.telemetry?.rssi != null ? ` · Wi-Fi ${device.telemetry.rssi} dBm` : ""}
          </span>
          <button
            type="button"
            onClick={stopAll}
            disabled={!isOnline || !hasTelemetry || pendingStopAll || !pumpBusy}
            className="min-h-10 border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-40 dark:border-red-900 dark:text-red-300"
          >
            {pendingStopAll ? "Stopping…" : "Stop all pumps"}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: PUMP_COUNT }, (_, index) => {
            const pumpNumber = index + 1;
            const pump = channels[index];
            const running = Boolean(pump?.state);
            const configuring = pendingConfig[pumpNumber] !== undefined;
            const dosePending = pendingDose[pumpNumber] !== undefined;
            const stopPending = pendingStop[pumpNumber] !== undefined;
            return (
              <article key={pumpNumber} className="min-w-0 border border-zinc-200 p-4 dark:border-zinc-800">
                <header className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Pump {pumpNumber}</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {running
                        ? `Dosing · ${Math.ceil((pump.remaining_ms || 0) / 1000)} s remaining`
                        : pump?.last_dose
                          ? `Last dose ${new Date(pump.last_dose * 1000).toLocaleString()}`
                          : "No completed doses yet"}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold ${running ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}`}>
                    {running ? "RUNNING" : "IDLE"}
                  </span>
                </header>

                <div className="mb-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => runDose(pumpNumber)}
                    disabled={!isOnline || !hasTelemetry || pumpBusy || dirtyPumps[pumpNumber] || dosePending || configuring}
                    className="min-h-10 border border-emerald-700 bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {dosePending ? "Starting…" : "Dose now"}
                  </button>
                  <button
                    type="button"
                    onClick={() => stopPump(pumpNumber)}
                    disabled={!isOnline || !running || stopPending}
                    className="min-h-10 border border-zinc-300 px-3 text-sm font-semibold disabled:opacity-40 dark:border-zinc-700"
                  >
                    {stopPending ? "Stopping…" : "Stop pump"}
                  </button>
                </div>

                <p className="mb-4 flex min-h-10 items-center border-y border-zinc-200 py-2 text-xs text-zinc-500 dark:border-zinc-800">
                  Automatic scheduling is disabled in this firmware build.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="mb-1 block">Dose time (ms)</span>
                    <input
                      type="number"
                      min="100"
                      max="600000"
                      step="100"
                      value={draft[index].doseMs}
                      disabled={!hasTelemetry || configuring}
                      onChange={(event) => updateDraft(pumpNumber, "doseMs", event.target.value)}
                      className="h-10 w-full min-w-0 border border-zinc-300 bg-transparent px-2 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                      aria-label={`Pump ${pumpNumber} dose duration milliseconds`}
                    />
                  </label>
                  <label className="text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="mb-1 block">Interval (seconds)</span>
                    <input
                      type="number"
                      min="60"
                      max="604800"
                      step="60"
                      value={draft[index].intervalSec}
                      disabled={!hasTelemetry || configuring}
                      onChange={(event) => updateDraft(pumpNumber, "intervalSec", event.target.value)}
                      className="h-10 w-full min-w-0 border border-zinc-300 bg-transparent px-2 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                      aria-label={`Pump ${pumpNumber} automatic interval seconds`}
                    />
                  </label>
                </div>

                <div className="mt-3 flex min-h-9 items-center justify-between gap-3">
                  <span className="text-xs text-zinc-500">
                    {configuring
                      ? "Waiting for ESP confirmation…"
                      : savedPump === pumpNumber
                        ? "Saved to ESP"
                        : dirtyPumps[pumpNumber]
                          ? "Unsaved changes"
                          : "Saved"}
                  </span>
                  <button
                    type="button"
                    onClick={() => savePumpConfig(pumpNumber)}
                    disabled={!isOnline || !hasTelemetry || !dirtyPumps[pumpNumber] || configuring}
                    className="min-h-9 border border-zinc-300 px-3 text-xs font-medium disabled:opacity-40 dark:border-zinc-700"
                  >
                    {configuring ? "Saving…" : "Save settings"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {!hasTelemetry && <p className="mt-4 text-sm text-zinc-500">Waiting for live pump configuration…</p>}
        <p className="mt-5 border-l-2 border-amber-500 pl-3 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          Dose now runs the configured duration and then stops automatically. Only use compatible pump drivers and tubing; verify the delivered volume before enabling automatic dosing.
        </p>
        {(error || actionError) && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{actionError || error}</p>}
        <p className="mt-4 text-xs text-zinc-500">Dose: 100–600000 ms. Automatic interval: 60–604800 seconds. Pump settings save independently.</p>
      </section>
    </div>
  );
}