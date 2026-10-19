# local-to-live-url (packaged build)

Ready-to-run build of the Tunnel Admin dashboard. The backend and the compiled dashboard run as a single Node process on one port, so there's no `npm install`, Angular CLI, or build step on this machine.

## Requirements

- Node.js 20+

Everything else is set up from the dashboard's **Cloudflare setup** tab:

1. **cloudflared**: if it isn't installed, click **Download and install cloudflared**. This saves the official build into `bin/`. You can also install it yourself (`winget install --id Cloudflare.cloudflared`) or point `CLOUDFLARED_PATH` at it, then click **Re-check**.
2. **Cloudflare login** (needed only for the **Tunnel to DNS url** tab): click **Log in** and approve the zone for your subdomain(s) on the Cloudflare page. Or import a `cert.pem` copied from `%USERPROFILE%\.cloudflared\` on a machine that's already logged in.

To use more than one Cloudflare account, add a profile per account and click **Use** to switch. New tunnels use the active profile. Tunnels created on another machine are picked up automatically, and their credentials are fetched the first time you start them here.

## Sign-in

The dashboard asks for the admin username and password. It locks after 1 minute without input. To change the credentials, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` before starting.

## Run

- **Windows:** double-click `start.bat` (it opens http://localhost:3050). Use `stop.bat` to stop it.
- **macOS / Linux:** `sh start.sh`, then open http://localhost:3050. Run `node scripts/stop.js` to stop it.
- **Any OS:** `npm start`.

To use another port, set `PORT` first (for example, `set PORT=8080` on Windows or `PORT=8080 sh start.sh` on macOS/Linux).

## Contents

- `src/`: Express backend that manages the `cloudflared` processes
- `public/`: compiled Angular dashboard, served by the backend
- `node_modules/`: production dependencies (express, cors). These are plain JavaScript, so the folder works on any OS. If it's missing, run `npm install --omit=dev`.
- `data/` (created on first use): saved Cloudflare logins and tunnel credentials. Keep it private, and don't copy it to machines that shouldn't have access to your Cloudflare account.
- `bin/` (created on first use): the downloaded `cloudflared`, if you installed it from the dashboard.


To update build-app after you change local-to-live-url, run this from the repo root:


npm run package

To output somewhere else, use npm run package -- "E:\some\other\folder", or set the BUILD_APP_DIR environment variable.
