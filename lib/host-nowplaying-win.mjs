/** Windows media bridge adapted from powang233/dsh-plugin-eva-theme (MIT). */
import { execFile, spawn } from "node:child_process";
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./system-media-win.ps1", import.meta.url));
const ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Mta", "-ExecutionPolicy", "Bypass", "-File", SCRIPT];
const ACTIONS = new Set(["playpause", "next", "previous"]);
const EMPTY = Object.freeze({ ok: true, supported: true, app: null, playing: false, sources: [] });
const SNAPSHOT_MS = 5000;
const IDLE_MS = 12_000;
const LINE_LIMIT = 128 * 1024;
const APP_NAMES = [
	[/spotify/i, "Spotify"], [/zunemusic|music\.ui|media\.?player/i, "Media Player"],
	[/cloudmusic|netease/i, "网易云音乐"], [/qqmusic/i, "QQ音乐"], [/kugou/i, "酷狗音乐"],
	[/kuwo/i, "酷我音乐"], [/msedge|microsoftedge/i, "Edge"], [/chrome/i, "Chrome"],
	[/firefox/i, "Firefox"], [/foobar/i, "foobar2000"], [/potplayer/i, "PotPlayer"], [/vlc/i, "VLC"],
];

function validId(id) {
	return typeof id === "string" && id.length > 0 && id.length <= 1024 && !/[\x00-\x1f\x7f]/.test(id);
}

function displayName(id) {
	for (const [pattern, name] of APP_NAMES) if (pattern.test(id)) return name;
	return (id.split(/[\\/]/).pop() || id).replace(/\.exe$/i, "").slice(0, 80) || "系统媒体";
}

function normalizeSnapshot(data) {
	if (data?.ok !== true || !Array.isArray(data.sources)) return null;
	const sources = [];
	const seen = new Set();
	const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
	const text = (value) => typeof value === "string" ? value.trim().slice(0, 1000) : "";
	for (const row of data.sources) {
		if (!validId(row?.aumid) || !["Playing", "Paused"].includes(row.status) || !text(row.title)) continue;
		const identity = row.aumid.toLowerCase();
		if (seen.has(identity)) continue;
		seen.add(identity);
		const playing = row.status === "Playing";
		sources.push({
			app: displayName(row.aumid), bundleId: row.aumid, source: row.source === "netease" ? "netease" : "smtc",
			playing, state: playing ? "playing" : "paused", title: text(row.title), artist: text(row.artist),
			album: text(row.album), duration: number(row.duration), position: number(row.position),
		});
		if (sources.length === 5) break;
	}
	const primary = sources.find((source) => source.playing) || sources[0];
	return primary ? { ...EMPTY, ...primary, sources } : EMPTY;
}

export function createWindowsMedia(signal) {
	const powershell = win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	let child = null, idleTimer = null, snapshot = null, receivedAt = 0, startedAt = -Infinity;
	const stop = () => {
		const active = child;
		child = null; snapshot = null; receivedAt = 0;
		if (active) active.kill();
	};
	const dispose = () => { clearTimeout(idleTimer); stop(); };
	signal.addEventListener("abort", dispose, { once: true });

	function start() {
		const now = Date.now();
		if (child && now - (receivedAt || startedAt) > IDLE_MS) stop();
		if (child || now - startedAt < 2500) return;
		startedAt = now;
		let active;
		try {
			active = spawn(powershell, [...ARGS, "-Mode", "read"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
		} catch { return; }
		child = active;
		let buffer = "";
		active.stdout.setEncoding("utf8");
		active.stdout.on("data", (chunk) => {
			if (child !== active) return;
			buffer += chunk;
			let newline;
			while ((newline = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (line.length > LINE_LIMIT) continue;
				try {
					const next = normalizeSnapshot(JSON.parse(line));
					if (next) { snapshot = next; receivedAt = Date.now(); }
				} catch { /* Ignore non-JSON diagnostics and incomplete records. */ }
			}
			if (buffer.length > LINE_LIMIT) buffer = "";
		});
		const exited = () => {
			if (child === active) { child = null; snapshot = null; receivedAt = 0; }
		};
		active.once("error", exited);
		active.once("exit", exited);
	}

	function read() {
		if (signal.aborted) return EMPTY;
		start();
		clearTimeout(idleTimer);
		idleTimer = setTimeout(stop, IDLE_MS);
		idleTimer.unref();
		return snapshot && Date.now() - receivedAt < SNAPSHOT_MS ? snapshot : EMPTY;
	}

	return {
		read,
		async control(action, id, app) {
			if (!ACTIONS.has(action)) return { ok: false, code: "ACTION" };
			if (!validId(id) || (app !== undefined && typeof app !== "string")) return { ok: false, code: "BODY" };
			const source = read().sources.find((source) => source.bundleId === id);
			if (!source || (app && app !== source.app)) return { ok: false, code: "SOURCE_CHANGED" };
			// AUMIDs may be paths with spaces. Encode them as data, never as a script or option.
			const encoded = Buffer.from(id, "utf8").toString("base64");
			return new Promise((resolve) => {
				execFile(powershell, [...ARGS, "-Mode", action, "-SourceId", encoded], {
					windowsHide: true, signal, timeout: 7500, maxBuffer: 32 * 1024,
				}, (error, stdout) => {
					if (!error) try {
						const result = JSON.parse(String(stdout).trim());
						if (result.ok === true) return resolve({ ok: true, bundleId: id });
						if (result.code === "SOURCE_CHANGED") return resolve({ ok: false, code: "SOURCE_CHANGED" });
					} catch { /* Use the stable control error below. */ }
					resolve({ ok: false, code: "CONTROL_UNAVAILABLE" });
				});
			});
		},
	};
}
