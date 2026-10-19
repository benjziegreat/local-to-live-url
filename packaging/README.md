# local-to-live-url (packaged build)

Ready-to-run build of the Tunnel Admin dashboard. The backend and the compiled dashboard run as a single Node process on one port, so there's no `npm install`, Angular CLI, or build step on this machine.

## Requirements

- Node.js 20+
- [`cloudflared`](https://github.com/cloudflare/cloudflared) on your `PATH`
  - Windows: `winget install --id Cloudflare.cloudflared`
- For the **Tunnel to DNS url** tab only: run `cloudflared tunnel login` once on this machine and authorize the zone for your subdomain(s).

## Run

- **Windows:** double-click `start.bat` (it opens http://localhost:3050). Use `stop.bat` to stop it.
- **macOS / Linux:** `sh start.sh`, then open http://localhost:3050. Run `node scripts/stop.js` to stop it.
- **Any OS:** `npm start`.

To use another port, set `PORT` first (for example, `set PORT=8080` on Windows or `PORT=8080 sh start.sh` on macOS/Linux).

## Contents

- `src/`: Express backend that manages the `cloudflared` processes
- `public/`: compiled Angular dashboard, served by the backend
- `node_modules/`: production dependencies (express, cors). These are plain JavaScript, so the folder works on any OS. If it's missing, run `npm install --omit=dev`.


To update build-app after you change local-to-live-url, run this from the repo root:


npm run package

To output somewhere else, use npm run package -- "E:\some\other\folder", or set the BUILD_APP_DIR environment variable.
