import type {
  AppSettings,
  AuthStatusResponse,
  DesktopBridgeApi,
  DesktopRuntimeInfo,
  DownloadDispatchRequest,
  DownloadDispatchResult,
  DownloadStateResponse,
  GameListEntry,
  GameOverviewResponse,
  ModDetailResponse,
  NxmLinkEvent,
  ProtocolRegistrationResult,
  SsoSessionResponse,
} from "../../shared/contracts";

function createBrowserFallback(): DesktopBridgeApi {
  const defaultSettings: AppSettings = {
    downloadDirectory: "Electron 启动后可配置",
    autoStartOnNxm: true,
    autoResumeInterrupted: true,
    maxConcurrentDownloads: 2,
    proxyEnabled: false,
    proxyUrl: "",
    proxyBypassList: "",
    requestRetryCount: 2,
    networkRouteMode: "systemProxy",
  };

  return {
    async getRuntimeInfo(): Promise<DesktopRuntimeInfo> {
      return {
        shell: "browser",
        appName: "Game++",
        appVersion: "dev-web",
        platform: navigator.platform,
        protocolRegistered: false,
      };
    },

    async registerNxmProtocol(): Promise<ProtocolRegistrationResult> {
      throw new Error("浏览器预览模式不支持注册 nxm:// 协议，请通过 npm run dev 启动 Electron 桌面壳。");
    },

    async getAuthStatus(): Promise<AuthStatusResponse> {
      return {
        connected: false,
        appIdAvailable: false,
        appName: "Game++",
      };
    },

    async getSettings(): Promise<AppSettings> {
      return defaultSettings;
    },

    async updateSettings(input) {
      return {
        ...defaultSettings,
        ...input,
      };
    },

    async selectDownloadDirectory() {
      throw new Error("浏览器预览模式不支持选择本地下载目录。");
    },

    async getDownloadState(): Promise<DownloadStateResponse> {
      return {
        queue: [],
        history: [],
        recentNxmLinks: [],
      };
    },

    async connectWithApiKey(): Promise<AuthStatusResponse> {
      throw new Error("当前是浏览器预览，请通过 npm run dev 启动 Electron 桌面外壳。");
    },

    async startSsoLogin(): Promise<SsoSessionResponse> {
      throw new Error("浏览器预览模式不支持桌面 SSO 登录。");
    },

    async pollSsoSession(): Promise<SsoSessionResponse> {
      throw new Error("浏览器预览模式不支持桌面 SSO 登录。");
    },

    async logout(): Promise<void> {
      return;
    },

    async getGames(): Promise<GameListEntry[]> {
      return [];
    },

    async getGameOverview(): Promise<GameOverviewResponse> {
      throw new Error("请在 Electron 桌面应用中浏览 Nexus 游戏目录。");
    },

    async getModDetail(): Promise<ModDetailResponse> {
      throw new Error("请在 Electron 桌面应用中查看模组详情。");
    },

    async dispatchDownload(_request: DownloadDispatchRequest): Promise<DownloadDispatchResult> {
      throw new Error("浏览器预览模式不支持桌面下载调度。");
    },

    async pauseDownload() {
      return {
        queue: [],
        history: [],
        recentNxmLinks: [],
      };
    },

    async resumeDownload() {
      return {
        queue: [],
        history: [],
        recentNxmLinks: [],
      };
    },

    async openExternal(url: string): Promise<void> {
      window.open(url, "_blank", "noopener,noreferrer");
    },

    async openPath(): Promise<void> {
      throw new Error("浏览器预览模式不支持打开本地路径。");
    },

    onNxmLink(_callback: (event: NxmLinkEvent) => void) {
      return () => undefined;
    },
  };
}

export const desktopBridge = window.nexusDesktop ?? createBrowserFallback();
