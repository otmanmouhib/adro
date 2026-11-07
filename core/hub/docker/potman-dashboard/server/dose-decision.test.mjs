import assert from "node:assert/strict";
import test from "node:test";
import { decideSemiAutomatic } from "./dose-decision.mjs";

const config = {
	phMin: 5.5,
	phMax: 6.5,
	tdsMin: 450,
	tdsMax: 800,
	maxDosesPerDay: 3,
};

test("semi-automatic rules choose paired nutrients and pH down independently", () => {
	assert.deepEqual(decideSemiAutomatic(config, { ph: 7, tds: 400 }, 0).pumps, [
		"solutionA",
		"solutionB",
		"phDown",
	]);
	assert.deepEqual(decideSemiAutomatic(config, { ph: 6, tds: 400 }, 0).pumps, [
		"solutionA",
		"solutionB",
	]);
	assert.deepEqual(decideSemiAutomatic(config, { ph: 7, tds: 600 }, 0).pumps, [
		"phDown",
	]);
	assert.equal(
		decideSemiAutomatic(config, { ph: 6, tds: 600 }, 0).allowed,
		false,
	);
});

test("unsafe measurements and the daily limit block all dosing", () => {
	assert.equal(
		decideSemiAutomatic(config, { ph: 5, tds: 400 }, 0).allowed,
		false,
	);
	assert.equal(
		decideSemiAutomatic(config, { ph: 7, tds: 900 }, 0).allowed,
		false,
	);
	assert.equal(
		decideSemiAutomatic(config, { ph: 7, tds: 400 }, 3).allowed,
		false,
	);
	assert.throws(() => decideSemiAutomatic(config, { ph: NaN, tds: 400 }, 0));
	assert.throws(() =>
		decideSemiAutomatic({ ...config, tdsMin: 800 }, { ph: 7, tds: 400 }, 0),
	);
});
