import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import {
	decideSemiAutomatic,
	doseAvailability,
	validateDoseConfig,
} from "./dose-decision.mjs";

const dataFile = process.env.ADRO_SYSTEMS_FILE || "/data/systems.json";
const port = Number(process.env.PORT || 3001);
const roles = {
	circulationPump: { type: "switch", maxChannel: 4 },
	feedPump: { type: "switch", maxChannel: 4 },
	solutionA: { type: "dosing", maxChannel: 4 },
	solutionB: { type: "dosing", maxChannel: 4 },
	phDown: { type: "dosing", maxChannel: 4 },
	phUp: { type: "dosing", maxChannel: 4 },
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
		if (system.semiAutomatic != null) validateDoseConfig(system.semiAutomatic);
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

function dateKey(date = new Date()) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function writeState(next) {
	await mkdir(dirname(dataFile), { recursive: true });
	const temporary = join(dirname(dataFile), `.systems-${process.pid}.tmp`);
	await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
	await rename(temporary, dataFile);
	state = next;
}

let state = await loadState();
let writes = Promise.resolve();
const server = createServer(async (request, response) => {
	const semiMatch = request.url.match(
		/^\/api\/systems\/([a-zA-Z0-9-]{1,80})\/semi-automatic(?:\/([a-f0-9-]{1,80}))?$/,
	);
	if (request.url !== "/api/systems" && !semiMatch)
		return send(response, 404, { error: "Not found" });
	if (request.method === "GET") return send(response, 200, state);
	if (
		request.method !== "PUT" &&
		request.method !== "POST" &&
		request.method !== "PATCH"
	)
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
		if (semiMatch && request.method === "POST") {
			if (semiMatch[2]) return send(response, 404, { error: "Not found" });
			if (
				!Number.isFinite(input.measurements?.ph) ||
				input.measurements.ph < 0 ||
				input.measurements.ph > 14 ||
				!Number.isFinite(input.measurements?.tds) ||
				input.measurements.tds < 0 ||
				input.measurements.tds > Number.MAX_SAFE_INTEGER
			)
				throw new Error("Enter a pH reading from 0 to 14 and non-negative TDS");
		} else if (semiMatch && request.method === "PATCH") {
			if (
				!semiMatch[2] ||
				!["completed", "partial", "failed"].includes(input.status) ||
				!Array.isArray(input.completed) ||
				!Array.isArray(input.attempted)
			)
				throw new Error("Invalid semi-automatic dose result");
		} else if (semiMatch) {
			return send(response, 405, { error: "Method not allowed" });
		}
		if (!semiMatch) {
			validateSystems(input.systems);
			if (!Number.isSafeInteger(input.revision) || input.revision < 0)
				throw new Error("Invalid revision");
		}
	} catch (error) {
		return send(response, 400, { error: error.message });
	}
	const write = writes.then(async () => {
		if (semiMatch && request.method === "POST") {
			const [systemId] = semiMatch.slice(1);
			const systemIndex = state.systems.findIndex(
				(item) => item.id === systemId,
			);
			if (systemIndex < 0)
				return send(response, 404, { error: "System not found" });
			const system = state.systems[systemIndex];
			if (!system.semiAutomatic)
				return send(response, 409, {
					error: "Save semi-automatic dosing configuration first",
				});
			const date = dateKey();
			const usage = system.semiAutomatic.dailyUsage || {};
			const decision = decideSemiAutomatic(
				system.semiAutomatic,
				input.measurements,
				usage[date] || 0,
				doseAvailability(system),
			);
			const blockedReason =
				typeof input.blockedReason === "string"
					? input.blockedReason.slice(0, 240)
					: "";
			const allowed = decision.allowed && !blockedReason;
			const event = {
				id: randomUUID(),
				date,
				timestamp: Date.now(),
				type: "semi-automatic",
				measurements: input.measurements,
				allowed,
				reason: blockedReason || decision.reason,
				notes: decision.notes,
				pumps: allowed ? decision.pumps : [],
				activations: allowed ? decision.pumps.length : 0,
				attempted: [],
				completed: [],
				status: allowed ? "running" : "declined",
			};
			const history = [...(system.semiAutomatic.history || []), event].slice(
				-100,
			);
			const dailyUsage = allowed
				? { ...usage, [date]: (usage[date] || 0) + event.activations }
				: usage;
			for (const key of Object.keys(dailyUsage)) {
				if (key !== date) delete dailyUsage[key];
			}
			const next = {
				...state,
				revision: state.revision + 1,
				systems: state.systems.map((item, index) =>
					index === systemIndex
						? {
								...item,
								semiAutomatic: {
									...system.semiAutomatic,
									dailyUsage,
									history,
								},
							}
						: item,
				),
			};
			await writeState(next);
			return send(response, 200, { ...event, revision: next.revision });
		}
		if (semiMatch && request.method === "PATCH") {
			const [systemId, eventId] = semiMatch.slice(1);
			const systemIndex = state.systems.findIndex(
				(item) => item.id === systemId,
			);
			if (systemIndex < 0)
				return send(response, 404, { error: "System not found" });
			const system = state.systems[systemIndex];
			const history = system.semiAutomatic?.history || [];
			const eventIndex = history.findIndex((item) => item.id === eventId);
			if (eventIndex < 0)
				return send(response, 404, { error: "Dose log not found" });
			const event = history[eventIndex];
			if (event.status !== "running")
				return send(response, 409, {
					error: "Dose log entry is already finalized",
				});
			if (
				input.attempted.some((pump) => !event.pumps.includes(pump)) ||
				input.completed.some((pump) => !input.attempted.includes(pump)) ||
				new Set(input.attempted).size !== input.attempted.length ||
				new Set(input.completed).size !== input.completed.length ||
				(input.status === "completed" &&
					input.completed.length !== event.pumps.length)
			)
				return send(response, 400, { error: "Invalid completed pump list" });
			const dailyUsage = { ...(system.semiAutomatic.dailyUsage || {}) };
			dailyUsage[event.date] = Math.max(
				0,
				(dailyUsage[event.date] || 0) -
					Math.max(0, event.activations - input.attempted.length),
			);
			const updatedEvent = {
				...event,
				status: input.status,
				activations: input.attempted.length,
				attempted: input.attempted,
				completed: input.completed,
				reason:
					typeof input.reason === "string"
						? input.reason.slice(0, 240)
						: event.reason,
				finishedAt: Date.now(),
			};
			const updatedHistory = [...history];
			updatedHistory[eventIndex] = updatedEvent;
			const next = {
				...state,
				revision: state.revision + 1,
				systems: state.systems.map((item, index) =>
					index === systemIndex
						? {
								...item,
								semiAutomatic: {
									...system.semiAutomatic,
									dailyUsage,
									history: updatedHistory,
								},
							}
						: item,
				),
			};
			await writeState(next);
			return send(response, 200, { ...updatedEvent, revision: next.revision });
		}
		if (input.revision !== state.revision) {
			return send(response, 409, {
				error: "Systems changed in another session. Reload and try again.",
			});
		}
		const next = { revision: state.revision + 1, systems: input.systems };
		await writeState(next);
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
