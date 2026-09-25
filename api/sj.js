// Vercel entry — official "export default server" WebSocket shape
// (vercel.com/docs/functions/websockets).
//
// Built to fail loudly instead of dying: module init does nothing that can
// throw (no top-level await, no import.meta, no static deps). All real init
// happens lazily on first request inside try/catch, and any failure is
// returned as JSON (error stack + what's actually in the bundle).
import http from "node:http";
import fs from "node:fs/promises";

// ------------------------------------------------------------------ //
// Visit logs: everything typed on the page (omnibox, gate attempts)   //
// plus every host the wisp tunnel opens, with IP + timestamp.         //
// No database on this plan: kept in memory + /tmp of the running      //
// instance (cap 500) — resets when the instance recycles/redeploys.   //
// View: /__logs?key=eli                                               //
// ------------------------------------------------------------------ //
const LOG_MAX = 500;
const LOGFILE = "/tmp/sj-visits.jsonl";
const LOGS = [];
let logLoaded = false;

async function addLog(entry) {
	if (!logLoaded) {
		logLoaded = true;
		try {
			const prev = await fs.readFile(LOGFILE, "utf8");
			for (const line of prev.split("\n")) {
				if (!line) continue;
				try { LOGS.push(JSON.parse(line)); } catch (e) { /* skip torn line */ }
			}
		} catch (e) { /* first boot */ }
	}
	entry.t = new Date().toISOString();
	LOGS.push(entry);
	if (LOGS.length > LOG_MAX) LOGS.splice(0, LOGS.length - LOG_MAX);
	try { await fs.appendFile(LOGFILE, JSON.stringify(entry) + "\n"); } catch (e) { /* ignore */ }
}

function clientIp(req) {
	const xf = req.headers["x-forwarded-for"];
	if (xf) return String(xf).split(",")[0].trim();
	return (req.socket && req.socket.remoteAddress) || "?";
}

