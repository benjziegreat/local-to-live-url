# local-to-live-url

Admin dashboard that starts/stops a [Cloudflare quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) pointed at a local HTTPS server, so the app is reachable from a phone (or anywhere) without touching router or LAN configuration.

- `frontend/` &mdash; Angular admin dashboard (Tailwind CSS). Lets you set the local HTTPS server URL, toggle the tunnel on/off, and shows the generated `https://<random>.trycloudflare.com` URL with a QR code for scanning on a phone.
- `server/` &mdash; Node/Express backend. Spawns/kills the `cloudflared` CLI process and exposes REST endpoints the dashboard calls.

## Prerequisites

- Node.js 20+
- [`cloudflared`](https://github.com/cloudflare/cloudflared) installed and on your `PATH` (the backend shells out to it; it does not bundle or download it)

## Run it

```bash
# Terminal 1 — backend (manages the cloudflared process)
cd server
npm install
npm start        # listens on http://localhost:3000

# Terminal 2 — frontend (admin dashboard)
cd frontend
npm install
npm start         # ng serve on http://localhost:4200, proxies /api to the backend
```

Open http://localhost:4200, enter the local HTTPS server address you want to expose (e.g. `https://localhost:4443`), and click **Start Tunnel**. Once cloudflared reports its assigned URL, the dashboard shows the public link and a QR code you can scan from a phone.

## How it works

1. The Angular dashboard (`frontend/src/app/app.component.ts`) posts the local URL to `POST /api/tunnel/start`.
2. The backend (`server/src/tunnelManager.js`) spawns `cloudflared tunnel --url <localUrl>` and scrapes its output for the `https://*.trycloudflare.com` URL it prints once the tunnel is live.
3. The dashboard polls `GET /api/tunnel/status` every 2 seconds to reflect state (`stopped` / `starting` / `running` / `stopping` / `error`) and update the public URL / QR code.
4. `POST /api/tunnel/stop` kills the `cloudflared` process.

Only one tunnel runs at a time. Quick Tunnels are ephemeral &mdash; the public URL changes every time you start a new tunnel.
