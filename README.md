# local-to-live-url

Admin dashboard with two ways to make a local HTTPS server reachable from a phone (or anywhere) without touching router or LAN configuration:

- **Tunnel Admin** &mdash; starts/stops a [Cloudflare quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), giving you a random `https://<random>.trycloudflare.com` URL.
- **Tunnel to Public Ip url** &mdash; starts/stops an SSH reverse tunnel (`ssh -R`) to a server you control at a known public IP or domain, which then acts as the public entry point.

Both tabs share the same page and poll their own independent tunnel process.

- `frontend/` &mdash; Angular admin dashboard (Tailwind CSS). Each tab lets you set the local HTTPS server URL, toggle its tunnel on/off, and shows the resulting public URL with an editable field (append a path and the QR code/link follow it) plus a QR code for scanning on a phone.
- `server/` &mdash; Node/Express backend. Spawns/kills the `cloudflared` or `ssh` CLI process for each tunnel type and exposes REST endpoints the dashboard calls.

## Prerequisites

- Node.js 20+
- [`cloudflared`](https://github.com/cloudflare/cloudflared) installed and on your `PATH`, for the **Tunnel Admin** tab
- An OpenSSH client (`ssh`) on your `PATH` (present by default on Windows 10+, macOS, Linux), for the **Tunnel to Public Ip url** tab
- For the SSH tunnel tab specifically: a server you control at a reachable public IP/domain, with your SSH public key already authorized there, and `GatewayPorts` enabled in its `sshd_config` (otherwise the forwarded port is only reachable from that server's own loopback, not the public internet)

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
- **Tunnel to Public Ip url**: enter the local HTTPS server, the public IP/domain of your server, your SSH user, and a remote port to bind there, then click **Start Tunnel**. The public URL is `<scheme>://<publicIp>:<remotePort>`.

## How it works

### Tunnel Admin (Cloudflare quick Tunnel)

1. The Angular dashboard (`frontend/src/app/tunnel-admin/tunnel-admin.component.ts`) posts the local URL to `POST /api/tunnel/start`.
2. The backend (`server/src/tunnelManager.js`) spawns `cloudflared tunnel --url <localUrl>` and scrapes its output for the `https://*.trycloudflare.com` URL it prints once the tunnel is live.
3. The dashboard polls `GET /api/tunnel/status` every 2 seconds to reflect state (`stopped` / `starting` / `running` / `stopping` / `error`) and update the public URL / QR code.
4. `POST /api/tunnel/stop` kills the `cloudflared` process.

Quick Tunnels are ephemeral &mdash; the public URL changes every time you start a new tunnel.

### Tunnel to Public Ip url (SSH reverse tunnel)

1. The Angular dashboard (`frontend/src/app/public-ip-tunnel/public-ip-tunnel.component.ts`) posts the local URL, public IP/domain, SSH user/port, remote port, and optional private key path to `POST /api/ssh-tunnel/start`.
2. The backend (`server/src/sshTunnelManager.js`) spawns `ssh -N -R 0.0.0.0:<remotePort>:<localHost>:<localPort> <user>@<publicIp>` (key-based auth only, host key auto-trusted on first connect).
3. OpenSSH prints nothing on a successful forward, so the backend treats the process surviving a short grace period as connected and reports the public URL as `<scheme>://<publicIp>:<remotePort>`.
4. `POST /api/ssh-tunnel/stop` kills the `ssh` process.

This is a raw TCP forward, not an HTTP-aware proxy: the `Host` header your local server sees will be whatever the client sent (the public IP/domain), which can matter for name-based virtual hosting.

Both tunnel types run independently and only one instance of each runs at a time.