function readSmallBody(req) {
	return new Promise((resolve, reject) => {
		let b = "";
		req.on("data", (c) => { b += c; if (b.length > 2048) { reject(new Error("too large")); req.destroy(); } });
		req.on("end", () => resolve(b));
		req.on("error", reject);
	});
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

async function handleLogPost(req, res) {
	let data = {};
	try { data = JSON.parse((await readSmallBody(req)) || "{}"); } catch (e) { data = {}; }
	await addLog({
		ip: clientIp(req),
		ua: String(req.headers["user-agent"] || "").slice(0, 160),
		kind: String(data.kind || "event").slice(0, 20),
		value: String(data.value === undefined ? "" : data.value).slice(0, 300),
	});
	res.writeHead(204);
	res.end();
}

async function handleLogsGet(req, res) {
	const key = new URL(req.url, "http://x").searchParams.get("key") || "";
	if (key.toLowerCase() !== (process.env.SJ_ADMIN_KEY || "eli").toLowerCase()) {
		res.writeHead(403, { "content-type": "text/plain" });
		return res.end("no");
	}
	await addLog({ ip: clientIp(req), ua: "", kind: "view-logs", value: "" }); // log the log reader too
	let rows = "";
	for (const e of LOGS.slice().reverse()) {
		rows += "<tr><td>" + esc(e.t || "") + "</td><td>" + esc(e.ip || "") + "</td><td>" + esc(e.kind || "") + "</td><td>" + esc(e.value || "") + "</td></tr>\n";
	}
	res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
	res.end("<!doctype html><meta charset=utf-8><title>logs</title><style>body{font:13px/1.5 ui-monospace,Menlo,monospace;background:#0b0d1a;color:#e8eaf6;padding:16px}table{border-collapse:collapse}td{border:1px solid #2c3352;padding:3px 8px}td:nth-child(2){color:#8ab4f8}h1{font-size:16px}</style><h1>" + LOGS.length + " entries (newest first, resets on redeploy)</h1><table><tr><td>time</td><td>ip</td><td>kind</td><td>value</td></tr>" + rows + "</table>");
}

const server = http.createServer((req, res) => {
	const pathname = (req.url || "").split("?")[0];
	if (pathname === "/__log" && req.method === "POST") {
		handleLogPost(req, res).catch(() => { try { res.destroy(); } catch (e) {} });
		return;
	}
	if (pathname === "/__logs") {
		handleLogsGet(req, res).catch(() => { try { res.destroy(); } catch (e) {} });
		return;
	}
	handle(req, res).catch((e) => diag(res, e));
});
server.on("upgrade", (req, socket, head) => {
	handleUpgrade(req, socket, head).catch(() => socket.destroy());
});

let initPromise = null;
function ensure() {
	if (!initPromise) {
		initPromise = (async () => {
			// literal import paths on purpose: Vercel's tracer follows them
			const [{ bootstrap }, expressMod, pathMod, compressionMod] = await Promise.all([
				import("../vendor/proxy-bootstrap/dist/bootstrap-server.js"),
				import("express"),
				import("node:path"),
				import("compression"),
			]);
			const express = expressMod.default || expressMod; // CJS interop
			const path = pathMod.default || pathMod;
			const compression = compressionMod.default || compressionMod;
			const { routeRequest, routeUpgrade } = await bootstrap();
			// capture every host the wisp tunnel opens (it logs each stream)
			const origLog = console.log;
			console.log = function (...a) {
				try {
					const m = /TCP stream to ([\w.-]+:\d+)/.exec(a.join(" "));
					if (m) addLog({ ip: "", ua: "", kind: "tunnel", value: m[1] });
				} catch (e) { /* ignore */ }
				return origLog.apply(console, a);
			};
			const app = express();
			// gzip client assets + proxied text (3 MB of client code -> ~1 MB),
			// then cache the immutable-ish client payload so reloads stop
			// re-downloading it through the function on every visit.
			app.use(compression());
			app.use((req, res, next) => {
				const p = req.path;
				if (p === "/sw.js") res.setHeader("Cache-Control", "no-cache");
				else if (p === "/" || p === "/index.html" || p === "/bootstrap-init.js") res.setHeader("Cache-Control", "no-cache");
				else if (/^\/(scram|clients|controller)\//.test(p) || /^(index\.css|index\.js|icon\.png|credits\.html)$/.test(p.slice(1)))
					res.setHeader("Cache-Control", "public, max-age=43200");
				next();
			});
			app.use((req, res, next) => {
				if (routeRequest(req, res)) return;
				next();
			});
			// Lambda cwd is the bundle root, which is where includeFiles puts
			// vendor/ and public/ (locally: run node from the repo root).
			app.use(express.static(path.join(process.cwd(), "public")));
			return { app, routeUpgrade };
		})();
		initPromise.catch(() => { initPromise = null; }); // allow retry after failure
	}
	return initPromise;
}

async function handle(req, res) {
	const { app } = await ensure();
	app(req, res, () => {});
}

async function handleUpgrade(req, socket, head) {
	const { routeUpgrade } = await ensure();
	routeUpgrade(req, socket, head);
}

async function diag(res, err) {
	const root = process.cwd();
	const bundle = {};
	for (const [label, p] of Object.entries({
		cwd: root,
		vendor: root + "/vendor",
		vendorDist: root + "/vendor/proxy-bootstrap/dist",
		downloads: root + "/vendor/proxy-bootstrap/dist/.downloads",
		public: root + "/public",
	})) {
		try { bundle[label] = (await fs.readdir(p)).slice(0, 12); }
		catch (e) { bundle[label] = e.code || String(e.message); }
	}
	try {
		res.statusCode = 500;
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.end(JSON.stringify({ error: String((err && err.stack) || err), bundle }, null, 2));
	} catch (e) { /* socket already gone */ }
}

export default server;
