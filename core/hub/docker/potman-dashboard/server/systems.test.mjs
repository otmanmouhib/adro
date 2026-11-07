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
	const race = await Promise.all([
		put(url, 1, [{ ...tower, name: "First" }]),
		put(url, 1, [{ ...tower, name: "Second" }]),
	]);
	assert.deepEqual(race.map((response) => response.status).sort(), [200, 409]);
	const saved = await (await fetch(url)).json();
	assert.equal(saved.revision, 2);
	process.kill("SIGTERM");
	await once(process, "exit");
	url = await start();
	assert.deepEqual(await (await fetch(url)).json(), saved);
});
