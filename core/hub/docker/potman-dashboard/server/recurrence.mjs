function calendarDate(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error("Start date must be a date in YYYY-MM-DD format");
	}
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		year < 1970 ||
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		throw new Error("Invalid start date");
	}
	return date;
}

export function validateRecurrence(recurrence) {
	if (!recurrence || typeof recurrence !== "object") {
		throw new Error("A recurrence is required");
	}
	calendarDate(recurrence.startDate);
	if (
		typeof recurrence.time !== "string" ||
		!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(recurrence.time)
	) {
		throw new Error("Time must be in HH:MM format");
	}
	if (recurrence.kind === "weekly") {
		if (
			!Number.isInteger(recurrence.everyWeeks) ||
			recurrence.everyWeeks < 1 ||
			recurrence.everyWeeks > 52 ||
			!Array.isArray(recurrence.weekdays) ||
			recurrence.weekdays.length === 0 ||
			recurrence.weekdays.some(
				(day) => !Number.isInteger(day) || day < 0 || day > 6,
			) ||
			new Set(recurrence.weekdays).size !== recurrence.weekdays.length
		) {
			throw new Error("Invalid weekly recurrence");
		}
	} else if (recurrence.kind === "monthly") {
		if (
			!Number.isInteger(recurrence.day) ||
			recurrence.day < 1 ||
			recurrence.day > 31
		) {
			throw new Error("Monthly day must be between 1 and 31");
		}
	} else {
		throw new Error("Unsupported recurrence");
	}
}

export function matchesRecurrence(recurrence, localTime) {
	validateRecurrence(recurrence);
	if (!(localTime instanceof Date) || !Number.isFinite(localTime.getTime())) {
		throw new Error("Invalid date");
	}
	const [hour, minute] = recurrence.time.split(":").map(Number);
	if (localTime.getHours() !== hour || localTime.getMinutes() !== minute)
		return false;
	const date = new Date(
		Date.UTC(
			localTime.getFullYear(),
			localTime.getMonth(),
			localTime.getDate(),
		),
	);
	const start = calendarDate(recurrence.startDate);
	if (date < start) return false;
	if (recurrence.kind === "monthly") {
		const lastDay = new Date(
			Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
		).getUTCDate();
		return date.getUTCDate() === Math.min(recurrence.day, lastDay);
	}
	const mondayOffset = (start.getUTCDay() + 6) % 7;
	const startMonday = start.getTime() - mondayOffset * 86400000;
	const week = Math.floor((date.getTime() - startMonday) / (7 * 86400000));
	return (
		week % recurrence.everyWeeks === 0 &&
		recurrence.weekdays.includes(date.getUTCDay())
	);
}

export function occurrenceKey(localTime) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${localTime.getFullYear()}-${pad(localTime.getMonth() + 1)}-${pad(localTime.getDate())}T${pad(localTime.getHours())}:${pad(localTime.getMinutes())}`;
}
