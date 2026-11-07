export const DEVICE_NAMES_KEY = "adro.deviceNames";

export function getSavedDeviceNames() {
	try {
		return JSON.parse(window.localStorage.getItem(DEVICE_NAMES_KEY) || "{}");
	} catch (error) {
		console.error("Could not read saved device names", error);
		return {};
	}
}
