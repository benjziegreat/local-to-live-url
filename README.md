# local-to-live-url

Admin dashboard with two ways to make a local HTTPS server reachable from a phone (or anywhere) without touching router or LAN configuration:

- **Tunnel Admin** &mdash; starts/stops a [Cloudflare quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), giving you a random `https://<random>.trycloudflare.com` URL.
- **Tunnel to DNS url** &mdash; starts/stops a named [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) already DNS-routed to a subdomain you control, which then acts as the public entry point.

Both tabs share the same page and poll their own independent tunnel process.

- `frontend/` &mdash; Angular admin dashboard (Tailwind CSS). Each tab lets you set the local HTTPS server URL, toggle its tunnel on/off, and shows the resulting public URL with an editable field (append a path and the QR code/link follow it) plus a QR code for scanning on a phone.
- `server/` &mdash; Node/Express backend. Spawns/kills a `cloudflared` CLI process for each tunnel type and exposes REST endpoints the dashboard calls.

## Prerequisites

- Node.js 20+
- [`cloudflared`](https://github.com/cloudflare/cloudflared) installed and on your `PATH`
- For the **Tunnel to DNS url** tab specifically: a named Cloudflare Tunnel already created and authenticated locally (`cloudflared tunnel login`, `cloudflared tunnel create <name>`) and DNS-routed to your subdomain (`cloudflared tunnel route dns <name> <subdomain>`), using the subdomain itself as the tunnel name/ID

## Run it

```bash
# Terminal 1 — backend (manages the cloudflared / ssh processes)
cd server
npm install
npm start        # listens on http://localhost:3000

# Terminal 2 — frontend (admin dashboard)
cd frontend
npm install
npm start         # ng serve on http://localhost:4200, proxies /api to the backend
```

Open http://localhost:4200 and pick a tab:

- **Tunnel Admin**: enter the local HTTPS server address (e.g. `https://localhost/PMS/`) and click **Start Tunnel**. Once cloudflared reports its assigned URL, the dashboard shows the public link and a QR code.
- **Tunnel to DNS url**: enter the local HTTPS server and the subdomain your named Cloudflare Tunnel is already DNS-routed to, then click **Start Tunnel**. The public URL is `https://<subdomain>`.

## How it works

### Tunnel Admin (Cloudflare quick Tunnel)

1. The Angular dashboard (`frontend/src/app/tunnel-admin/tunnel-admin.component.ts`) posts the local URL to `POST /api/tunnel/start`.
2. The backend (`server/src/tunnelManager.js`) spawns `cloudflared tunnel --url <localUrl>` and scrapes its output for the `https://*.trycloudflare.com` URL it prints once the tunnel is live.
3. The dashboard polls `GET /api/tunnel/status` every 2 seconds to reflect state (`stopped` / `starting` / `running` / `stopping` / `error`) and update the public URL / QR code.
4. `POST /api/tunnel/stop` kills the `cloudflared` process.

Quick Tunnels are ephemeral &mdash; the public URL changes every time you start a new tunnel.

### Tunnel to DNS url (named Cloudflare Tunnel)

1. The Angular dashboard (`frontend/src/app/public-ip-tunnel/public-ip-tunnel.component.ts`) posts the local URL and subdomain to `POST /api/dns-tunnel/start`.
2. The backend (`server/src/dnsTunnelManager.js`) spawns `cloudflared tunnel --url <localUrl> run <subdomain>`, using the subdomain as the tunnel name/ID &mdash; this assumes you've already run `cloudflared tunnel route dns <subdomain> <subdomain>` (or created the tunnel under that name) so Cloudflare's edge already knows where to route it.
3. The backend watches the process output for `Registered tunnel connection` (falling back to a grace period if that log line isn't seen) and reports the public URL as `https://<subdomain>`.
4. `POST /api/dns-tunnel/stop` kills the `cloudflared` process.

Both tunnel types run independently and only one instance of each runs at a time.
