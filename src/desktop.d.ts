import type { DesktopBridgeApi } from "../shared/contracts";

declare global {
  interface Window {
    nexusDesktop?: DesktopBridgeApi;
  }
}

export {};

