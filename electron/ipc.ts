import { ipcMain, shell, type BrowserWindow } from "electron";
import type {
  AppSettingsInput,
  DownloadDispatchRequest,
  NxmLinkEvent,
  ProtocolRegistrationResult,
} from "../shared/contracts";
import { DesktopServiceError, NexusDesktopService } from "./nexus-desktop-service";

interface RegisterDesktopIpcOptions {
  getMainWindow: () => BrowserWindow | null;
  isProtocolRegistered: () => boolean;
  registerProtocol: () => ProtocolRegistrationResult;
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof DesktopServiceError || error instanceof Error) {
    return error.message;
  }

  return "桌面服务发生了未预期错误。";
}

export function registerDesktopIpc(options: RegisterDesktopIpcOptions) {
  const service = new NexusDesktopService();
  const queuedNxmEvents: NxmLinkEvent[] = [];

  const handle = <Args extends unknown[], Result>(
    channel: string,
    resolver: (...args: Args) => Promise<Result> | Result,
  ) => {
    ipcMain.handle(channel, async (_event, ...args: Args) => {
      try {
        return await resolver(...args);
      } catch (error) {
        throw new Error(normalizeErrorMessage(error));
      }
    });
  };

  handle("desktop:get-runtime-info", async () => {
    return service.getRuntimeInfo(options.isProtocolRegistered());
  });

  handle("desktop:register-nxm-protocol", async () => {
    return options.registerProtocol();
  });

  handle("desktop:get-auth-status", async () => {
    return service.getAuthStatus();
  });

  handle("desktop:get-settings", async () => {
    return service.getSettings();
  });

  handle("desktop:update-settings", async (input: AppSettingsInput) => {
    return service.updateSettings(input);
  });

  handle("desktop:select-download-directory", async () => {
    return service.selectDownloadDirectory();
  });

  handle("desktop:get-download-state", async () => {
    return service.getDownloadState();
  });

  handle("desktop:connect-with-api-key", async (apiKey: string) => {
    return service.connectWithApiKey(apiKey);
  });

  handle("desktop:start-sso-login", async () => {
    return service.startSsoLogin();
  });

  handle("desktop:poll-sso-session", async (id: string) => {
    return service.pollSsoSession(id);
  });

  handle("desktop:logout", async () => {
    return service.logout();
  });

  handle("desktop:get-games", async () => {
    return service.getGames();
  });

  handle("desktop:get-game-overview", async (gameDomain: string) => {
    return service.getGameOverview(gameDomain);
  });

  handle("desktop:get-mod-detail", async (gameDomain: string, modId: number) => {
    return service.getModDetail(gameDomain, modId);
  });

  handle("desktop:dispatch-download", async (request: DownloadDispatchRequest) => {
    return service.dispatchDownload(request);
  });

  handle("desktop:pause-download", async (downloadId: string) => {
    return service.pauseDownload(downloadId);
  });

  handle("desktop:resume-download", async (downloadId: string) => {
    return service.resumeDownload(downloadId);
  });

  handle("desktop:open-external", async (url: string) => {
    await shell.openExternal(url);
  });

  handle("desktop:open-path", async (targetPath: string) => {
    await service.openPath(targetPath);
  });

  return {
    queueNxmLink(url: string) {
      const event = service.recordNxmLink(url);
      queuedNxmEvents.push(event);
    },
    flushQueuedNxmLinks() {
      const mainWindow = options.getMainWindow();

      if (!mainWindow || queuedNxmEvents.length === 0) {
        return;
      }

      for (const event of queuedNxmEvents.splice(0)) {
        mainWindow.webContents.send("desktop:nxm-link", event);
      }
    },
  };
}
