/** API exposed by the tray app's preload script; absent in a normal browser. */
export interface DesktopBridge {
  notifyLocked(): void;
  onLockRequest(callback: () => void): void;
  onShown(callback: () => void): void;
}

export const desktop: DesktopBridge | undefined = (window as { desktop?: DesktopBridge }).desktop;
