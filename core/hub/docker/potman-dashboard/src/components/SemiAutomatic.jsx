import { useState } from "react";
import { roleLabels, validateDoseConfig } from "../../server/dose-decision.mjs";

const thresholdFields = [
	["phMin", "Minimum pH (below this, dose pH up)", "0", "14", "0.01"],
	["phMax", "Maximum pH (above this, dose pH down)", "0", "14", "0.01"],
	["tdsMin", "Minimum TDS ppm (below this, dose A + B)", "0", undefined, "1"],
	["tdsMax", "Maximum TDS ppm (above this, no nutrients)", "0", undefined, "1"],
	["maxDosesPerDay", "Maximum pump activations per day", "1", undefined, "1"],
	["mixingSeconds", "Mixing delay between pumps (5–30 s)", "5", "30", "1"],
];

const doseFields = [
	["solutionA", "nutrients", "Solution A per dose (mL)"],
	["solutionB", "nutrients", "Solution B per dose (mL)"],
	["phDown", "phDown", "pH down per dose (mL)"],
	["phUp", "phUp", "pH up per dose (mL)"],
];

const inputClass =
	"min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700";

function configToDraft(config) {
	return {
		...Object.fromEntries(
			thresholdFields.map(([key]) => [key, String(config?.[key] ?? "")]),
		),
		...Object.fromEntries(
			doseFields.map(([key]) => [key, String(config?.doses?.[key] ?? "")]),
		),
	};
}

function parseNumber(value) {
	return value.trim() === "" ? Number.NaN : Number(value);
}

function describeEvent(event) {
	const done = event.completed?.map((role) => roleLabels[role]).join(", ");
	if (!event.allowed) return event.reason;
	const description =
		{
			completed: `Dose completed${done ? `: ${done}` : ""}`,
			partial: `Partial dose${done ? `: ${done}` : ""}`,
			failed: `Dose failed${done ? `; completed: ${done}` : ""}`,
		}[event.status] || "Dose in progress";
	return `${description}${event.reason ? ` — ${event.reason}` : ""}`;
}

function eventOutcome(event) {
	if (!event.allowed) return { label: "Declined", kind: "declined" };
	const outcomes = {
		completed: { label: "Success", kind: "completed" },
		partial: { label: "Partial", kind: "partial" },
		failed: { label: "Failed", kind: "failed" },
	};
	return outcomes[event.status] || { label: "Running", kind: "running" };
}

const outcomeStyles = {
	completed:
		"border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20",
	partial:
		"border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20",
	failed:
		"border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20",
	declined:
		"border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20",
	running:
		"border-sky-200 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/20",
};

const outcomeBadgeStyles = {
	completed:
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
	partial:
		"bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
	failed: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200",
	declined:
		"bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
	running: "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200",
};

