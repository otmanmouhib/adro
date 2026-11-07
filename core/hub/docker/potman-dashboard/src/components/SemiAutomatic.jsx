import { useState } from "react";
import { validateDoseConfig } from "../../server/dose-decision.mjs";

const fields = [
	["phMin", "Minimum pH", "0", "14", "0.01"],
	["phMax", "Maximum pH", "0", "14", "0.01"],
	["tdsMin", "Minimum TDS (ppm)", "0", undefined, "1"],
	["tdsMax", "Maximum TDS (ppm)", "0", undefined, "1"],
	["maxDosesPerDay", "Maximum pump activations per day", "1", undefined, "1"],
	["mixingSeconds", "Mixing delay between pumps (seconds)", "5", "30", "1"],
	["solutionA", "Solution A per activation (mL)", "5", "50", "0.1"],
	["solutionB", "Solution B per activation (mL)", "5", "50", "0.1"],
	["phDown", "pH down per activation (mL)", "5", "50", "0.1"],
];

function configToDraft(config) {
	return Object.fromEntries(
		fields.map(([key]) => [
			key,
			String(config?.doses?.[key] ?? config?.[key] ?? ""),
		]),
	);
}

function parseNumber(value) {
	return value.trim() === "" ? Number.NaN : Number(value);
}

function statusLabel(event) {
	if (!event.allowed) return `Declined: ${event.reason}`;
	const completed = event.completed?.length
		? ` · completed ${event.completed.join(", ")}`
		: "";
	return `${event.status}${completed}${event.reason ? ` · ${event.reason}` : ""}`;
}

export default function SemiAutomatic({ system, saving, onSave, onRun }) {
	const [configureOpen, setConfigureOpen] = useState(!system.semiAutomatic);
	const [doseOpen, setDoseOpen] = useState(false);
	const [draft, setDraft] = useState(() => configToDraft(system.semiAutomatic));
	const [ph, setPh] = useState("");
	const [tds, setTds] = useState("");
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState(null);
	const [error, setError] = useState(null);
	const config = system.semiAutomatic;
	const busy = saving || running;

	async function saveConfig(event) {
		event.preventDefault();
		const nextConfig = {
			phMin: parseNumber(draft.phMin),
			phMax: parseNumber(draft.phMax),
			tdsMin: parseNumber(draft.tdsMin),
			tdsMax: parseNumber(draft.tdsMax),
			maxDosesPerDay: parseNumber(draft.maxDosesPerDay),
			mixingSeconds: parseNumber(draft.mixingSeconds),
			doses: {
				solutionA: parseNumber(draft.solutionA),
				solutionB: parseNumber(draft.solutionB),
				phDown: parseNumber(draft.phDown),
			},
		};
		try {
			validateDoseConfig(nextConfig);
		} catch (validationError) {
			setError(`${validationError.message}. Check all fields and ranges.`);
			return;
		}
		setError(null);
		if (await onSave(nextConfig)) {
			setDraft(configToDraft(nextConfig));
			setConfigureOpen(false);
		}
	}

	async function triggerDose(event) {
		event.preventDefault();
		setResult(null);
		setError(null);
		setRunning(true);
		try {
			const outcome = await onRun({
				ph: parseNumber(ph),
				tds: parseNumber(tds),
			});
			setResult(outcome);
			setDoseOpen(false);
		} catch (runError) {
			setError(runError.message || "Semi-automatic dose request failed");
		} finally {
			setRunning(false);
		}
	}

	return (
		<section className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-800">
			<header className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h3 className="text-lg font-semibold">Semi-automatic dosing</h3>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => setConfigureOpen(!configureOpen)}
						aria-expanded={configureOpen}
						className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
					>
						{config ? "Configure safeguards" : "Set up safeguards"}
					</button>
					<button
						type="button"
						onClick={() => {
							setDoseOpen(!doseOpen);
							setResult(null);
						}}
						aria-expanded={doseOpen}
						disabled={!config || busy}
						className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
					>
						Semi-auto dose
					</button>
				</div>
			</header>

			<p className="mb-4 border-l-2 border-amber-500 pl-3 text-sm">
				Circulation is checked using the assigned SSR's reported ON state; it
				does not measure water flow. Dosing pumps must report firmware 1.0.14 or
				newer and confirm each dose.
			</p>

			{configureOpen && (
				<form onSubmit={saveConfig} className="mb-5 grid gap-3">
					<h4 className="font-semibold">
						One-time guardrails and dose settings
					</h4>
					<div className="grid gap-3 sm:grid-cols-2">
						{fields.map(([key, label, min, max, step]) => (
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
									className="min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
								/>
							</label>
						))}
					</div>
					<button
						type="submit"
						disabled={busy}
						className="w-fit rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
					>
						Save safeguards
					</button>
				</form>
			)}

			{doseOpen && (
				<form onSubmit={triggerDose} className="mb-5 grid gap-3">
					<h4 className="font-semibold">Enter current solution readings</h4>
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="grid gap-1 text-sm">
							Measured pH
							<input
								type="number"
								min="0"
								max="14"
								step="any"
								required
								value={ph}
								disabled={busy}
								onInput={(event) => setPh(event.currentTarget.value)}
								className="min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
							/>
						</label>
						<label className="grid gap-1 text-sm">
							Measured TDS (ppm)
							<input
								type="number"
								min="0"
								step="any"
								required
								value={tds}
								disabled={busy}
								onInput={(event) => setTds(event.currentTarget.value)}
								className="min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
							/>
						</label>
					</div>
					<div className="flex flex-wrap gap-2">
						<button
							type="submit"
							disabled={busy}
							className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
						>
							{running ? "Checking and dosing…" : "Check guardrails and dose"}
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => setDoseOpen(false)}
							className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-zinc-700"
						>
							Cancel
						</button>
					</div>
				</form>
			)}

			{error && (
				<p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
			{result && (
				<p
					role="status"
					className={`mb-3 text-sm ${result.status === "completed" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}
				>
					{result.allowed
						? result.status === "completed"
							? `Dose completed: ${result.completed.join(", ")}.`
							: `Dose ${result.status}: ${result.completed.join(", ") || "no pumps confirmed"}${result.reason ? ` — ${result.reason}` : ""}`
						: `Dose declined: ${result.reason}`}
				</p>
			)}

			{config?.history?.length > 0 && (
				<details className="mt-4">
					<summary className="cursor-pointer text-sm font-medium">
						Semi-automatic dose log ({config.history.length})
					</summary>
					<ul className="mt-2 grid gap-2">
						{config.history
							.slice()
							.reverse()
							.slice(0, 10)
							.map((event) => (
								<li
									key={event.id}
									className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
								>
									<p className="font-medium">
										{new Date(event.timestamp).toLocaleString()} ·{" "}
										{event.type === "semi-automatic"
											? "Semi-automatic"
											: event.type}
									</p>
									<p>
										pH {event.measurements.ph}, TDS {event.measurements.tds} ppm
										{" · "}
										{statusLabel(event)}
									</p>
									{event.pumps.length > 0 && (
										<p>Requested: {event.pumps.join(", ")}</p>
									)}
								</li>
							))}
					</ul>
				</details>
			)}
		</section>
	);
}
