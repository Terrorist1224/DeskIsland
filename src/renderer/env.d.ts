/// <reference types="vite/client" />

import type { DesktopIslandBridge } from '../shared/contracts';

declare global {
  interface Window {
    deskIsland: DesktopIslandBridge;
  }
}
