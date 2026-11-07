function numberInRange(value, min, max) {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max
	);
}

export function decideSemiAutomatic(config, measurements, dosesToday) {
	if (
		!config ||
		!numberInRange(config.phMin, 0, 14) ||
		!numberInRange(config.phMax, 0, 14) ||
		config.phMin >= config.phMax ||
		!numberInRange(config.tdsMin, 0, Number.MAX_SAFE_INTEGER) ||
		!numberInRange(config.tdsMax, 0, Number.MAX_SAFE_INTEGER) ||
		config.tdsMin >= config.tdsMax ||
		!Number.isInteger(config.maxDosesPerDay) ||
		config.maxDosesPerDay < 1 ||
		!Number.isInteger(dosesToday) ||
		dosesToday < 0
	) {
		throw new Error("Invalid semi-automatic configuration");
	}
	if (
		!measurements ||
		!numberInRange(measurements.ph, 0, 14) ||
		!numberInRange(measurements.tds, 0, Number.MAX_SAFE_INTEGER)
	) {
		throw new Error("Enter valid pH and TDS readings");
	}
	if (dosesToday >= config.maxDosesPerDay) {
		return {
			allowed: false,
			reason: "Daily semi-automatic dose limit reached",
			pumps: [],
		};
	}
	if (measurements.ph < config.phMin || measurements.tds > config.tdsMax) {
		return {
			allowed: false,
			reason: "pH is below the minimum or TDS is above the maximum",
			pumps: [],
		};
	}
	const pumps = [];
	if (measurements.tds < config.tdsMin) pumps.push("solutionA", "solutionB");
	if (measurements.ph > config.phMax) pumps.push("phDown");
	if (!pumps.length) {
		return {
			allowed: false,
			reason: "Readings are within the configured ranges",
			pumps,
		};
	}
	return { allowed: true, reason: null, pumps };
}
