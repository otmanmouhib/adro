import { useEffect, useRef, useState } from "react";
import DosingDetails from "@/components/DosingDetails";
import SemiAutomatic from "@/components/SemiAutomatic";
import SwitchDetails from "@/components/SwitchDetails";
import { getSavedDeviceNames } from "@/lib/deviceNames";
import {
	commandTopic,
	configTopic,
	connectMqtt,
	parseTopic,
	publishMqtt,
	STATUS_TOPIC,
	TELEMETRY_TOPIC,
} from "@/lib/mqtt";
import {
	decideSemiAutomatic,
	doseAvailability,
} from "../../server/dose-decision.mjs";

const roles = [
	{
		key: "circulationPump",
		label: "Circulation pump",
		type: "switch",
		count: 4,
	},
	{ key: "feedPump", label: "Feed pump / valve", type: "switch", count: 4 },
	{ key: "solutionA", label: "Solution A", type: "dosing", count: 2 },
	{ key: "solutionB", label: "Solution B", type: "dosing", count: 2 },
	{ key: "phDown", label: "pH down", type: "dosing", count: 2 },
];

function channelKey(assignment) {
	return `${assignment.type}:${assignment.mac.replace(/[:-]/g, "").toLowerCase()}:${assignment.channel}`;
}

function deviceKey(device) {
	return `${device.type}:${device.mac.replace(/[:-]/g, "").toLowerCase()}`;
}

function sameDevice(first, second) {
	return first.type === second.type && deviceKey(first) === deviceKey(second);
}

function freshTelemetry(device) {
	return (
		device?.status === "online" &&
		device.telemetry &&
		Date.now() - device.receivedAt < 45_000
	);
}

function firmwareSupportsDoseRequests(version) {
	const parts = String(version || "")
		.split(".")
		.map((part) => Number.parseInt(part, 10));
	return (
		parts.length >= 3 &&
		[0, 1, 2].every((index) => Number.isInteger(parts[index])) &&
		(parts[0] > 1 ||
			(parts[0] === 1 && (parts[1] > 0 || (parts[1] === 0 && parts[2] >= 14))))
	);
}

