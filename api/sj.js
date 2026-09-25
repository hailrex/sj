// Vercel entry: exports the same express+wisp server as server.js, in the
// official "export default server" WebSocket shape (vercel.com/docs/functions/websockets).
// All routing (scramjet client files, /sw.js, /wisp/ upgrade) is handled by
// the vendored proxy-bootstrap; public/ is served by express.static.
import http from "node:http";
import express from "express";
import { bootstrap } from "../vendor/proxy-bootstrap/dist/bootstrap-server.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { routeRequest, routeUpgrade } = await bootstrap();

const app = express();
app.use((req, res, next) => {
	if (routeRequest(req, res)) return;
	next();
});
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "public")));

const server = http.createServer(app);
server.on("upgrade", routeUpgrade);

export default server;
