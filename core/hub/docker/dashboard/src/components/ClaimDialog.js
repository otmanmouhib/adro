"use client";

import { useState } from "react";
import { requestClaimState } from "@/lib/mqtt";

export default function ClaimDialog({ device, onClose, onClaimed }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await requestClaimState(device, true);

      onClaimed({ ...device, name, status: "claimed" });
    } catch (err) {
      setError(err.message || "Claim failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900"
        role="dialog"
        aria-modal="true"
      >
        <h2 className="mb-1 text-lg font-semibold">Claim device</h2>
        <p className="mb-1 text-sm text-zinc-500">
          {device.model || device.type} ·{" "}
          <span className="font-mono text-xs">{device.mac}</span>
        </p>
        {device.capabilities && (
          <p className="mb-4 text-xs text-zinc-400">
            {device.capabilities}
          </p>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Device name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Barn switch"
              className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
            />
          </label>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {busy ? "Claiming…" : "Claim"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}