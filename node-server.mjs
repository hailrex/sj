// Standalone entry (Render/Koyeb/VPS/local). Same server as the Vercel
// function (api/sj.js) — one code path, no drift.
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
process.chdir(here); // api/sj.js resolves vendor/ + public/ from cwd

const server = (await import("./api/sj.js")).default;
const port = Number(process.env.PORT) || 3030;
server.listen(port, () => console.log(`Server is running on port ${port}`));
