import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopBridgeApi,
  DownloadDispatchRequest,
  NxmLinkEvent,
} from "../shared/contracts";

const api: DesktopBridgeApi = {
  getRuntimeInfo() {
    return ipcRenderer.invoke("desktop:get-runtime-info");
  },
  registerNxmProtocol() {
    return ipcRenderer.invoke("desktop:register-nxm-protocol");
  },
  getAuthStatus() {
    return ipcRenderer.invoke("desktop:get-auth-status");
  },
  getSettings() {
    return ipcRenderer.invoke("desktop:get-settings");
  },
  updateSettings(input) {
    return ipcRenderer.invoke("desktop:update-settings", input);
  },
  selectDownloadDirectory() {
    return ipcRenderer.invoke("desktop:select-download-directory");
  },
  getDownloadState() {
    return ipcRenderer.invoke("desktop:get-download-state");
  },
  connectWithApiKey(apiKey: string) {
    return ipcRenderer.invoke("desktop:connect-with-api-key", apiKey);
  },
  startSsoLogin() {
    return ipcRenderer.invoke("desktop:start-sso-login");
  },
  pollSsoSession(id: string) {
    return ipcRenderer.invoke("desktop:poll-sso-session", id);
  },
  logout() {
    return ipcRenderer.invoke("desktop:logout");
  },
  getGames() {
    return ipcRenderer.invoke("desktop:get-games");
  },
  getGameOverview(gameDomain: string) {
    return ipcRenderer.invoke("desktop:get-game-overview", gameDomain);
  },
  getModDetail(gameDomain: string, modId: number) {
    return ipcRenderer.invoke("desktop:get-mod-detail", gameDomain, modId);
  },
  dispatchDownload(request: DownloadDispatchRequest) {
    return ipcRenderer.invoke("desktop:dispatch-download", request);
  },
  pauseDownload(downloadId: string) {
    return ipcRenderer.invoke("desktop:pause-download", downloadId);
  },
  resumeDownload(downloadId: string) {
    return ipcRenderer.invoke("desktop:resume-download", downloadId);
  },
  openExternal(url: string) {
    return ipcRenderer.invoke("desktop:open-external", url);
  },
  openPath(targetPath: string) {
    return ipcRenderer.invoke("desktop:open-path", targetPath);
  },
  onNxmLink(callback: (event: NxmLinkEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: NxmLinkEvent) => {
      callback(payload);
    };

    ipcRenderer.on("desktop:nxm-link", listener);

    return () => {
      ipcRenderer.removeListener("desktop:nxm-link", listener);
    };
  },
};

contextBridge.exposeInMainWorld("nexusDesktop", api);
