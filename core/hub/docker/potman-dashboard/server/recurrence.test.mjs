import assert from "node:assert/strict";
import test from "node:test";
import {
	matchesRecurrence,
	occurrenceKey,
	validateRecurrence,
} from "./recurrence.mjs";

test("weekly schedules use selected days and start-week intervals", () => {
	const schedule = {
		kind: "weekly",
		everyWeeks: 2,
		weekdays: [1, 3, 5],
		startDate: "2026-11-02",
		time: "09:30",
	};
	assert.equal(matchesRecurrence(schedule, new Date(2026, 10, 2, 9, 30)), true);
	assert.equal(matchesRecurrence(schedule, new Date(2026, 10, 4, 9, 30)), true);
	assert.equal(
		matchesRecurrence(schedule, new Date(2026, 10, 9, 9, 30)),
		false,
	);
	assert.equal(
		matchesRecurrence(schedule, new Date(2026, 10, 16, 9, 30)),
		true,
	);
	assert.equal(
		matchesRecurrence(schedule, new Date(2026, 10, 16, 9, 31)),
		false,
	);
});

test("monthly schedules use the last day when the chosen day is absent", () => {
	const schedule = {
		kind: "monthly",
		day: 31,
		startDate: "2026-01-01",
		time: "10:00",
	};
	assert.equal(matchesRecurrence(schedule, new Date(2026, 1, 28, 10, 0)), true);
	assert.equal(matchesRecurrence(schedule, new Date(2028, 1, 29, 10, 0)), true);
	assert.equal(
		matchesRecurrence(schedule, new Date(2026, 2, 30, 10, 0)),
		false,
	);
	assert.equal(matchesRecurrence(schedule, new Date(2026, 2, 31, 10, 0)), true);
});

test("recurrence validation rejects invalid dates, times and weekdays", () => {
	assert.throws(() =>
		validateRecurrence({
			kind: "monthly",
			day: 31,
			startDate: "2026-02-30",
			time: "10:00",
		}),
	);
	assert.throws(() =>
		validateRecurrence({
			kind: "weekly",
			everyWeeks: 1,
			weekdays: [],
			startDate: "2026-01-01",
			time: "10:00",
		}),
	);
	assert.throws(() =>
		validateRecurrence({
			kind: "monthly",
			day: 1,
			startDate: "2026-01-01",
			time: "24:00",
		}),
	);
	assert.equal(occurrenceKey(new Date(2026, 10, 7, 9, 5)), "2026-11-07T09:05");
});