export default function SemiAutomatic({
	system,
	available,
	saving,
	onSave,
	onRun,
}) {
	const config = system.semiAutomatic;
	const [configureOpen, setConfigureOpen] = useState(false);
	const [doseOpen, setDoseOpen] = useState(false);
	const [draft, setDraft] = useState(() => configToDraft(config));
	const [ph, setPh] = useState("");
	const [tds, setTds] = useState("");
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState(null);
	const [error, setError] = useState(null);
	const [notice, setNotice] = useState(null);
	const busy = saving || running;
	const canDose = available.nutrients || available.phDown || available.phUp;
	const usage = Object.entries(config?.dailyUsage || {})[0];

	function toggleConfigure() {
		setNotice(null);
		setError(null);
		if (!configureOpen) setDraft(configToDraft(config));
		setConfigureOpen(!configureOpen);
	}

	function startDose() {
		setResult(null);
		setError(null);
		if (!config) {
			setNotice(
				"Save the safeguards once first. After that, enter a pH reading, a TDS reading, or both for each dose.",
			);
			setConfigureOpen(true);
			setDoseOpen(false);
			return;
		}
		setNotice(null);
		setDoseOpen(!doseOpen);
	}

	async function saveConfig(event) {
		event.preventDefault();
		const doses = { ...config?.doses };
		for (const [key, group] of doseFields) {
			if (available[group]) doses[key] = parseNumber(draft[key]);
		}
		const next = {
			...Object.fromEntries(
				thresholdFields.map(([key]) => [key, parseNumber(draft[key])]),
			),
			doses,
		};
		try {
			validateDoseConfig(next);
		} catch {
			setError(
				"Check the values: pH 0–14 (min below max), TDS min below max, daily limit of at least 1, mixing 5–30 s, and dose volumes 5–50 mL.",
			);
			return;
		}
		setError(null);
		if (await onSave(next)) {
			setConfigureOpen(false);
			setNotice("Safeguards saved. Use Semi-auto dose to enter readings.");
		}
	}

	async function triggerDose(event) {
		event.preventDefault();
		setResult(null);
		setError(null);
		setNotice(null);
		const measurements = {};
		if (ph.trim() !== "") measurements.ph = parseNumber(ph);
		if (tds.trim() !== "") measurements.tds = parseNumber(tds);
		if (!Object.keys(measurements).length) {
			setError("Enter a pH reading, a TDS reading, or both.");
			return;
		}
		setRunning(true);
		try {
			setResult(await onRun(measurements));
			setDoseOpen(false);
		} catch (runError) {
			setError(runError.message || "Semi-automatic dose request failed");
		} finally {
			setRunning(false);
		}
	}

	return (
		<section
			aria-label={`Semi-automatic dosing for ${system.name}`}
			className="mb-3 rounded-lg border border-emerald-700/40 bg-emerald-50/40 p-3 dark:bg-emerald-950/20"
		>
			<header className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="font-semibold">Semi-automatic dosing</h3>
					<p className="text-xs text-zinc-600 dark:text-zinc-400">
						Nutrients A + B: {available.nutrients ? "assigned" : "not assigned"}{" "}
						· pH down: {available.phDown ? "assigned" : "not assigned"} · pH up:{" "}
						{available.phUp ? "assigned" : "not assigned"}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={startDose}
						aria-expanded={doseOpen}
						disabled={busy}
						className="min-h-10 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-40"
					>
						Semi-auto dose
					</button>
					<button
						type="button"
						onClick={toggleConfigure}
						aria-expanded={configureOpen}
						disabled={busy}
						className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm disabled:opacity-40 dark:border-zinc-700"
					>
						{config ? "Safeguards" : "Set up safeguards"}
					</button>
				</div>
			</header>

			{config && (
				<p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
					pH {config.phMin}–{config.phMax} · TDS {config.tdsMin}–{config.tdsMax}{" "}
					ppm · max {config.maxDosesPerDay} pump activations/day
					{usage ? ` (${usage[1]} used on ${usage[0]})` : ""} ·{" "}
					{config.mixingSeconds} s mixing
				</p>
			)}
			{!canDose && (
				<p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
					Assign Solution A and B, and/or a pH down or pH up pump, with
					Configure below before a dose can run.
				</p>
			)}
			{notice && (
				<p role="status" className="mt-3 text-sm">
					{notice}
				</p>
			)}

			{configureOpen && (
				<form onSubmit={saveConfig} className="mt-4 grid gap-3">
					<h4 className="font-semibold">Guardrails and dose volumes</h4>
					<div className="grid gap-3 sm:grid-cols-2">
						{thresholdFields.map(([key, label, min, max, step]) => (
							<label key={key} className="grid gap-1 text-sm">
								{label}
								<input
									type="number"
									min={min}
									max={max}
									step={step}
									required
									value={draft[key]}
									disabled={busy}
									onInput={(event) =>
										setDraft({ ...draft, [key]: event.currentTarget.value })
									}
									className={inputClass}
								/>
							</label>
						))}
						{doseFields
							.filter(([, group]) => available[group])
							.map(([key, , label]) => (
								<label key={key} className="grid gap-1 text-sm">
									{label}
									<input
										type="number"
										min="5"
										max="50"
										step="0.1"
										required
										value={draft[key]}
										disabled={busy}
										onInput={(event) =>
											setDraft({ ...draft, [key]: event.currentTarget.value })
										}
										className={inputClass}
									/>
								</label>
							))}
					</div>
					<div className="flex gap-2">
						<button
							type="submit"
							disabled={busy}
							className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
						>
							Save safeguards
						</button>
						<button
							type="button"
							onClick={toggleConfigure}
							disabled={busy}
							className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
						>
							Cancel
						</button>
					</div>
				</form>
			)}

			{doseOpen && (
				<form onSubmit={triggerDose} className="mt-4 grid gap-3">
					<div>
						<h4 className="font-semibold">Enter the current readings</h4>
						<p className="text-xs text-zinc-600 dark:text-zinc-400">
							At least one is required. TDS controls Solution A + B; pH controls
							pH up/down.
						</p>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="grid gap-1 text-sm">
							Measured pH (optional)
							<input
								type="number"
								min="0"
								max="14"
								step="any"
								value={ph}
								disabled={busy}
								onInput={(event) => setPh(event.currentTarget.value)}
								className={inputClass}
							/>
						</label>
						<label className="grid gap-1 text-sm">
							Measured TDS (ppm, optional)
							<input
								type="number"
								min="0"
								step="any"
								value={tds}
								disabled={busy}
								onInput={(event) => setTds(event.currentTarget.value)}
								className={inputClass}
							/>
						</label>
					</div>
					<div className="flex flex-wrap gap-2">
						<button
							type="submit"
							disabled={busy}
							className="min-h-10 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-40"
						>
							{running ? "Checking and dosing…" : "Check guardrails and dose"}
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => setDoseOpen(false)}
							className="rounded-md border border-zinc-300 px-3 text-sm disabled:opacity-40 dark:border-zinc-700"
						>
							Cancel
						</button>
					</div>
				</form>
			)}

			{error && (
				<p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
			{result && (
				<div
					role="status"
					className={`mt-3 rounded-md border-l-4 p-3 text-sm ${
						result.allowed && result.status === "completed"
							? "border-emerald-600"
							: "border-amber-500"
					}`}
				>
					{result.allowed ? (
						<p>
							{result.status === "completed"
								? `Dose completed: ${result.completed.map((role) => roleLabels[role]).join(", ")}.`
								: `Dose ${result.status}: ${result.completed.map((role) => roleLabels[role]).join(", ") || "no pumps confirmed"}${result.reason ? ` — ${result.reason}` : ""}`}
						</p>
					) : (
						<p>Dose declined — {result.reason}</p>
					)}
					{result.notes?.map((note) => (
						<p key={note} className="mt-1 text-amber-700 dark:text-amber-300">
							Not dosed: {note}
						</p>
					))}
				</div>
			)}

			{config?.history?.length > 0 && (
				<details className="mt-3">
					<summary className="cursor-pointer text-sm font-medium">
						Dose history ({config.history.length})
					</summary>
					<ul className="mt-2 grid max-h-80 gap-2 overflow-y-auto pr-1">
						{config.history
							.slice()
							.reverse()
							.slice(0, 10)
							.map((event) => {
								const outcome = eventOutcome(event);
								return (
									<li
										key={event.id}
										className={`rounded-md border p-3 text-sm ${outcomeStyles[outcome.kind]}`}
									>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<p className="text-xs text-zinc-600 dark:text-zinc-400">
												{new Date(event.timestamp).toLocaleString()} ·
												Semi-automatic
											</p>
											<span
												className={`rounded-full px-2 py-0.5 text-xs font-semibold ${outcomeBadgeStyles[outcome.kind]}`}
											>
												{outcome.label}
											</span>
										</div>
										<p className="mt-1 font-medium">
											{[
												event.measurements.ph != null &&
													`pH ${event.measurements.ph}`,
												event.measurements.tds != null &&
													`TDS ${event.measurements.tds} ppm`,
											]
												.filter(Boolean)
												.join(" · ")}
										</p>
										<p>{describeEvent(event)}</p>
										{event.pumps.length > 0 && (
											<p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
												Requested:{" "}
												{event.pumps.map((role) => roleLabels[role]).join(", ")}
											</p>
										)}
										{event.notes?.map((note) => (
											<p
												key={note}
												className="mt-1 text-xs text-amber-800 dark:text-amber-300"
											>
												Not dosed: {note}
											</p>
										))}
									</li>
								);
							})}
					</ul>
				</details>
			)}
		</section>
	);
}
