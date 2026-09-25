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
