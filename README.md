# sj — Scramjet proxy instance for hailrex.com

A self-hosted [Scramjet](https://github.com/MercuryWorkshop/scramjet) instance, deployed from the
official `create-proxy-app` template (GPL-3 generated files; AGPL-3 packages — see `public/credits.html`).

It runs ChatGPT-class sites that the arcade's built-in mirror can't (login + Cloudflare).
**Verified working locally**: boots with plain `npm install && node node-server.mjs` (no rust toolchain —
the server downloads prebuilt client + transports at startup), and `chatgpt.com` loads through the
tunnel past Cloudflare.

## Run locally

```bash
npm install
npm start          # http://127.0.0.1:3030
```

The scramjet client + transports are vendored in `vendor/` (pre-downloaded) — boots with no
runtime downloads or writes.

## Deploy (pick one)

### Vercel — same account as the arcade (WebSockets on Fluid compute)

The repo is Vercel-ready: `api/sj.js` exports the express+wisp server in the official
export-a-server WebSocket shape ([docs](https://vercel.com/docs/functions/websockets)),
`vercel.json` routes everything to it, and `vendor/` + `public/` are force-included in the
function bundle.

1. Vercel → Add New → Project → import `hailrex/sj`. Deploy with defaults.
2. Project → Settings → Domains → add `sj.hailrex.com` → in **Cloudflare** (where hailrex.com
   DNS lives) add the CNAME it shows (usually `cname.vercel-dns.com`); orange-cloud is fine.

Caveats: Hobby-plan functions cap a connection at **5 minutes** — a long ChatGPT session gets
its tunnel cut every 5 min and needs a page reload; new page loads just work. WebSockets are
beta on Vercel — if a deploy complains about permissions, enable WebSockets in project settings.

### Render / Koyeb / VPS (no 5-min cap; free tiers sleep when idle)

1. Render → New → Web Service → connect this repo.
2. Build `npm install`, start `npm start` — it reads `PORT` automatically.
3. Same Cloudflare CNAME step, pointing at the host URL.

## Point sj.hailrex.com at it

Wherever hailrex.com's DNS is managed (if Vercel manages it: Vercel → Project → Domains → Add →
`sj.hailrex.com`, then add a CNAME record pointing `sj` to the host URL; other hosts have their own
DNS step). The app binds any port via `PORT` and serves HTTP + websocket (`/wisp/`) on the same
port, so a plain CNAME/HTTP proxy is enough.

Then in the arcade: shield panel → "your own Scramjet URL" → `https://sj.hailrex.com` (the site's
default already points there).

## Keeping it quiet

- The page is titled "Notes" and sends `noindex` — keep it that way.
- A fresh domain isn't on school/proxy blocklists (the public scramjet instance is — it gets
  DNS-sinkholed on filtered networks, which shows up as a blank tab).
- Don't share the URL widely; traffic through it is unencrypted-to-the-host (it's a proxy — the
  host sees everything, so only you should run it).

## Troubleshooting ChatGPT

- If ChatGPT instantly shows "Application Error" / lands on `/auth/undefined`: the network is
  blocking `openai.com` at the connection level (verified on one filtered network — DNS stays
  clean, connections reset). The app makes a direct request there for auth config. Try logging
  in first (auth.openai.com is usually still reachable) or another network; on the real
  deployment traffic mostly stays inside the tunnel.
- Cloudflare "Just a moment…" that never resolves = cat-and-mouse loss; update the instance
  (`@mercuryworkshop/proxy-bootstrap` version) and retry.

## Password

The page is gated (password: `Math`, case-insensitive, salted SHA-256 in `public/index.html`)
like the arcade's lock — a client-side gate for casual visitors. To change it:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('sj:' + 'NEWPASSWORD'.toLowerCase()).digest('hex'))"
```

…then swap the `HASH` string. Honest limit: it hides the page, not the `/wisp/` endpoint.
