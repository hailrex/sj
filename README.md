# sj — Scramjet proxy instance for hailrex.com

A self-hosted [Scramjet](https://github.com/MercuryWorkshop/scramjet) instance, deployed from the
official `create-proxy-app` template (GPL-3 generated files; AGPL-3 packages — see `public/credits.html`).

It runs ChatGPT-class sites that the arcade's built-in mirror can't (login + Cloudflare).
**Verified working locally**: boots with plain `npm install && node server.js` (no rust toolchain —
the server downloads prebuilt client + transports at startup), and `chatgpt.com` loads through the
tunnel past Cloudflare.

## Run locally

```bash
npm install
npm start          # http://127.0.0.1:3030  (first boot downloads ~3 MB of packages)
```

## Deploy (pick one always-on host)

Vercel **cannot** host this (it needs raw TCP + websockets). Any plain Node host works.

### Render (free tier is fine; sleeps after 15 min idle, slow first wake)

1. Render → New → Web Service → connect this GitHub repo.
2. Build command: `npm install` — Start command: `npm start` — it reads `PORT` automatically.
3. After deploy, note the URL (e.g. `sj-xxxx.onrender.com`).

### Koyeb / Railway / Fly / a $4 VPS

Same pattern: Node 20+, `npm install`, `npm start`, expose the HTTP port.

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
