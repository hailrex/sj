// Vercel entry: exports the same express+wisp server as server.js, in the
// official "export default server" WebSocket shape (vercel.com/docs/functions/websockets).
// All routing (scramjet client files, /sw.js, /wisp/ upgrade) is handled by
// the vendored proxy-bootstrap; public/ is served by express.static.
//
// If anything in init fails (missing bundled files, read-only fs, …) we export
// a diagnostic handler instead of crashing, so the deployment shows the real
// error and what made it into the bundle — remove once everything is green.
import http from "node:http";
import express from "express";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

async function buildServer() {
	// literal path on purpose: Vercel's tracer follows string-literal imports
	const { bootstrap } = await import("../vendor/proxy-bootstrap/dist/bootstrap-server.js");
	const { routeRequest, routeUpgrade } = await bootstrap();

	const app = express();
	app.use((req, res, next) => {
		if (routeRequest(req, res)) return;
		next();
	});
	app.use(express.static(join(root, "public")));

	const server = http.createServer(app);
	server.on("upgrade", routeUpgrade);
	return server;
}

function diagHandler(err) {
	return async (req, res) => {
		const bundle = {};
		for (const [label, p] of Object.entries({
			cwd: ".",
			api: here,
			root: root,
			vendor: join(root, "vendor"),
			vendorDist: join(root, "vendor/proxy-bootstrap/dist"),
			downloads: join(root, "vendor/proxy-bootstrap/dist/.downloads"),
			public: join(root, "public"),
		})) {
			try { bundle[label] = (await fs.readdir(p)).slice(0, 12); }
			catch (e) { bundle[label] = e.code || String(e.message); }
		}
		res.statusCode = 500;
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.end(JSON.stringify({ error: String((err && err.stack) || err), bundle }, null, 2));
	};
}

let exported;
try {
	exported = await buildServer();
} catch (e) {
	console.error("sj init failed:", e);
	exported = diagHandler(e);
}
export default exported;
