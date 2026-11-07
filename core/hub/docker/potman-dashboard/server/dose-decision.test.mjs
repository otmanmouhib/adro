import assert from "node:assert/strict";
import test from "node:test";
import { decideSemiAutomatic, validateDoseConfig } from "./dose-decision.mjs";

const config = {
	phMin: 5.5,
	phMax: 6.5,
	tdsMin: 450,
	tdsMax: 800,
	maxDosesPerDay: 3,
	mixingSeconds: 10,
	doses: { solutionA: 5, solutionB: 5, phDown: 5 },
};

test("readings select paired nutrients and pH down", () => {
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

test("unsafe readings and insufficient remaining activations block the whole sequence", () => {
	assert.equal(
		decideSemiAutomatic(config, { ph: 5, tds: 400 }, 0).allowed,
		false,
	);
	assert.equal(
		decideSemiAutomatic(config, { ph: 7, tds: 900 }, 0).allowed,
		false,
	);
	assert.equal(
		decideSemiAutomatic(config, { ph: 7, tds: 400 }, 1).allowed,
		false,
	);
	assert.throws(() => decideSemiAutomatic(config, { ph: NaN, tds: 400 }, 0));
	assert.throws(() => validateDoseConfig({ ...config, mixingSeconds: 31 }));
	assert.throws(() =>
		validateDoseConfig({ ...config, doses: { ...config.doses, phDown: 0 } }),
	);
});

test("A+B-only and pH-down-only systems can each dose on their own", () => {
	const nutrientsOnly = { nutrients: true, phDown: false };
	const phOnly = { nutrients: false, phDown: true };
	const low = { ph: 6, tds: 400 };
	const high = { ph: 7, tds: 600 };

	assert.deepEqual(decideSemiAutomatic(config, low, 0, nutrientsOnly).pumps, [
		"solutionA",
		"solutionB",
	]);
	assert.deepEqual(decideSemiAutomatic(config, high, 0, phOnly).pumps, [
		"phDown",
	]);

	const both = { ph: 7, tds: 400 };
	const partial = decideSemiAutomatic(config, both, 0, nutrientsOnly);
	assert.equal(partial.allowed, true);
	assert.deepEqual(partial.pumps, ["solutionA", "solutionB"]);
	assert.match(partial.notes[0], /no pH down pump/);
});

test("declines explain missing pumps, missing volumes and the daily limit", () => {
	const none = { nutrients: false, phDown: false };
	const declined = decideSemiAutomatic(config, { ph: 7, tds: 400 }, 0, none);
	assert.equal(declined.allowed, false);
	assert.match(declined.reason, /Solution A and B are not both assigned/);
	assert.match(declined.reason, /no pH down pump/);

	const phConfig = { ...config, doses: { phDown: 5 } };
	const missingVolume = decideSemiAutomatic(phConfig, { ph: 6, tds: 400 }, 0);
	assert.match(
		missingVolume.reason,
		/dose volume for Solution A and Solution B/,
	);

	const limited = decideSemiAutomatic(config, { ph: 7, tds: 400 }, 1);
	assert.match(limited.reason, /Daily limit reached: 1 of 3/);
	assert.match(
		decideSemiAutomatic(config, { ph: 6, tds: 600 }, 0).reason,
		/within the configured ranges/,
	);
});

test("only the pumps a system uses need a dose volume", () => {
	validateDoseConfig({ ...config, doses: { phDown: 5 } });
	assert.throws(() => validateDoseConfig({ ...config, doses: {} }));
	assert.throws(() =>
		validateDoseConfig({ ...config, doses: { phDown: 5, solutionA: 80 } }),
	);
});
