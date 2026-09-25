// Vercel entry — official "export default server" WebSocket shape
// (vercel.com/docs/functions/websockets).
//
// Built to fail loudly instead of dying: module init does nothing that can
// throw (no top-level await, no import.meta, no static deps). All real init
// happens lazily on first request inside try/catch, and any failure is
// returned as JSON (error stack + what's actually in the bundle).
import http from "node:http";
import fs from "node:fs/promises";

const server = http.createServer((req, res) => {
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
			const [{ bootstrap }, expressMod, pathMod] = await Promise.all([
				import("../vendor/proxy-bootstrap/dist/bootstrap-server.js"),
				import("express"),
				import("node:path"),
			]);
			const express = expressMod.default || expressMod; // CJS interop
			const path = pathMod.default || pathMod;
			const { routeRequest, routeUpgrade } = await bootstrap();
			const app = express();
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
