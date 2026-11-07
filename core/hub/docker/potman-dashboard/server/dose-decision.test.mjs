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
