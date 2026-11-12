/** DSH 宿主接口。凭据只用于官方余额请求，永远不进入日志或响应。 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assetRoutes } from "./host-assets.mjs";
import { createWindowsMedia } from "./host-nowplaying-win.mjs";
import {
	NP_CACHE_MS, NOWPLAYING_PATH, CONTROL_PATH, READ_SCRIPT, controlScript, parseNowPlaying,
	parseSystemNowPlaying, systemControlArgs,
} from "./host-nowplaying.mjs";
import {
	BALANCE_PATH, BALANCE_URL, BALANCE_TIMEOUT_MS, CACHE_MS, CREDENTIAL_ID,
	formatBalance, isTrustedRequest, parseBalance, secretOf,
} from "./host-balance.mjs";

export const name = "dsh-plugin-eva-theme";

/** 注册统一带本机校验的 JSON 路由；HEAD 不写响应体。 */
function route(scope, path, method, handle) {
	scope.effect(() => scope.webServer.register({
		kind: "exact", path,
		handler: async (req, res) => {
			const send = (status, body) => {
				if (res.destroyed || res.writableEnded) return;
				res.writeHead(status, {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-store",
				});
				res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
			};
			if (!isTrustedRequest(req.headers)) return send(403, { ok: false, code: "FORBIDDEN" });
			if (req.method !== method && !(method === "GET" && req.method === "HEAD")) {
				return send(405, { ok: false, code: "METHOD" });
			}
			try { await handle(req, send); }
			catch { send(500, { ok: false, code: "ERROR" }); }
		},
	}), "eva-magi: " + path);
}

/** 小型 JSON 请求；在断开、超限或超时后释放监听器。 */
function readJsonBody(req) {
	return new Promise((resolve) => {
		let size = 0;
		const chunks = [];
		const done = (value) => {
			clearTimeout(timer);
			for (const [event, fn] of listeners) req.removeListener(event, fn);
			resolve(value);
		};
		const onData = (chunk) => {
			size += chunk.length;
			if (size > 4096) { done(null); req.resume(); }
			else chunks.push(chunk);
		};
		const onEnd = () => {
			try {
				const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
				done(value && typeof value === "object" && !Array.isArray(value) ? value : null);
			} catch { done(null); }
		};
		const onError = () => done(null);
		const listeners = [["data", onData], ["end", onEnd], ["error", onError], ["aborted", onError]];
		const timer = setTimeout(onError, 5000);
		for (const [event, fn] of listeners) req.on(event, fn);
	});
}

