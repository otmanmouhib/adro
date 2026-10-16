"use client";

import { useEffect, useState } from "react";

const CHANNEL_COUNT = 4;

function channelsToDraft(channels) {
  return Array.from({ length: CHANNEL_COUNT }, (_, index) => ({
    on: channels[index]?.on_s ?? 1,
    off: channels[index]?.off_s ?? 1,
  }));
}

function configMatches(channel, expected) {
  return (
    Number(channel.on_s) === expected.on &&
    Number(channel.off_s) === expected.off
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
  const [dirtyChannels, setDirtyChannels] = useState({});
  const [pendingConfig, setPendingConfig] = useState({});
  const [pendingChannel, setPendingChannel] = useState({});
  const [pendingAutomation, setPendingAutomation] = useState({});
  const [pendingAllOff, setPendingAllOff] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [savedChannel, setSavedChannel] = useState(null);

  useEffect(() => {
    if (!hasTelemetry) return;
    if (Object.keys(dirtyChannels).length === 0) {
      setDraft(channelsToDraft(channels));
    }
    for (let index = 0; index < CHANNEL_COUNT; index++) {
      const channelNumber = index + 1;
      const expected = pendingConfig[channelNumber];
      if (expected && configMatches(channels[index], expected)) {
        setPendingConfig((current) => {
          if (current[channelNumber] !== expected) return current;
          const next = { ...current };
          delete next[channelNumber];
          return next;
        });
        setDirtyChannels((current) => {
          const next = { ...current };
          delete next[channelNumber];
          return next;
        });
        setSavedChannel(channelNumber);
      }
    }
    setPendingChannel((pending) => {
      let changed = false;
      const next = { ...pending };
      for (const [channelNumber, state] of Object.entries(pending)) {
        if (channels[Number(channelNumber) - 1]?.state === state) {
          delete next[channelNumber];
          changed = true;
        }
      }
      return changed ? next : pending;
    });
    setPendingAutomation((pending) => {
      let changed = false;
      const next = { ...pending };
      for (const [channelNumber, enabled] of Object.entries(pending)) {
        if (channels[Number(channelNumber) - 1]?.automation === enabled) {
          delete next[channelNumber];
          changed = true;
        }
      }
      return changed ? next : pending;
    });
    if (
      pendingAllOff &&
      channels.every((channel) => !channel.state && !channel.automation)
    ) {
      setPendingAllOff(false);
    }
  }, [dirtyChannels, hasTelemetry, channels, pendingConfig, pendingAllOff]);

  useEffect(() => {
    if (
      !pendingAllOff &&
      Object.keys(pendingChannel).length === 0 &&
      Object.keys(pendingAutomation).length === 0 &&
      Object.keys(pendingConfig).length === 0
    ) {
      return;
    }
    const timeout = setTimeout(() => {
      setActionError("The device did not confirm the update. Check that it is online and running firmware 1.0.45 or later.");
      setPendingAllOff(false);
      setPendingChannel({});
      setPendingAutomation({});
      setPendingConfig({});
    }, 10000);
    return () => clearTimeout(timeout);
  }, [pendingAllOff, pendingAutomation, pendingChannel, pendingConfig]);

  const isOnline = brokerConnected && device.status === "online";

  async function setChannel(channel, state) {
    setActionError(null);
    setPendingChannel((pending) => ({ ...pending, [channel]: state }));
    try {
      await onCommand({
        action: "set_channel",
        channel,
        state: state ? "on" : "off",
      });
    } catch (commandError) {
      setActionError(commandError.message || "Relay command could not be sent");
      setPendingChannel((pending) => {
        const next = { ...pending };
        delete next[channel];
        return next;
      });
    }
  }

  async function setAutomation(channel, enabled) {
    setActionError(null);
    setPendingAutomation((pending) => ({ ...pending, [channel]: enabled }));
    try {
      await onCommand({ action: "automation", channel, enabled });
    } catch (commandError) {
      setActionError(commandError.message || "Automation command could not be sent");
      setPendingAutomation((pending) => {
        const next = { ...pending };
        delete next[channel];
        return next;
      });
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

  async function saveConfiguration(channelNumber) {
    const channelIndex = channelNumber - 1;
    const expected = {
      on: Number(draft[channelIndex].on),
      off: Number(draft[channelIndex].off),
    };
    if (
      !Number.isFinite(expected.on) ||
      !Number.isFinite(expected.off) ||
      expected.on < 1 ||
      expected.on > 86400 ||
      expected.off < 1 ||
      expected.off > 86400
    ) {
      setActionError("Timer values must be between 1 and 86400 seconds");
      return;
    }

    setActionError(null);
    setSavedChannel(null);
    setPendingConfig((pending) => ({ ...pending, [channelNumber]: expected }));
    try {
      await onSaveConfig({ channel: channelNumber, on_s: expected.on, off_s: expected.off });
    } catch (commandError) {
      setPendingConfig((pending) => {
        const next = { ...pending };
        delete next[channelNumber];
        return next;
      });
      setActionError(commandError.message || "Configuration could not be saved");
    }
  }

  function updateDraft(channelNumber, key, value) {
    setDirtyChannels((current) => ({ ...current, [channelNumber]: true }));
    setSavedChannel(null);
    setDraft((current) =>
      current.map((channel, channelIndex) =>
        channelIndex === channelNumber - 1
          ? { ...channel, [key]: value }
          : channel,
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

        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: CHANNEL_COUNT }, (_, index) => {
            const channelNumber = index + 1;
            const channel = channels[index];
            const isOn = Boolean(channel?.state);
            const pendingState = pendingChannel[channelNumber];
            const pendingAuto = pendingAutomation[channelNumber] !== undefined;
            const saving = pendingConfig[channelNumber] !== undefined;
            return (
              <article
                key={channel?.id ?? channelNumber}
                className="min-w-0 border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <header className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">SSR {channelNumber}</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {channel?.auto_off_remaining_s > 0
                        ? `Auto-off in ${Math.ceil(channel.auto_off_remaining_s)} s`
                        : "No active auto-off timer"}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold ${isOn ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}`}
                  >
                    {pendingState !== undefined ? "Updating" : isOn ? "ON" : "OFF"}
                  </span>
                </header>

                <div className="mb-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    aria-pressed={isOn}
                    disabled={!isOnline || !hasTelemetry || pendingState !== undefined}
                    onClick={() => setChannel(channelNumber, true)}
                    className={`min-h-10 border px-3 text-sm font-semibold disabled:opacity-50 ${isOn ? "border-emerald-700 bg-emerald-700 text-white" : "border-zinc-300 hover:bg-emerald-50 dark:border-zinc-700 dark:hover:bg-emerald-950"}`}
                  >
                    ON
                  </button>
                  <button
                    type="button"
                    aria-pressed={!isOn}
                    disabled={!isOnline || !hasTelemetry || pendingState !== undefined}
                    onClick={() => setChannel(channelNumber, false)}
                    className={`min-h-10 border px-3 text-sm font-semibold disabled:opacity-50 ${!isOn ? "border-zinc-700 bg-zinc-700 text-white dark:border-zinc-300 dark:bg-zinc-300 dark:text-zinc-900" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}
                  >
                    OFF
                  </button>
                </div>

                <label className="mb-4 flex min-h-10 items-center justify-between border-y border-zinc-200 py-2 text-sm dark:border-zinc-800">
                  <span>Automatic cycling</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(channel?.automation)}
                      disabled={!isOnline || !hasTelemetry || pendingAuto}
                      onChange={(event) =>
                        setAutomation(channelNumber, event.target.checked)
                      }
                      className="h-4 w-4 accent-emerald-700"
                      aria-label={`Enable automatic cycling for SSR ${channelNumber}`}
                    />
                    <span className="text-xs text-zinc-500">
                      {pendingAuto ? "Updating…" : channel?.automation ? "On" : "Off"}
                    </span>
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="mb-1 block">On time (seconds)</span>
                    <input
                      type="number"
                      min="1"
                      max="86400"
                      step="1"
                      required
                      aria-label={`SSR ${channelNumber} on duration in seconds`}
                      value={draft[index].on}
                      disabled={!hasTelemetry || saving}
                      onChange={(event) => updateDraft(channelNumber, "on", event.target.value)}
                      className="h-10 w-full min-w-0 border border-zinc-300 bg-transparent px-2 text-sm text-zinc-900 outline-none focus:border-emerald-700 dark:border-zinc-700 dark:text-zinc-100"
                    />
                  </label>
                  <label className="text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="mb-1 block">Off time (seconds)</span>
                    <input
                      type="number"
                      min="1"
                      max="86400"
                      step="1"
                      required
                      aria-label={`SSR ${channelNumber} off duration in seconds`}
                      value={draft[index].off}
                      disabled={!hasTelemetry || saving}
                      onChange={(event) => updateDraft(channelNumber, "off", event.target.value)}
                      className="h-10 w-full min-w-0 border border-zinc-300 bg-transparent px-2 text-sm text-zinc-900 outline-none focus:border-emerald-700 dark:border-zinc-700 dark:text-zinc-100"
                    />
                  </label>
                </div>

                <div className="mt-3 flex min-h-9 items-center justify-between gap-3">
                  <span className="text-xs text-zinc-500">
                    {saving
                      ? "Waiting for ESP confirmation…"
                      : savedChannel === channelNumber
                        ? "Saved to ESP"
                        : dirtyChannels[channelNumber]
                          ? "Unsaved changes"
                          : "Saved"}
                  </span>
                  <button
                    type="button"
                    onClick={() => saveConfiguration(channelNumber)}
                    disabled={
                      !isOnline ||
                      !hasTelemetry ||
                      !dirtyChannels[channelNumber] ||
                      saving
                    }
                    className="min-h-9 border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {saving ? "Saving…" : "Save times"}
                  </button>
                </div>
              </article>
            );
          })}
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

        <p className="mt-5 text-xs text-zinc-500">
          Timer range: 1 second to 24 hours per phase. Each output saves independently.
        </p>
      </section>
    </div>
  );
}