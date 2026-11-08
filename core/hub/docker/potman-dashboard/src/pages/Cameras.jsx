import { useEffect, useState } from "preact/hooks";

const STORAGE_KEY = "adro.camera-slot-names";
const DEFAULT_NAMES = ["Camera 1", "Camera 2", "Camera 3", "Camera 4"];

function loadCameraNames() {
	try {
		const savedNames = window.localStorage.getItem(STORAGE_KEY);
		if (!savedNames) return { names: DEFAULT_NAMES, error: null };

		const parsedNames = JSON.parse(savedNames);
		if (!Array.isArray(parsedNames)) {
			return {
				names: DEFAULT_NAMES,
				error: "Saved camera names were invalid; default names are shown.",
			};
		}

		return {
			names: DEFAULT_NAMES.map((defaultName, index) =>
				typeof parsedNames[index] === "string"
					? parsedNames[index]
					: defaultName,
			),
			error: null,
		};
	} catch {
		return {
			names: DEFAULT_NAMES,
			error: "Could not load camera names from this browser's storage.",
		};
	}
}

export default function CamerasPage() {
	const [initialState] = useState(loadCameraNames);
	const [names, setNames] = useState(initialState.names);
	const [storageError, setStorageError] = useState(initialState.error);

	useEffect(() => {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
			setStorageError(null);
		} catch {
			setStorageError("Camera names could not be saved in this browser.");
		}
	}, [names]);

	function renameSlot(index, value) {
		setNames((current) =>
			current.map((name, currentIndex) =>
				currentIndex === index ? value : name,
			),
		);
	}

	return (
		<div className="max-w-7xl">
			<header className="mb-6">
				<h1 className="mb-2 text-3xl font-semibold tracking-tight">Cameras</h1>
				<p className="text-sm text-zinc-600 dark:text-zinc-400">
					Set a name for each camera slot. Camera feeds are not connected yet;
					names are saved in this browser only.
				</p>
			</header>

			{storageError && (
				<p
					role="status"
					className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
				>
					{storageError}
				</p>
			)}

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{names.map((name, index) => (
					<section
						key={index}
						className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
					>
						<div className="relative mb-3 flex aspect-video items-center justify-center overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								fill="none"
								className="h-10 w-10 text-zinc-400"
							>
								<path
									d="M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinejoin="round"
								/>
								<circle
									cx="12"
									cy="13.5"
									r="3.25"
									stroke="currentColor"
									strokeWidth="1.5"
								/>
							</svg>
							<span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-300">
								No feed
							</span>
						</div>

						<label className="grid gap-1 text-sm font-medium">
							Slot {index + 1} name
							<input
								aria-label={`Name for camera slot ${index + 1}`}
								value={name}
								maxLength={40}
								onInput={(event) =>
									renameSlot(index, event.currentTarget.value)
								}
								className="min-w-0 rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-normal dark:border-zinc-700"
							/>
						</label>
					</section>
				))}
			</div>
		</div>
	);
}
