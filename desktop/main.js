// System tray shell for local-to-live-url: runs the tunnel server in-process and
// shows the dashboard in a window that hides to the tray (and locks) when idle.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, shell } = require('electron');

const APP_NAME = 'Local to Live URL';
const PORT = Number(process.env.PORT) || 3050;
const DASHBOARD_URL = `http://localhost:${PORT}/`;

// Keep Cloudflare logins and the downloaded cloudflared next to the exe, so the
// whole folder can be copied to another machine like before.
const BASE_DIR = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '.dev-data');
process.env.CLOUDFLARE_DATA_DIR ||= path.join(BASE_DIR, 'data');
process.env.CLOUDFLARED_BIN_DIR ||= path.join(BASE_DIR, 'bin');

const LOG_FILE = path.join(BASE_DIR, 'logs', 'app.log');
const MAX_LOG_BYTES = 1024 * 1024;

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack : String(p))).join(' ')}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Logging must never take the app down.
  }
}

// A tray app has no console: record failures instead of showing a crash dialog.
process.on('uncaughtException', (err) => log('uncaught exception:', err));
process.on('unhandledRejection', (err) => log('unhandled rejection:', err));

const server = require('./server/src/index.js');

let tray = null;
let win = null;
let quitting = false;
let shownTrayHint = false;

if (!app.requestSingleInstanceLock()) {
  // Already running: the first instance shows its window (see 'second-instance').
  quitting = true;
  app.exit(0);
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(boot);
}

async function boot() {
  app.setAppUserModelId('intekn-app.com.local-to-live-url');
  log(`starting (pid ${process.pid}, port ${PORT}, data ${process.env.CLOUDFLARE_DATA_DIR})`);
  try {
    await server.start(PORT);
    log('server listening');
  } catch (err) {
    log('server failed to start:', err);
    const reason = err.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use. Close the other copy of the dashboard (e.g. the old build-app's stop.bat) or set the PORT environment variable, then start ${APP_NAME} again.`
      : err.message;
    dialog.showErrorBox(`${APP_NAME} could not start`, reason);
    app.exit(1);
    return;
  }
  createTray();
  createWindow();
  // "Start with Windows" launches with --hidden: straight to the tray.
  if (!process.argv.includes('--hidden')) win.once('ready-to-show', () => showWindow());
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'));
  tray.setToolTip(`${APP_NAME} (port ${PORT})`);
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
  updateTrayMenu();
}

function updateTrayMenu() {
  const startAtLogin = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: () => showWindow() },
      { label: 'Lock and hide', click: () => hideWindow('tray menu') },
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: startAtLogin,
        enabled: app.isPackaged,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
          updateTrayMenu();
        },
      },
      { type: 'separator' },
      { label: 'Quit (stops all tunnels)', click: () => quit() },
    ])
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 820,
    height: 920,
    minWidth: 420,
    minHeight: 520,
    show: false,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadURL(DASHBOARD_URL);
  win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.on('render-process-gone', (_event, details) => {
    log('dashboard renderer gone:', details.reason, '- reloading');
    win.loadURL(DASHBOARD_URL);
  });

  // Links (public tunnel URLs, the Cloudflare login page) open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(DASHBOARD_URL)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // Closing or minimizing sends the app to the tray instead of exiting.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    hideWindow('closed');
  });
  win.on('minimize', () => hideWindow('minimized'));
}

function showWindow() {
  if (!win) return;
  log('show window');
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('desktop:shown');
}

/** Hides to the tray and locks the dashboard, so reopening asks for the password. */
function hideWindow(reason) {
  if (!win) return;
  win.webContents.send('desktop:lock');
  // A minimized window may report itself as not visible, so check both.
  if (!win.isVisible() && !win.isMinimized()) return;
  log(`hide window (${reason})`);
  win.hide();
  if (!shownTrayHint && tray) {
    shownTrayHint = true;
    tray.displayBalloon({
      iconType: 'info',
      title: APP_NAME,
      content: 'Still running in the system tray. Tunnels stay up. Click the icon to open it again.',
    });
  }
}

// The dashboard reports when it locked itself (1 minute without input, or Sign out).
ipcMain.on('desktop:locked', () => hideWindow('dashboard locked'));

const SHUTDOWN_TIMEOUT_MS = 5000;

async function quit() {
  if (quitting) return;
  quitting = true;
  log('quit requested: stopping tunnels and server');
  try {
    await Promise.race([server.shutdown(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))]);
  } catch (err) {
    log('shutdown error:', err);
  } finally {
    log('exiting');
    app.exit(0);
  }
}

// Any other exit path (e.g. Windows shutting down) still stops the tunnels.
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quit();
});

// Keep running in the tray when the window is hidden or closed.
app.on('window-all-closed', () => {});
