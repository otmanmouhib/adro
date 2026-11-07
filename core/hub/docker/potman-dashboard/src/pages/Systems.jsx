import { useEffect, useRef, useState } from "react";
import DosingDetails from "@/components/DosingDetails";
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

function useAvailableDevices() {
	const [devices, setDevices] = useState({});
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState(null);
	const clientRef = useRef(null);
	const startingRef = useRef(new Map());
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
						setDevices((current) => ({
							...current,
							[`${parsed.type}:${parsed.mac}`]: {
								...current[`${parsed.type}:${parsed.mac}`],
								type: parsed.type,
								mac: parsed.mac,
								status,
								...(parsed.kind === "telemetry"
									? { telemetry: message.data, fw: message.v }
									: status === "offline"
										? { telemetry: undefined }
										: {}),
							},
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

	return {
		devices: Object.values(devices),
		connected,
		error,
		clientRef,
		startingDoses,
		sendCommand,
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
		clientRef,
		startingDoses,
		sendCommand,
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
																		publishMqtt(
																			clientRef.current,
																			configTopic(
																				assignment.type,
																				assignment.mac,
																			),
																			config,
																		)
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
