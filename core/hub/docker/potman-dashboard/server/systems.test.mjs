import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

test("systems persist, reject duplicate channels and protect concurrent edits", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "adro-systems-test-"));
	let process;
	t.after(async () => {
		if (process && process.exitCode === null) {
			process.kill("SIGTERM");
			await once(process, "exit");
		}
		await rm(directory, { recursive: true, force: true });
	});

	async function start() {
		process = spawn(globalThis.process.execPath, ["server/systems.mjs"], {
			env: {
				...globalThis.process.env,
				PORT: "0",
				ADRO_SYSTEMS_FILE: join(directory, "systems.json"),
			},
			stdio: ["ignore", "pipe", "inherit"],
		});
		const lines = createInterface({ input: process.stdout });
		const [line] = await once(lines, "line");
		const port = Number(line.match(/(\d+)$/)?.[1]);
		assert.ok(port);
		return `http://127.0.0.1:${port}/api/systems`;
	}
	async function put(url, revision, systems) {
		return fetch(url, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ revision, systems }),
		});
	}

	let url = await start();
	assert.deepEqual(await (await fetch(url)).json(), {
		revision: 0,
		systems: [],
	});
	const tower = {
		id: "tower-1",
		name: "Tower 1",
		architecture: "standalone",
		assignments: {
			circulationPump: { type: "switch", mac: "AA:BB:CC:DD:EE:FF", channel: 1 },
			solutionA: { type: "dosing", mac: "11:22:33:44:55:66", channel: 1 },
			solutionB: { type: "dosing", mac: "11:22:33:44:55:66", channel: 2 },
			phUp: { type: "dosing", mac: "11:22:33:44:55:66", channel: 4 },
			phDown: { type: "dosing", mac: "11:22:33:44:55:77", channel: 1 },
		},
	};
	assert.equal((await put(url, 0, [tower])).status, 200);
	const duplicate = {
		...tower,
		id: "tower-2",
		assignments: {
			feedPump: { type: "switch", mac: "aabbccddeeff", channel: 1 },
		},
	};
	const invalid = await put(url, 1, [tower, duplicate]);
	assert.equal(invalid.status, 400);
	assert.match((await invalid.json()).error, /only be assigned once/);
	const duplicatePump = {
		...tower,
		assignments: { ...tower.assignments, phDown: tower.assignments.solutionA },
	};
	assert.equal((await put(url, 1, [duplicatePump])).status, 400);
	const race = await Promise.all([
		put(url, 1, [{ ...tower, name: "First" }]),
		put(url, 1, [{ ...tower, name: "Second" }]),
	]);
	assert.deepEqual(race.map((response) => response.status).sort(), [200, 409]);
	const saved = await (await fetch(url)).json();
	assert.equal(saved.revision, 2);
	const settings = {
		phMin: 5.5,
		phMax: 6.5,
		tdsMin: 450,
		tdsMax: 800,
		maxDosesPerDay: 3,
		mixingSeconds: 10,
		doses: { solutionA: 5, solutionB: 6, phDown: 7 },
	};
	const invalidSettings = await put(url, 2, [
		{ ...saved.systems[0], semiAutomatic: { ...settings, mixingSeconds: 31 } },
	]);
	assert.equal(invalidSettings.status, 400);
	assert.equal(
		(await put(url, 2, [{ ...saved.systems[0], semiAutomatic: settings }]))
			.status,
		200,
	);
	const withSettings = await (await fetch(url)).json();
	const semiAutomaticUrl = `${url}/tower-1/semi-automatic`;
	const emptyDose = await fetch(semiAutomaticUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ measurements: {} }),
	});
	assert.equal(emptyDose.status, 400);
	assert.match((await emptyDose.json()).error, /at least one/);
	const dose = await fetch(semiAutomaticUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ measurements: { tds: 400 } }),
	});
	assert.equal(dose.status, 200);
	const doseEvent = await dose.json();
	assert.equal(doseEvent.allowed, true);
	assert.deepEqual(doseEvent.pumps, ["solutionA", "solutionB"]);
	assert.deepEqual(doseEvent.measurements, { tds: 400 });
	const completed = await fetch(`${semiAutomaticUrl}/${doseEvent.id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			status: "completed",
			attempted: ["solutionA", "solutionB"],
			completed: ["solutionA", "solutionB"],
		}),
	});
	assert.equal(completed.status, 200);
	const reservedDose = await fetch(semiAutomaticUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ measurements: { ph: 7 } }),
	});
	const reservedEvent = await reservedDose.json();
	assert.equal(reservedEvent.allowed, true);
	assert.deepEqual(reservedEvent.pumps, ["phDown"]);
	assert.deepEqual(reservedEvent.measurements, { ph: 7 });
	const notAttempted = await fetch(`${semiAutomaticUrl}/${reservedEvent.id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			status: "failed",
			attempted: [],
			completed: [],
			reason: "Device became unavailable before starting",
		}),
	});
	assert.equal(notAttempted.status, 200);
	const limitedDose = await fetch(semiAutomaticUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ measurements: { ph: 6, tds: 400 } }),
	});
	const limitedEvent = await limitedDose.json();
	assert.equal(limitedEvent.allowed, false);
	assert.match(limitedEvent.reason, /daily limit reached/i);
	const withDoseLog = await (await fetch(url)).json();
	assert.equal(withDoseLog.systems[0].semiAutomatic.history.length, 3);
	assert.equal(
		withDoseLog.systems[0].semiAutomatic.dailyUsage[doseEvent.date],
		2,
	);
	process.kill("SIGTERM");
	await once(process, "exit");
	url = await start();
	assert.notDeepEqual(withDoseLog, withSettings);
	assert.deepEqual(await (await fetch(url)).json(), withDoseLog);
});
