# local-to-live-url

Admin dashboard with two ways to make a local HTTPS server reachable from a phone (or anywhere) without touching router or LAN configuration:

- **Tunnel Admin** &mdash; starts/stops a [Cloudflare quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), giving you a random `https://<random>.trycloudflare.com` URL.
- **Tunnel to DNS url** &mdash; starts/stops up to five independent named [Cloudflare Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), each bound to its own subdomain, which then acts as that slot's public entry point. If a subdomain's tunnel doesn't exist yet, starting it provisions one automatically.

Both tabs share the same page and poll their own independent tunnel process.

- `frontend/` &mdash; Angular admin dashboard (Tailwind CSS). Each tab lets you set the local HTTPS server URL, toggle its tunnel on/off, and shows the resulting public URL with an editable field (append a path and the QR code/link follow it) plus a QR code for scanning on a phone.
- `server/` &mdash; Node/Express backend. Spawns/kills a `cloudflared` CLI process for each tunnel type and exposes REST endpoints the dashboard calls.

## Prerequisites

- Node.js 20+
- [`cloudflared`](https://github.com/cloudflare/cloudflared) installed and on your `PATH`
- For the **Tunnel to DNS url** tab specifically: `cloudflared tunnel login` run once, with the zone for your subdomain(s) authorized. Each named tunnel + DNS route is then created automatically on first start (using the subdomain itself as the tunnel name/ID) &mdash; no need to run `tunnel create` / `tunnel route dns` by hand.

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
- **Tunnel to DNS url**: up to five independent rows, each with its own local HTTPS server and subdomain field. Click **Start Tunnel** on a row; if that subdomain has no named tunnel yet, one is created and DNS-routed automatically. The public URL for that row is `https://<subdomain>`.

## How it works

### Tunnel Admin (Cloudflare quick Tunnel)

1. The Angular dashboard (`frontend/src/app/tunnel-admin/tunnel-admin.component.ts`) posts the local URL to `POST /api/tunnel/start`.
2. The backend (`server/src/tunnelManager.js`) spawns `cloudflared tunnel --url <localUrl>` and scrapes its output for the `https://*.trycloudflare.com` URL it prints once the tunnel is live.
3. The dashboard polls `GET /api/tunnel/status` every 2 seconds to reflect state (`stopped` / `starting` / `running` / `stopping` / `error`) and update the public URL / QR code.
4. `POST /api/tunnel/stop` kills the `cloudflared` process.

Quick Tunnels are ephemeral &mdash; the public URL changes every time you start a new tunnel.

### Tunnel to DNS url (named Cloudflare Tunnels, up to 5 slots)

1. The Angular dashboard renders five `app-dns-tunnel-row` instances (`frontend/src/app/dns-tunnel-row/dns-tunnel-row.component.ts`), each posting its local URL and subdomain to `POST /api/dns-tunnel/:id/start` (`id` 0&ndash;4).
2. The backend (`server/src/dnsTunnelManager.js`) manages five independent slots. On `start`, a slot first checks `cloudflared tunnel info <subdomain>`; if it doesn't exist, it runs `cloudflared tunnel create <subdomain>` and `cloudflared tunnel route dns --overwrite-dns <subdomain> <subdomain>` before launching `cloudflared tunnel --url <localUrl> run <subdomain>`, using the subdomain as the tunnel name/ID.
3. The backend watches the process output for `Registered tunnel connection` (falling back to a grace period if that log line isn't seen) and reports the public URL as `https://<subdomain>`.
4. `POST /api/dns-tunnel/:id/stop` kills that slot's `cloudflared` process.

All tunnel slots (Tunnel Admin, and each of the five DNS-url slots) run independently.
