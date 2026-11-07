import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";

const dataFile = process.env.ADRO_SYSTEMS_FILE || "/data/systems.json";
const port = Number(process.env.PORT || 3001);
const roles = {
	circulationPump: { type: "switch", maxChannel: 4 },
	feedPump: { type: "switch", maxChannel: 4 },
	solutionA: { type: "dosing", maxChannel: 2 },
	solutionB: { type: "dosing", maxChannel: 2 },
};

function validateSystems(systems) {
	if (!Array.isArray(systems)) throw new Error("Systems must be a list");
	const ids = new Set();
	const assigned = new Set();
	for (const system of systems) {
		if (
			!system ||
			typeof system.id !== "string" ||
			!/^[a-zA-Z0-9-]{1,80}$/.test(system.id) ||
			ids.has(system.id) ||
			system.architecture !== "standalone" ||
			typeof system.name !== "string" ||
			!system.name.trim() ||
			system.name.length > 100 ||
			!system.assignments ||
			typeof system.assignments !== "object" ||
			Array.isArray(system.assignments)
		) {
			throw new Error("Invalid system configuration");
		}
		ids.add(system.id);
		for (const [role, assignment] of Object.entries(system.assignments)) {
			const rule = Object.hasOwn(roles, role) ? roles[role] : null;
			if (
				!rule ||
				!assignment ||
				assignment.type !== rule.type ||
				typeof assignment.mac !== "string" ||
				!/^[a-fA-F0-9:.-]{6,32}$/.test(assignment.mac) ||
				!Number.isInteger(assignment.channel) ||
				assignment.channel < 1 ||
				assignment.channel > rule.maxChannel
			) {
				throw new Error(`Invalid assignment for ${role}`);
			}
			const key = `${assignment.type}:${assignment.mac.replace(/[:-]/g, "").toLowerCase()}:${assignment.channel}`;
			if (assigned.has(key))
				throw new Error("A device channel can only be assigned once");
			assigned.add(key);
		}
	}
}

async function loadState() {
	let contents;
	try {
		contents = await readFile(dataFile, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return { revision: 0, systems: [] };
		throw error;
	}
	const state = JSON.parse(contents);
	if (!Number.isSafeInteger(state.revision) || state.revision < 0)
		throw new Error("Invalid saved revision");
	validateSystems(state.systems);
	return state;
}

function send(response, status, body) {
	response.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
	});
	response.end(JSON.stringify(body));
}

async function readJson(request) {
	let body = "";
	for await (const chunk of request) {
		body += chunk;
		if (body.length > 100_000) throw new Error("Request too large");
	}
	return JSON.parse(body);
}

let state = await loadState();
let writes = Promise.resolve();
const server = createServer(async (request, response) => {
	if (request.url !== "/api/systems")
		return send(response, 404, { error: "Not found" });
	if (request.method === "GET") return send(response, 200, state);
	if (request.method !== "PUT")
		return send(response, 405, { error: "Method not allowed" });
	if (!request.headers["content-type"]?.startsWith("application/json")) {
		return send(response, 415, {
			error: "Content-Type must be application/json",
		});
	}
	const origin = request.headers.origin;
	if (origin) {
		try {
			if (new URL(origin).host !== request.headers.host) {
				return send(response, 403, {
					error: "Cross-origin requests are not allowed",
				});
			}
		} catch {
			return send(response, 403, { error: "Invalid request origin" });
		}
	}
	let input;
	try {
		input = await readJson(request);
		validateSystems(input.systems);
		if (!Number.isSafeInteger(input.revision) || input.revision < 0)
			throw new Error("Invalid revision");
	} catch (error) {
		return send(response, 400, { error: error.message });
	}
	const write = writes.then(async () => {
		if (input.revision !== state.revision) {
			return send(response, 409, {
				error: "Systems changed in another session. Reload and try again.",
			});
		}
		const next = { revision: state.revision + 1, systems: input.systems };
		await mkdir(dirname(dataFile), { recursive: true });
		const temporary = join(dirname(dataFile), `.systems-${process.pid}.tmp`);
		await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
		await rename(temporary, dataFile);
		state = next;
		send(response, 200, state);
	});
	writes = write.catch((error) => {
		console.error("Could not save systems:", error);
		send(response, 500, { error: "Could not save systems on the hub" });
	});
});

server.listen(port, "0.0.0.0", () =>
	console.log(`Systems API listening on ${server.address().port}`),
);
