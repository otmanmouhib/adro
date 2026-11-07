import { spawn } from "node:child_process";

const children = [
	spawn("node", ["/opt/adro/systems.mjs"], { stdio: "inherit" }),
	spawn("nginx", ["-g", "daemon off;"], { stdio: "inherit" }),
];
let stopping = false;

function stop(exitCode) {
	if (stopping) return;
	stopping = true;
	process.exitCode = exitCode;
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGTERM");
	}
}

for (const child of children) {
	child.on("error", (error) => {
		console.error("Could not start dashboard process:", error);
		stop(1);
	});
	child.on("exit", (code, signal) => {
		if (!stopping) {
			console.error(
				`Dashboard process exited unexpectedly (code ${code}, signal ${signal})`,
			);
			stop(1);
		}
	});
}

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
