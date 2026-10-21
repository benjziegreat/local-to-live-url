// Bridge between the dashboard page and the tray shell (exposed as window.desktop).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  /** Tell the shell the dashboard locked itself, so it hides to the tray. */
  notifyLocked: () => ipcRenderer.send('desktop:locked'),
  /** The shell is hiding the window; lock the dashboard. */
  onLockRequest: (callback) => ipcRenderer.on('desktop:lock', () => callback()),
  /** The window was brought back from the tray. */
  onShown: (callback) => ipcRenderer.on('desktop:shown', () => callback()),
});
