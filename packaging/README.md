# Local to Live URL (tray app)

A ready-to-run Windows app. It doesn't need Node.js or anything else installed. Copy the whole folder to any machine and run `LocalToLiveUrl.exe`.

## Using it

- **Start:** double-click `LocalToLiveUrl.exe`. An arch icon appears in the system tray, and the dashboard window opens on the sign-in screen.
- **Sign in:** use the admin username and password.
- **Auto-hide:** after 1 minute without input, the dashboard locks and the window hides to the tray. Closing or minimizing the window does the same. Tunnels keep running in the background.
- **Reopen:** click the tray icon. The window comes back and asks for the admin password again.
- **Tray menu (right-click):**
  - Open
  - Lock and hide
  - Start with Windows: starts hidden in the tray when you sign in to Windows
  - Quit: stops all tunnels and exits
- The dashboard is also available in a browser at http://localhost:3050 while the app is running.

To change the port, set `PORT` before starting. To change the sign-in, set `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

## First-time setup on a new machine

Open the **Cloudflare setup** tab:

1. **cloudflared:** if it isn't installed, click **Download and install cloudflared**. It's saved into `bin\`.
2. **Cloudflare login** (needed only for the **Tunnel to DNS url** tab): click **Log in** and approve the zone for your subdomain(s). Or import a `cert.pem` copied from `%USERPROFILE%\.cloudflared\` on a machine that's already logged in.

To use more than one Cloudflare account, add a profile per account and click **Use** to switch. Tunnels created on another machine are picked up automatically. Their credentials are fetched the first time you start them here.

## Contents

- `LocalToLiveUrl.exe`, plus the runtime files beside it and `resources\`: the app. Keep them together.
- `data\` (created on first use): saved Cloudflare logins and tunnel credentials. Keep it private, and don't copy it to machines that shouldn't have access to your Cloudflare account.
- `bin\` (created on first use): the downloaded `cloudflared`, if you installed it from the app.
- `logs\app.log`: start, stop, show/hide and error events. Check it if something goes wrong.

## Updating

From the local-to-live-url repo, quit the tray app, then run:

```
npm run package
```

This rebuilds the app into this folder and keeps `data\`, `bin\` and `logs\`. To output somewhere else, use `npm run package -- "E:\some\other\folder"` or set `BUILD_APP_DIR`.