function useAvailableDevices() {
	const [devices, setDevices] = useState({});
	const devicesRef = useRef({});
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState(null);
	const clientRef = useRef(null);
	const startingRef = useRef(new Map());
	const automationLocksRef = useRef(new Set());
	const [startingDoses, setStartingDoses] = useState({});

	function clearStarting(key) {
		const timer = startingRef.current.get(key);
		if (timer === undefined) return;
		clearTimeout(timer);
		startingRef.current.delete(key);
		setStartingDoses((current) => {
			const next = { ...current };
			delete next[key];
			return next;
		});
	}

	async function sendCommand(assignment, command) {
		const key = deviceKey(assignment);
		if (command.action === "dose_now") {
			if (automationLocksRef.current.has(key))
				throw new Error("A semi-automatic dose is using this dosing station");
			if (startingRef.current.has(key)) {
				throw new Error("Another pump on this dosing station is starting");
			}
			startingRef.current.set(
				key,
				setTimeout(() => clearStarting(key), 10000),
			);
			setStartingDoses((current) => ({ ...current, [key]: true }));
		}
		try {
			await publishMqtt(
				clientRef.current,
				commandTopic(assignment.type, assignment.mac),
				command,
			);
		} catch (error) {
			if (command.action === "dose_now") clearStarting(key);
			throw error;
		}
	}

	useEffect(() => {
		let client;
		let cancelled = false;
		connectMqtt()
			.then((connectedClient) => {
				client = connectedClient;
				if (cancelled) {
					client.end(true);
					return;
				}
				clientRef.current = client;
				client.on("connect", () => {
					setConnected(true);
					setError(null);
					client.subscribe(
						[STATUS_TOPIC, TELEMETRY_TOPIC],
						{ qos: 1 },
						(subscribeError) => {
							if (subscribeError)
								setError(
									`Could not subscribe to devices: ${subscribeError.message}`,
								);
						},
					);
				});
				const disconnect = () => {
					setConnected(false);
					devicesRef.current = {};
					setDevices({});
					for (const key of startingRef.current.keys()) clearStarting(key);
				};
				client.on("close", disconnect);
				client.on("offline", disconnect);
				client.on("error", (connectionError) =>
					setError(`Broker error: ${connectionError.message}`),
				);
				client.on("message", (topic, payload) => {
					const parsed = parseTopic(topic);
					if (!parsed || !["switch", "dosing"].includes(parsed.type)) return;
					if (parsed.kind === "status" && payload.length === 0) {
						setDevices((current) => {
							const next = { ...current };
							delete next[`${parsed.type}:${parsed.mac}`];
							return next;
						});
						return;
					}
					try {
						const message = JSON.parse(payload.toString());
						const status =
							parsed.kind === "telemetry" &&
							Array.isArray(message?.data?.channels)
								? "online"
								: parsed.kind === "status"
									? message?.data?.state
									: null;
						if (status !== "online" && status !== "offline") return;
						if (
							parsed.kind === "telemetry" &&
							message.data.channels.some((channel) => channel.state)
						) {
							clearStarting(deviceKey(parsed));
						}
						if (parsed.kind === "status" && status === "online") {
							publishMqtt(client, commandTopic(parsed.type, parsed.mac), {
								action: "get_state",
							}).catch((requestError) =>
								setError(
									`Could not request device state: ${requestError.message}`,
								),
							);
						}
						const key = `${parsed.type}:${parsed.mac}`;
						devicesRef.current = {
							...devicesRef.current,
							[key]: {
								...devicesRef.current[key],
								type: parsed.type,
								mac: parsed.mac,
								status,
								...(parsed.kind === "telemetry"
									? {
											telemetry: message.data,
											fw: message.v,
											receivedAt: Date.now(),
										}
									: status === "offline"
										? { telemetry: undefined }
										: {}),
							},
						};
						setDevices((current) => ({
							...current,
							[key]: devicesRef.current[key],
						}));
					} catch (parseError) {
						console.error("Invalid device message", topic, parseError);
					}
				});
			})
			.catch((connectionError) => {
				if (!cancelled)
					setError(`Could not connect to broker: ${connectionError.message}`);
			});
		return () => {
			cancelled = true;
			if (clientRef.current === client) clientRef.current = null;
			if (client) client.end(true);
			for (const timer of startingRef.current.values()) clearTimeout(timer);
			startingRef.current.clear();
		};
	}, []);

	function getDevice(assignment) {
		return devicesRef.current[deviceKey(assignment)];
	}

	function waitForTelemetry(assignment, predicate, timeoutMs = 12_000) {
		const client = clientRef.current;
		if (!client?.connected)
			return Promise.reject(
				new Error("Dashboard is disconnected from the broker"),
			);
		return new Promise((resolve, reject) => {
			const finish = (error, value) => {
				clearTimeout(timeout);
				client.removeListener("message", onMessage);
				client.removeListener("close", onDisconnect);
				client.removeListener("offline", onDisconnect);
				error ? reject(error) : resolve(value);
			};
			const onDisconnect = () =>
				finish(
					new Error(
						"Broker disconnected while waiting for device confirmation",
					),
				);
			const onMessage = (topic, payload) => {
				const parsed = parseTopic(topic);
				if (parsed?.kind !== "telemetry" || !sameDevice(parsed, assignment))
					return;
				try {
					const message = JSON.parse(payload.toString());
					const result = predicate(message.data, message);
					if (result !== undefined) finish(null, result);
				} catch (error) {
					finish(error);
				}
			};
			const timeout = setTimeout(
				() =>
					finish(new Error("Device did not confirm the requested dosing step")),
				timeoutMs,
			);
			client.on("message", onMessage);
			client.once("close", onDisconnect);
			client.once("offline", onDisconnect);
		});
	}

	async function doseAndConfirm(assignment, doseMl, circulation) {
		const key = deviceKey(assignment);
		if (automationLocksRef.current.has(key) || startingRef.current.has(key))
			throw new Error("Another dose is already using this dosing station");
		automationLocksRef.current.add(key);
		try {
			await doseAndConfirmLocked(assignment, doseMl, circulation);
		} finally {
			automationLocksRef.current.delete(key);
		}
	}

	async function saveDeviceConfig(assignment, config) {
		if (automationLocksRef.current.has(deviceKey(assignment)))
			throw new Error(
				"Pump settings cannot change during a semi-automatic dose",
			);
		await publishMqtt(
			clientRef.current,
			configTopic(assignment.type, assignment.mac),
			config,
		);
	}

	async function doseAndConfirmLocked(assignment, doseMl, circulation) {
		const device = getDevice(assignment);
		if (!freshTelemetry(device))
			throw new Error("Dosing station telemetry is offline or stale");
		if (!firmwareSupportsDoseRequests(device.fw))
			throw new Error(
				"Update the dosing station to firmware 1.0.14 or newer first",
			);
		const channelNumber = assignment.channel;
		const channel = device.telemetry.channels?.[channelNumber - 1];
		const flow = Number(channel?.flow_ml_s);
		if (!channel || !Number.isFinite(flow) || flow < 1 || flow > 10)
			throw new Error(
				`Pump ${channelNumber} needs a saved flow rate from 1 to 10 mL/s`,
			);
		if (device.telemetry.channels.some((item) => item.state))
			throw new Error("A dosing pump on this station is already running");
		const duration = (doseMl / flow) * 1000;
		if (!Number.isFinite(duration) || duration < 100 || duration > 600_000)
			throw new Error(
				`Pump ${channelNumber} dose and flow produce an unsafe run time`,
			);

		const configConfirmed = waitForTelemetry(assignment, (data) => {
			const current = data.channels?.[channelNumber - 1];
			return current &&
				Number(current.dose_ml) === doseMl &&
				Number(current.flow_ml_s) === flow
				? current
				: undefined;
		});
		try {
			await publishMqtt(
				clientRef.current,
				configTopic(assignment.type, assignment.mac),
				{ channel: channelNumber, dose_ml: doseMl, flow_ml_s: flow },
			);
		} catch (error) {
			configConfirmed.catch(() => {});
			throw error;
		}
		await configConfirmed;

		const requestId = crypto.randomUUID();
		const acknowledgment = waitForTelemetry(assignment, (data) => {
			const ack = data.last_dose_command;
			if (ack?.request_id !== requestId) return undefined;
			return ack.accepted
				? { ok: true }
				: { ok: false, error: ack.error || "Dosing station rejected the dose" };
		});
		try {
			await publishMqtt(
				clientRef.current,
				commandTopic(assignment.type, assignment.mac),
				{ action: "dose_now", channel: channelNumber, request_id: requestId },
			);
		} catch (error) {
			acknowledgment.catch(() => {});
			try {
				await publishMqtt(
					clientRef.current,
					commandTopic(assignment.type, assignment.mac),
					{ action: "stop_pump", channel: channelNumber },
				);
			} catch (stopError) {
				throw new Error(
					`${error.message}; stop command also failed: ${stopError.message}`,
				);
			}
			throw error;
		}
		let monitoring = true;
		const watchCirculation = async () => {
			while (monitoring) {
				const circulationDevice = getDevice(circulation);
				const circulationChannel =
					circulationDevice?.telemetry?.channels?.[circulation.channel - 1];
				if (!freshTelemetry(circulationDevice) || !circulationChannel?.state)
					throw new Error("Circulation SSR is no longer confirmed ON.");
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		};
		try {
			const ack = await acknowledgment;
			if (!ack.ok) throw new Error(ack.error);
			const completed = waitForTelemetry(
				assignment,
				(data) => {
					const current = data.channels?.[channelNumber - 1];
					return current?.last_request_id === requestId && !current.state
						? current
						: undefined;
				},
				Math.ceil(duration) + 15_000,
			);
			await Promise.race([completed, watchCirculation()]);
			monitoring = false;
		} catch (error) {
			monitoring = false;
			try {
				await publishMqtt(
					clientRef.current,
					commandTopic(assignment.type, assignment.mac),
					{ action: "stop_pump", channel: channelNumber },
				);
			} catch (stopError) {
				throw new Error(
					`${error.message}; stop command also failed: ${stopError.message}`,
				);
			}
			throw error;
		}
	}

	return {
		devices: Object.values(devices),
		connected,
		error,
		clientRef,
		startingDoses,
		sendCommand,
		getDevice,
		doseAndConfirm,
		saveDeviceConfig,
	};
}

async function requestSystems(options) {
	const response = await fetch("/api/systems", options);
	if (!response.headers.get("content-type")?.includes("application/json")) {
		throw new Error(
			`Systems service unavailable (HTTP ${response.status}). Start the systems API or check the dashboard containers.`,
		);
	}
	const body = await response.json();
	if (!response.ok)
		throw new Error(body.error || `Request failed (${response.status})`);
	return body;
}

async function requestSemiAutomatic(systemId, eventId, options) {
	const response = await fetch(
		`/api/systems/${encodeURIComponent(systemId)}/semi-automatic${eventId ? `/${encodeURIComponent(eventId)}` : ""}`,
		options,
	);
	const body = await response.json();
	if (!response.ok)
		throw new Error(body.error || `Request failed (${response.status})`);
	return body;
}

export default function SystemsPage() {
	const [state, setState] = useState(null);
	const [name, setName] = useState("");
	const [editing, setEditing] = useState(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);
	const {
		devices,
		connected,
		error: deviceError,
		startingDoses,
		sendCommand,
		getDevice,
		doseAndConfirm,
		saveDeviceConfig,
	} = useAvailableDevices();

	async function load() {
		try {
			const current = await requestSystems();
			setState(current);
			setEditing(null);
			setError(null);
		} catch (loadError) {
			setError(`Could not load systems: ${loadError.message}`);
		}
	}

	useEffect(() => {
		load();
	}, []);

	async function save(systems) {
		setSaving(true);
		setError(null);
		try {
			const updated = await requestSystems({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ revision: state.revision, systems }),
			});
			setState(updated);
			return true;
		} catch (saveError) {
			setError(`Could not save systems: ${saveError.message}`);
			return false;
		} finally {
			setSaving(false);
		}
	}

	async function runSemiAutomatic(system, measurements) {
		const decision = decideSemiAutomatic(
			system.semiAutomatic,
			measurements,
			0,
			doseAvailability(system),
		);
		let blockedReason = "";
		const circulation = system.assignments.circulationPump;
		if (decision.allowed) {
			if (!circulation) {
				blockedReason = "Assign a circulation pump before requesting a dose.";
			} else {
				const circulationDevice = getDevice(circulation);
				const circulationChannel =
					circulationDevice?.telemetry?.channels?.[circulation.channel - 1];
				if (
					!freshTelemetry(circulationDevice) ||
					circulationDevice.type !== "switch"
				) {
					blockedReason =
						"Circulation pump is offline or its telemetry is stale.";
				} else if (!circulationChannel?.state) {
					blockedReason =
						"Turn on the circulation pump and confirm its SSR state before dosing.";
				}
			}
		}
		if (decision.allowed && !blockedReason) {
			for (const role of decision.pumps) {
				const assignment = system.assignments[role];
				if (!assignment) {
					blockedReason = `Assign a pump for ${role} before requesting this dose.`;
					break;
				}
				const device = getDevice(assignment);
				if (!freshTelemetry(device) || device.type !== "dosing") {
					blockedReason = `The ${role} dosing station is offline or its telemetry is stale.`;
					break;
				}
				if (!firmwareSupportsDoseRequests(device.fw)) {
					blockedReason = `Update the ${role} dosing station to firmware 1.0.14 or newer.`;
					break;
				}
				const channels = device.telemetry.channels;
				const pump = channels?.[assignment.channel - 1];
				if (!pump || channels.some((channel) => channel.state)) {
					blockedReason = `The ${role} pump is missing or another pump on its station is already running.`;
					break;
				}
				const flow = Number(pump.flow_ml_s);
				const duration = (system.semiAutomatic.doses[role] / flow) * 1000;
				if (
					!Number.isFinite(flow) ||
					flow < 1 ||
					flow > 10 ||
					duration < 100 ||
					duration > 600_000
				) {
					blockedReason = `The ${role} pump needs a valid saved flow rate and safe dose runtime.`;
					break;
				}
			}
		}

		const event = await requestSemiAutomatic(system.id, null, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ measurements, blockedReason }),
		});
		await load();
		if (!event.allowed)
			return {
				allowed: false,
				reason: event.reason,
				status: event.status,
				notes: event.notes,
			};

		const completed = [];
		const attempted = [];
		let status = "completed";
		let reason = "";
		try {
			for (let index = 0; index < event.pumps.length; index++) {
				const role = event.pumps[index];
				if (index > 0) {
					await new Promise((resolve) =>
						setTimeout(resolve, system.semiAutomatic.mixingSeconds * 1000),
					);
					const liveCirculation = getDevice(circulation);
					const channel =
						liveCirculation?.telemetry?.channels?.[circulation.channel - 1];
					if (!freshTelemetry(liveCirculation) || !channel?.state)
						throw new Error("Circulation SSR is no longer confirmed ON.");
				}
				attempted.push(role);
				await doseAndConfirm(
					system.assignments[role],
					system.semiAutomatic.doses[role],
					circulation,
				);
				completed.push(role);
			}
		} catch (doseError) {
			status = completed.length ? "partial" : "failed";
			reason = doseError.message;
		}
		try {
			await requestSemiAutomatic(system.id, event.id, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status, attempted, completed, reason }),
			});
		} finally {
			await load();
		}
		return {
			allowed: true,
			status,
			completed,
			pumps: event.pumps,
			reason,
			notes: event.notes,
		};
	}

	async function createSystem(event) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		const system = {
			id,
			name: trimmed,
			architecture: "standalone",
			assignments: {},
		};
		if (await save([...state.systems, system])) {
			setName("");
			setEditing(system);
		}
	}

	async function saveSystem(event) {
		event.preventDefault();
		if (!editing.name.trim()) {
			setError("Enter a system name.");
			return;
		}
		if (
			await save(
				state.systems.map((system) =>
					system.id === editing.id
						? { ...editing, name: editing.name.trim() }
						: system,
				),
			)
		)
			setEditing(null);
	}

	async function deleteSystem(system) {
		if (!window.confirm(`Delete "${system.name}" and its assignments?`)) return;
		if (await save(state.systems.filter((item) => item.id !== system.id))) {
			if (editing?.id === system.id) setEditing(null);
		}
	}

	const used = new Set(
		(state?.systems || [])
			.filter((system) => system.id !== editing?.id)
			.flatMap((system) => Object.values(system.assignments).map(channelKey)),
	);
	const deviceNames = getSavedDeviceNames();

	return (
		<div className="max-w-3xl">
			<h1 className="mb-3 text-3xl font-semibold tracking-tight">Systems</h1>
			<p className="mb-6 leading-7 text-zinc-600 dark:text-zinc-400">
				Create standalone hydroponic systems and assign their components to
				claimed device channels. Use the controls below each saved assignment to
				operate its channel.
			</p>
			<div className="mb-5 text-xs text-zinc-500">
				{connected ? "Connected to broker" : "Disconnected from broker"} ·
				Configuration is stored on the hub
			</div>
			{(error || deviceError) && (
				<p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
					{error || deviceError}
				</p>
			)}
			{!state ? (
				<button
					type="button"
					onClick={load}
					className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
				>
					Retry loading systems
				</button>
			) : (
				<>
					<form
						onSubmit={createSystem}
						className="mb-8 flex flex-wrap items-end gap-3"
					>
						<label className="flex flex-col gap-1 text-sm">
							<span>New standalone system</span>
							<input
								value={name}
								onInput={(event) => setName(event.currentTarget.value)}
								maxLength={100}
								disabled={saving}
								required
								placeholder="e.g. Tower 1"
								className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
							/>
						</label>
						<button
							type="submit"
							disabled={saving}
							className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
						>
							Create system
						</button>
						<button
							type="button"
							onClick={load}
							disabled={saving}
							className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
						>
							Reload
						</button>
					</form>

					{state.systems.length === 0 ? (
						<p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
							No systems yet. Create a standalone system to begin.
						</p>
					) : (
						<div className="grid gap-4">
							{state.systems.map((system) => (
								<section
									key={system.id}
									className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
								>
									{editing?.id === system.id ? (
										<form onSubmit={saveSystem} className="grid gap-4">
											<label className="grid gap-1 text-sm">
												System name
												<input
													value={editing.name}
													onInput={(event) =>
														setEditing({
															...editing,
															name: event.currentTarget.value,
														})
													}
													maxLength={100}
													disabled={saving}
													required
													className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
												/>
											</label>
											{roles.map((role) => {
												const selected = editing.assignments[role.key];
												const otherAssignments = Object.entries(
													editing.assignments,
												)
													.filter(([key]) => key !== role.key)
													.map(([, assignment]) => channelKey(assignment));
												const reserved = new Set([
													...used,
													...otherAssignments,
												]);
												const options = devices
													.filter(
														(device) =>
															connected &&
															device.type === role.type &&
															device.status === "online",
													)
													.flatMap((device) =>
														Array.from({ length: role.count }, (_, index) => ({
															type: device.type,
															mac: device.mac,
															channel: index + 1,
														})),
													)
													.filter(
														(assignment) =>
															!reserved.has(channelKey(assignment)),
													);
												const selectedValue = selected
													? JSON.stringify(selected)
													: "";
												const selectedAvailable =
													selected &&
													options.some(
														(option) =>
															channelKey(option) === channelKey(selected),
													);
												return (
													<label key={role.key} className="grid gap-1 text-sm">
														{role.label}
														<select
															value={selectedValue}
															disabled={saving}
															onChange={(event) => {
																const value = event.currentTarget.value;
																const assignments = { ...editing.assignments };
																if (value)
																	assignments[role.key] = JSON.parse(value);
																else delete assignments[role.key];
																setEditing({ ...editing, assignments });
															}}
															className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
														>
															<option value="">Not assigned</option>
															{selected && !selectedAvailable && (
																<option value={selectedValue}>
																	{deviceNames[selected.mac] || selected.mac} ·
																	Channel {selected.channel} (unavailable)
																</option>
															)}
															{options.map((option) => (
																<option
																	key={channelKey(option)}
																	value={JSON.stringify(option)}
																>
																	{deviceNames[option.mac]
																		? `${deviceNames[option.mac]} (${option.mac})`
																		: option.mac}{" "}
																	· {role.type === "switch" ? "SSR" : "Pump"}{" "}
																	{option.channel}
																</option>
															))}
														</select>
													</label>
												);
											})}
											<p className="text-xs text-zinc-500">
												Only online, claimed devices are listed. Assigned
												channels are reserved across all systems.
											</p>
											<div className="flex gap-2">
												<button
													type="submit"
													disabled={saving}
													className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
												>
													Save assignments
												</button>
												<button
													type="button"
													disabled={saving}
													onClick={() => setEditing(null)}
													className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
												>
													Cancel
												</button>
											</div>
										</form>
									) : (
										<>
											<h2 className="text-lg font-semibold">{system.name}</h2>
											<p className="mb-4 text-sm text-zinc-500">
												Standalone system
											</p>
											<SemiAutomatic
												available={doseAvailability(system)}
												system={system}
												saving={saving}
												onSave={(semiAutomatic) =>
													save(
														state.systems.map((item) =>
															item.id === system.id
																? {
																		...item,
																		semiAutomatic: {
																			...item.semiAutomatic,
																			...semiAutomatic,
																		},
																	}
																: item,
														),
													)
												}
												onRun={(measurements) =>
													runSemiAutomatic(system, measurements)
												}
											/>
											<div className="grid gap-4 sm:grid-cols-2">
												{roles.map((role) => {
													const assignment = system.assignments[role.key];
													const device =
														assignment &&
														devices.find(
															(item) =>
																item.type === assignment.type &&
																channelKey({
																	...item,
																	channel: assignment.channel,
																}) === channelKey(assignment),
														);
													const selectedDevice =
														device ||
														(assignment && {
															type: assignment.type,
															mac: assignment.mac,
															status: "offline",
														});
													const Controls =
														assignment?.type === "switch"
															? SwitchDetails
															: DosingDetails;
													return (
														<section key={role.key} className="min-w-0">
															<h3 className="font-medium">{role.label}</h3>
															<p className="mb-3 text-xs text-zinc-500">
																{assignment
																	? `${deviceNames[assignment.mac] ? `${deviceNames[assignment.mac]} (${assignment.mac})` : assignment.mac} · ${assignment.type === "switch" ? "SSR" : "Pump"} ${assignment.channel}`
																	: "Not assigned"}
															</p>
															{assignment && (
																<Controls
																	key={channelKey(assignment)}
																	device={selectedDevice}
																	brokerConnected={connected}
																	selectedChannel={assignment.channel}
																	doseStarting={Boolean(
																		startingDoses[deviceKey(assignment)],
																	)}
																	onCommand={(command) =>
																		sendCommand(assignment, command)
																	}
																	onSaveConfig={(config) =>
																		saveDeviceConfig(assignment, config)
																	}
																/>
															)}
														</section>
													);
												})}
											</div>
											<div className="mt-5 flex gap-2">
												<button
													type="button"
													disabled={saving}
													onClick={() =>
														setEditing({
															...system,
															assignments: { ...system.assignments },
														})
													}
													className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
												>
													Configure
												</button>
												<button
													type="button"
													disabled={saving}
													onClick={() => deleteSystem(system)}
													className="rounded-md px-3 py-2 text-sm text-red-600 dark:text-red-400"
												>
													Delete
												</button>
											</div>
										</>
									)}
								</section>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}