export function apply(ctx) {
	// Static media contains no account data. Exact package paths also work in remote-control views.
	ctx.inject(["webServer"], (scope) => {
		for (const {path, handler} of assetRoutes()) scope.effect(() => scope.webServer.register({kind:"exact", path, handler}), "eva-magi: asset " + path);
	});
	// 余额需要凭据；音乐只需要 webServer，两个能力独立降级。
	ctx.inject(["webServer", "credentials"], (scope) => {
		const lifecycle = new AbortController();
		scope.effect(() => () => lifecycle.abort(), "eva-magi: balance requests");
		let cache = null;
		let inflight = null;
		const readBalance = async (force) => {
			if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.body;
			if (inflight) return inflight;
			const signal = AbortSignal.any([lifecycle.signal, AbortSignal.timeout(BALANCE_TIMEOUT_MS)]);
			const task = (async () => {
				try {
					const key = secretOf(await scope.credentials.resolve(CREDENTIAL_ID));
					signal.throwIfAborted();
					if (!key) return { ok: false, code: "NO_KEY" };
					const response = await fetch(BALANCE_URL, {
						signal, headers: { authorization: "Bearer " + key, accept: "application/json" },
					});
					if (!response.ok) return { ok: false, code: "HTTP_" + response.status };
					const info = parseBalance(await response.json());
					return info ? { ok: true, ...info, text: formatBalance(info) } : { ok: false, code: "NO_BALANCE" };
				} catch {
					return { ok: false, code: signal.aborted ? "TIMEOUT" : "ERROR" };
				}
			})();
			inflight = task;
			try {
				const body = await task;
				if (body.ok && !lifecycle.signal.aborted) cache = { at: Date.now(), body };
				return body;
			} finally { if (inflight === task) inflight = null; }
		};
		route(scope, BALANCE_PATH, "GET", async (req, send) => {
			const refresh = new URL(req.url || BALANCE_PATH, "http://localhost").searchParams.get("refresh") === "1";
			send(200, await readBalance(refresh));
		});
	});

	ctx.inject(["webServer"], (scope) => {
		const lifecycle = new AbortController();
		scope.effect(() => () => lifecycle.abort(), "eva-magi: music processes");
		const windowsMedia = process.platform === "win32" ? createWindowsMedia(lifecycle.signal) : null;
		const macOS = process.platform === "darwin";
		const runOsaArgs = (args) => new Promise((resolve) => {
			if (!macOS || lifecycle.signal.aborted) return resolve(null);
			execFile("osascript", args, {
				timeout: 5000, maxBuffer: 64 * 1024, signal: lifecycle.signal,
			}, (error, stdout) => resolve(error ? null : String(stdout || "")));
		});
		const runOsa = (script) => runOsaArgs(["-e", script]);
		const mediaScript = fileURLToPath(new URL("./system-nowplaying.jxa", import.meta.url));
		const runMedia = (args) => runOsaArgs(["-l", "JavaScript", mediaScript, ...args]);
		let cache = null;
		let inflight = null;
		let generation = 0;
		const invalidate = () => { generation++; cache = null; inflight = null; };
		const readNowPlaying = async (force) => {
			if (windowsMedia) return windowsMedia.read();
			if (!macOS) return { ok: true, supported: false, app: null, playing: false };
			if (!force && cache && Date.now() - cache.at < NP_CACHE_MS) return cache.body;
			if (inflight) return inflight;
			const started = generation;
			const task = (async () => {
				const system = parseSystemNowPlaying(await runMedia(["read"]));
				if (system?.playing) return { ok: true, supported: true, ...system };
				const raw = await runOsa(READ_SCRIPT);
				const app = raw === null ? null : parseNowPlaying(raw);
				if (app?.playing) return { ok: true, supported: true, source: "app", ...app };
				if (system?.app || system && !app?.app) return { ok: true, supported: true, ...system };
				return app === null
					? { ok: false, code: "PLAYER_UNAVAILABLE", app: null, playing: false }
					: { ok: true, supported: true, source: "app", ...app };
			})();
			inflight = task;
			try {
				const body = await task;
				if (started === generation && !lifecycle.signal.aborted) cache = { at: Date.now(), body };
				return body;
			} finally { if (inflight === task) inflight = null; }
		};
		route(scope, NOWPLAYING_PATH, "GET", async (req, send) => send(200, await readNowPlaying(new URL(req.url, "http://localhost").searchParams.get("refresh") === "1")));
		route(scope, CONTROL_PATH, "POST", async (req, send) => {
			const body = await readJsonBody(req);
			if (!body) return send(400, { ok: false, code: "BODY" });
			if (!controlScript("Music", body.action)) return send(400, { ok: false, code: "ACTION" });
			if (windowsMedia) {
				const result = await windowsMedia.control(body.action, body.bundleId, body.app);
				if (result.ok) return send(200, { ...result, action: body.action });
				const status = result.code === "BODY" ? 400 : result.code === "SOURCE_CHANGED" ? 409 : 502;
				return send(status, result);
			}
			if (!macOS) return send(409, { ok: false, code: "UNSUPPORTED" });
			const direct = body.bundleId ? systemControlArgs(body.action, body.bundleId) : null;
			if (body.bundleId && !direct) return send(400, { ok: false, code: "BODY" });
			const controlSystem = async (args) => {
				let result;
				try { result = JSON.parse(await runMedia(args)); } catch { result = null; }
				return result;
			};
			invalidate();
			try {
				// JXA 在同一次调用中核对当前 bundleId 并控制，无需先读取整套曲目元数据。
				if (direct) {
					const result = await controlSystem(direct);
					if (result?.ok) return send(200, { ok: true, bundleId: body.bundleId, action: body.action });
					if (["SOURCE_CHANGED", "NO_APP"].includes(result?.code)) return send(409, { ok: false, code: result.code });
				}
				const current = await readNowPlaying(true);
				if (body.app && body.app !== current.app || body.bundleId && body.bundleId !== current.bundleId) return send(409, { ok: false, code: "SOURCE_CHANGED" });
				if (current.source === "system") {
					const args = systemControlArgs(body.action, current.bundleId);
					if (!args) return send(409, { ok: false, code: "NO_APP" });
					if (!direct) {
						const result = await controlSystem(args);
						if (result?.ok) return send(200, { ok: true, app: current.app, action: body.action });
						if (["SOURCE_CHANGED", "NO_APP"].includes(result?.code)) return send(409, { ok: false, code: result.code });
					}
					// 系统接口不可用时，仅允许 Music / Spotify 的固定脚本，不重复发送系统动作。
					const nativeApp = current.bundleId === "com.apple.Music" ? "Music" : current.bundleId === "com.spotify.client" ? "Spotify" : null;
					const fallback = controlScript(nativeApp, body.action);
					if (!fallback || await runOsa(fallback) === null) return send(502, { ok: false, code: "CONTROL_UNAVAILABLE" });
					return send(200, { ok: true, app: current.app, action: body.action });
				}
				const script = controlScript(current.app, body.action);
				if (!script) return send(409, { ok: false, code: "NO_APP" });
				if (await runOsa(script) === null) return send(502, { ok: false, code: "PLAYER_UNAVAILABLE" });
				return send(200, { ok: true, app: current.app, action: body.action });
			} finally { invalidate(); }
		});
	});
}
