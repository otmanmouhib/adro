"use client";

import { useEffect, useRef, useState } from "react";

const CHANNEL_COUNT = 4;

function channelsToDraft(channels) {
  return Array.from({ length: CHANNEL_COUNT }, (_, index) => ({
    on: channels[index]?.on_s ?? 1,
    off: channels[index]?.off_s ?? 1,
  }));
}

function configMatches(channels, expected) {
  return channels.every(
    (channel, index) =>
      Number(channel.on_s) === expected[index].on &&
      Number(channel.off_s) === expected[index].off,
  );
}

export default function SwitchDetails({
  device,
  brokerConnected,
  error,
  onClose,
  onCommand,
  onSaveConfig,
}) {
  const channels = device.telemetry?.channels || [];
  const hasTelemetry = channels.length === CHANNEL_COUNT;
  const [draft, setDraft] = useState(() => channelsToDraft(channels));
  const [draftDirty, setDraftDirty] = useState(false);
  const [pendingConfig, setPendingConfig] = useState(false);
  const [pendingChannel, setPendingChannel] = useState(null);
  const [pendingAutomation, setPendingAutomation] = useState(null);
  const [pendingAllOff, setPendingAllOff] = useState(false);
  const [actionError, setActionError] = useState(null);
  const pendingConfigRef = useRef(null);

  useEffect(() => {
    if (!hasTelemetry) return;
    const expected = pendingConfigRef.current;
    if (expected && configMatches(channels, expected)) {
      pendingConfigRef.current = null;
      setDraftDirty(false);
      setPendingConfig(false);
    }
    if (!draftDirty) setDraft(channelsToDraft(channels));
    setPendingChannel((pending) => {
      if (!pending) return null;
      return channels[pending.channel - 1]?.state === pending.state
        ? null
        : pending;
    });
    if (
      pendingAutomation !== null &&
      device.telemetry.automation === pendingAutomation
    ) {
      setPendingAutomation(null);
    }
    if (pendingAllOff && channels.every((channel) => !channel.state)) {
      setPendingAllOff(false);
    }
  }, [device.telemetry, draftDirty, hasTelemetry, channels, pendingAutomation, pendingAllOff]);

  const isOnline = brokerConnected && device.status === "online";

  async function setChannel(channel, state) {
    setActionError(null);
    setPendingChannel({ channel, state });
    try {
      await onCommand({
        action: "set_channel",
        channel,
        state: state ? "on" : "off",
      });
    } catch (commandError) {
      setActionError(commandError.message || "Relay command could not be sent");
      setPendingChannel(null);
    }
  }

  async function setAutomation(enabled) {
    setActionError(null);
    setPendingAutomation(enabled);
    try {
      await onCommand({ action: "automation", enabled });
    } catch (commandError) {
      setActionError(commandError.message || "Automation command could not be sent");
      setPendingAutomation(null);
    }
  }

  async function turnAllOff() {
    setActionError(null);
    setPendingAllOff(true);
    try {
      await onCommand({ action: "set_all", state: "off" });
    } catch (commandError) {
      setActionError(commandError.message || "All-off command could not be sent");
      setPendingAllOff(false);
    }
  }

  async function saveConfiguration(event) {
    event.preventDefault();
    const expected = draft.map(({ on, off }) => ({
      on: Number(on),
      off: Number(off),
    }));
    if (
      expected.some(
        ({ on, off }) =>
          !Number.isFinite(on) ||
          !Number.isFinite(off) ||
          on < 1 ||
          on > 86400 ||
          off < 1 ||
          off > 86400,
      )
    ) {
      setActionError("Timer values must be between 1 and 86400 seconds");
      return;
    }

    setActionError(null);
    setPendingConfig(true);
    pendingConfigRef.current = expected;
    try {
      await onSaveConfig({
        channel_on_s: expected.map((channel) => channel.on),
        channel_off_s: expected.map((channel) => channel.off),
      });
    } catch (commandError) {
      pendingConfigRef.current = null;
      setPendingConfig(false);
      setActionError(commandError.message || "Configuration could not be saved");
    }
  }

  function updateDraft(index, key, value) {
    setDraftDirty(true);
    setDraft((current) =>
      current.map((channel, channelIndex) =>
        channelIndex === index ? { ...channel, [key]: value } : channel,
      ),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="switch-details-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl dark:bg-zinc-900 sm:p-7"
      >
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Switch station · 4 SSR outputs</p>
            <h2 id="switch-details-title" className="mt-1 text-xl font-semibold">
              {device.name || device.model || device.mac}
            </h2>
            <p className="mt-1 font-mono text-xs text-zinc-500">{device.mac}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            Close
          </button>
        </header>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="text-zinc-600 dark:text-zinc-400">
            {device.status === "online" ? "Online" : "Offline"}
            {device.fw ? ` · firmware ${device.fw}` : ""}
            {device.telemetry?.rssi != null ? ` · Wi-Fi ${device.telemetry.rssi} dBm` : ""}
          </div>
          <button
            type="button"
            onClick={turnAllOff}
            disabled={!isOnline || !hasTelemetry || pendingAllOff}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300"
          >
            {pendingAllOff ? "Switching off…" : "All outputs off"}
          </button>
        </div>

        <div className="mb-6 flex items-center justify-between border-y border-zinc-200 py-4 dark:border-zinc-800">
          <div>
            <h3 className="font-medium">Automatic cycling</h3>
            <p className="mt-0.5 text-xs text-zinc-500">Each output alternates using its on/off timer.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(device.telemetry?.automation)}
              disabled={!isOnline || !hasTelemetry || pendingAutomation !== null}
              onChange={(event) => setAutomation(event.target.checked)}
              className="h-4 w-4 accent-emerald-700"
            />
            <span>{pendingAutomation ? "Updating…" : device.telemetry?.automation ? "On" : "Off"}</span>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="pb-2 pr-3 font-medium">Output</th>
                <th className="pb-2 px-2 font-medium">Relay state</th>
                <th className="pb-2 px-2 font-medium">On seconds</th>
                <th className="pb-2 px-2 font-medium">Off seconds</th>
                <th className="pb-2 pl-2 font-medium">Auto-off</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: CHANNEL_COUNT }, (_, index) => {
                const channel = channels[index];
                const isOn = Boolean(channel?.state);
                const nextState = !isOn;
                const pending = pendingChannel?.channel === index + 1;
                return (
                  <tr key={channel?.id ?? index + 1} className="border-t border-zinc-200 dark:border-zinc-800">
                    <th className="py-3 pr-3 font-medium">SSR {index + 1}</th>
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        aria-pressed={isOn}
                        disabled={!isOnline || !hasTelemetry || pending}
                        onClick={() => setChannel(index + 1, nextState)}
                        className={`min-w-20 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${isOn ? "bg-emerald-700 text-white" : "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"}`}
                      >
                        {pending ? "Updating…" : isOn ? "ON" : "OFF"}
                      </button>
                    </td>
                    <td className="px-2 py-3">
                      <input
                        type="number"
                        min="1"
                        max="86400"
                        step="1"
                        required
                        aria-label={`SSR ${index + 1} on duration in seconds`}
                        value={draft[index].on}
                        disabled={!hasTelemetry}
                        onChange={(event) => updateDraft(index, "on", event.target.value)}
                        className="w-24 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                      />
                    </td>
                    <td className="px-2 py-3">
                      <input
                        type="number"
                        min="1"
                        max="86400"
                        step="1"
                        required
                        aria-label={`SSR ${index + 1} off duration in seconds`}
                        value={draft[index].off}
                        disabled={!hasTelemetry}
                        onChange={(event) => updateDraft(index, "off", event.target.value)}
                        className="w-24 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                      />
                    </td>
                    <td className="py-3 pl-2 text-zinc-600 dark:text-zinc-400">
                      {channel?.auto_off_remaining_s > 0
                        ? `${Math.ceil(channel.auto_off_remaining_s)} s`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!hasTelemetry && (
          <p className="mt-4 text-sm text-zinc-500">
            Waiting for live device configuration…
          </p>
        )}
        <p className="mt-5 border-l-2 border-amber-500 pl-3 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          SSR outputs may switch 220 V AC loads. Only operate equipment that is correctly rated and installed; verify the connected load before switching it on.
        </p>
        {(error || actionError) && (
          <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
            {actionError || error}
          </p>
        )}

        <form onSubmit={saveConfiguration} className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={!isOnline || !hasTelemetry || pendingConfig || !draftDirty}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pendingConfig ? "Waiting for device…" : "Save timer settings"}
          </button>
        </form>
        <p className="mt-2 text-right text-xs text-zinc-500">
          Timer range: 1 second to 24 hours per phase.
        </p>
      </section>
    </div>
  );
}