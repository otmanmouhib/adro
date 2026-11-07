const DOSE_ROLES = ["solutionA", "solutionB", "phDown"];

export const roleLabels = {
	solutionA: "Solution A",
	solutionB: "Solution B",
	phDown: "pH down",
};

function inRange(value, min, max) {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max
	);
}

// Nutrients are always dosed as an A+B pair; pH down is independent.
export function doseAvailability(system) {
	const assignments = system?.assignments || {};
	return {
		nutrients: Boolean(assignments.solutionA && assignments.solutionB),
		phDown: Boolean(assignments.phDown),
	};
}

export function validateDoseConfig(config) {
	if (
		!config ||
		!inRange(config.phMin, 0, 14) ||
		!inRange(config.phMax, 0, 14) ||
		config.phMin >= config.phMax ||
		!inRange(config.tdsMin, 0, Number.MAX_SAFE_INTEGER) ||
		!inRange(config.tdsMax, 0, Number.MAX_SAFE_INTEGER) ||
		config.tdsMin >= config.tdsMax ||
		!Number.isSafeInteger(config.maxDosesPerDay) ||
		config.maxDosesPerDay < 1 ||
		!inRange(config.mixingSeconds, 5, 30) ||
		!config.doses ||
		typeof config.doses !== "object" ||
		Array.isArray(config.doses) ||
		!DOSE_ROLES.some((role) => config.doses[role] !== undefined) ||
		DOSE_ROLES.some(
			(role) =>
				config.doses[role] !== undefined && !inRange(config.doses[role], 5, 50),
		)
	)
		throw new Error("Invalid semi-automatic dosing configuration");
}

function decline(reason, notes = []) {
	return { allowed: false, reason, pumps: [], notes };
}

export function decideSemiAutomatic(
	config,
	measurements,
	dosesToday,
	available = { nutrients: true, phDown: true },
) {
	validateDoseConfig(config);
	if (
		!measurements ||
		!inRange(measurements.ph, 0, 14) ||
		!inRange(measurements.tds, 0, Number.MAX_SAFE_INTEGER)
	)
		throw new Error("Enter valid pH and TDS readings");
	if (!Number.isSafeInteger(dosesToday) || dosesToday < 0)
		throw new Error("Invalid daily dose count");

	const { ph, tds } = measurements;
	if (ph < config.phMin)
		return decline(
			`pH ${ph} is below the safe minimum of ${config.phMin}. No dose was given.`,
		);
	if (tds > config.tdsMax)
		return decline(
			`TDS ${tds} ppm is above the safe maximum of ${config.tdsMax} ppm. No dose was given.`,
		);

	const pumps = [];
	const notes = [];
	if (tds < config.tdsMin) {
		if (available.nutrients) pumps.push("solutionA", "solutionB");
		else
			notes.push(
				`TDS ${tds} ppm is below ${config.tdsMin} ppm, but Solution A and B are not both assigned to this system.`,
			);
	}
	if (ph > config.phMax) {
		if (available.phDown) pumps.push("phDown");
		else
			notes.push(
				`pH ${ph} is above ${config.phMax}, but no pH down pump is assigned to this system.`,
			);
	}

	if (!pumps.length)
		return decline(
			notes.length
				? notes.join(" ")
				: "Readings are within the configured ranges; no dose is needed.",
			notes,
		);

	const missing = pumps.filter((role) => config.doses[role] === undefined);
	if (missing.length)
		return decline(
			`Set the dose volume for ${missing.map((role) => roleLabels[role]).join(" and ")} in the safeguards first.`,
			notes,
		);

	if (dosesToday + pumps.length > config.maxDosesPerDay)
		return decline(
			`Daily limit reached: ${dosesToday} of ${config.maxDosesPerDay} pump activations used today and this dose needs ${pumps.length}.`,
			notes,
		);

	return { allowed: true, reason: null, pumps, notes };
}
