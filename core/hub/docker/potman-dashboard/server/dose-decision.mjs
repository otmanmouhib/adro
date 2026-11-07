function inRange(value, min, max) {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max
	);
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
		!["solutionA", "solutionB", "phDown"].every((role) =>
			inRange(config.doses[role], 5, 50),
		)
	)
		throw new Error("Invalid semi-automatic dosing configuration");
}

export function decideSemiAutomatic(config, measurements, dosesToday) {
	validateDoseConfig(config);
	if (
		!measurements ||
		!inRange(measurements.ph, 0, 14) ||
		!inRange(measurements.tds, 0, Number.MAX_SAFE_INTEGER)
	)
		throw new Error("Enter valid pH and TDS readings");
	if (!Number.isSafeInteger(dosesToday) || dosesToday < 0)
		throw new Error("Invalid daily dose count");
	if (measurements.ph < config.phMin || measurements.tds > config.tdsMax)
		return {
			allowed: false,
			reason: "pH is below the minimum or TDS is above the maximum",
			pumps: [],
		};
	const pumps = [];
	if (measurements.tds < config.tdsMin) pumps.push("solutionA", "solutionB");
	if (measurements.ph > config.phMax) pumps.push("phDown");
	if (!pumps.length)
		return {
			allowed: false,
			reason: "Readings are within the configured ranges",
			pumps,
		};
	if (dosesToday + pumps.length > config.maxDosesPerDay)
		return {
			allowed: false,
			reason: "Daily pump activation limit would be exceeded",
			pumps: [],
		};
	return { allowed: true, reason: null, pumps };
}
