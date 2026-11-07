import { useState } from "react";
import {
	decideSemiAutomatic,
	validateDoseConfig,
} from "../../server/dose-decision.mjs";

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

export default function SemiAutomatic({ system, saving, onSave }) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(() => configToDraft(system.semiAutomatic));
	const [ph, setPh] = useState("");
	const [tds, setTds] = useState("");
	const [result, setResult] = useState(null);
	const [error, setError] = useState(null);

	async function saveConfig(event) {
		event.preventDefault();
		const config = {
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
			validateDoseConfig(config);
		} catch (validationError) {
			setError(`${validationError.message}. Check all fields and ranges.`);
			return;
		}
		setError(null);
		setResult(null);
		await onSave(config);
	}

	function checkReadings(event) {
		event.preventDefault();
		setResult(null);
		try {
			const decision = decideSemiAutomatic(
				system.semiAutomatic,
				{ ph: parseNumber(ph), tds: parseNumber(tds) },
				0,
			);
			setResult(decision);
			setError(null);
		} catch (validationError) {
			setError(validationError.message);
		}
	}

	return (
		<section className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-800">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700"
			>
				Semi-automatic dosing
			</button>
			{open && (
				<div className="mt-4 grid gap-4">
					<p className="border-l-2 border-amber-500 pl-3 text-sm" role="status">
						Dosing is not available yet. The fields below save settings and
						check readings only; they do not activate pumps or enforce daily
						limits. SSR ON indicates the relay state, not measured water flow.
					</p>
					<form onSubmit={saveConfig} className="grid gap-3">
						<h3 className="font-semibold">Dosing configuration</h3>
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
										disabled={saving}
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
							disabled={saving}
							className="w-fit rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
						>
							Save dosing configuration
						</button>
					</form>
					<form onSubmit={checkReadings} className="grid gap-3">
						<h3 className="font-semibold">Check measured values</h3>
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
									onInput={(event) => {
										setPh(event.currentTarget.value);
										setResult(null);
									}}
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
									onInput={(event) => {
										setTds(event.currentTarget.value);
										setResult(null);
									}}
									className="min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
								/>
							</label>
						</div>
						<button
							type="submit"
							disabled={!system.semiAutomatic}
							className="w-fit rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700"
						>
							Check readings
						</button>
						{result && (
							<p role="status" className="text-sm">
								{result.allowed
									? `Preliminary selection: ${result.pumps.join(", ")}. No pumps were activated.`
									: result.reason}
							</p>
						)}
					</form>
					{error && (
						<p role="alert" className="text-sm text-red-600 dark:text-red-400">
							{error}
						</p>
					)}
				</div>
			)}
		</section>
	);
}
