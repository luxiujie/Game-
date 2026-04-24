import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  BadgeCheck,
  Boxes,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FolderDown,
  FolderOpen,
  Gamepad2,
  HardDriveDownload,
  History,
  KeyRound,
  Laptop2,
  Link2,
  LoaderCircle,
  LogIn,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import type {
  AppSettings,
  AuthStatusResponse,
  DesktopRuntimeInfo,
  DownloadHistoryAction,
  DownloadQueueItem,
  DownloadQueueStatus,
  DownloadStateResponse,
  FeedKey,
  GameListEntry,
  GameOverviewResponse,
  ModDetailResponse,
  NxmLinkEvent,
  SsoSessionResponse,
} from "../shared/contracts";
import appLogo from "../logo.png";
import { desktopBridge } from "./lib/desktopBridge";

type NavKey = "mods" | "games" | "settings" | "network" | "account" | "downloads";

const feedLabels: Record<FeedKey, string> = {
  trending: "热门趋势",
  latestUpdated: "最近更新",
  latestAdded: "最新发布",
};

const queueStatusLabels: Record<DownloadQueueStatus, string> = {
  queued: "排队中",
  resolving: "解析中",
  awaitingBrowser: "等待网页回调",
  downloading: "下载中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
};

const historyActionLabels: Record<DownloadHistoryAction, string> = {
  requested: "创建请求",
  browserOpened: "已打开网页",
  resolved: "已解析地址",
  started: "开始下载",
  paused: "暂停下载",
  resumed: "继续下载",
  completed: "完成下载",
  nxmReceived: "收到 nxm",
  failed: "调度失败",
};

const navigationItems = [
  {
    key: "mods" as const,
    label: "NexusMod管理",
    hint: "浏览与下载模组",
    icon: Boxes,
  },
  {
    key: "games" as const,
    label: "游戏管理",
    hint: "游戏管理入口预留",
    icon: HardDriveDownload,
  },
  {
    key: "settings" as const,
    label: "配置",
    hint: "统一应用配置",
    icon: Settings2,
  },
  {
    key: "network" as const,
    label: "网络配置",
    hint: "代理、重试与路由",
    icon: Link2,
  },
  {
    key: "account" as const,
    label: "账号",
    hint: "登录与连接状态",
    icon: UserRound,
  },
  {
    key: "downloads" as const,
    label: "下载管理",
    hint: "队列、历史与回调",
    icon: History,
  },
];

const numberFormatter = new Intl.NumberFormat("zh-CN");
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatDate(timestamp: number) {
  return dateFormatter.format(new Date(timestamp * 1000));
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

function formatBytes(bytes?: number) {
  if (bytes === undefined || Number.isNaN(bytes)) {
    return "--";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function getNxmSummary(event: NxmLinkEvent) {
  if (event.parsed?.modId) {
    return `${event.parsed.gameDomain} / Mod ${event.parsed.modId}${
      event.parsed.fileId ? ` / File ${event.parsed.fileId}` : ""
    }`;
  }

  if (event.parsed?.gameDomain) {
    return `${event.parsed.gameDomain} / 未识别资源`;
  }

  return event.parseError ?? "未能解析这个 nxm:// 链接";
}

function getStatusTone(status: DownloadQueueStatus) {
  if (status === "failed") {
    return "error";
  }

  if (status === "awaitingBrowser" || status === "queued" || status === "resolving") {
    return "warn";
  }

  return "info";
}

function getQueueStatusLabel(status: string) {
  return queueStatusLabels[status as DownloadQueueStatus] ?? status;
}

function getHistoryActionLabel(action: string) {
  return historyActionLabels[action as DownloadHistoryAction] ?? action;
}

function getNetworkRouteLabel(mode: AppSettings["networkRouteMode"]) {
  switch (mode) {
    case "systemProxy":
      return "跟随系统";
    case "builtInProxy":
      return "Game++内置代理";
    case "customProxy":
      return "自定义代理";
    default:
      return "跟随系统";
  }
}

function isActiveDownload(item: DownloadQueueItem) {
  return item.status === "resolving" || item.status === "downloading";
}

function createDefaultSettings(): AppSettings {
  return {
    downloadDirectory: "",
    autoStartOnNxm: true,
    autoResumeInterrupted: true,
    maxConcurrentDownloads: 2,
    proxyEnabled: false,
    proxyUrl: "",
    proxyBypassList: "",
    requestRetryCount: 2,
    networkRouteMode: "systemProxy",
  };
}

function pickGeneralSettings(settings: AppSettings) {
  return {
    downloadDirectory: settings.downloadDirectory,
    autoStartOnNxm: settings.autoStartOnNxm,
    autoResumeInterrupted: settings.autoResumeInterrupted,
    maxConcurrentDownloads: settings.maxConcurrentDownloads,
  };
}

function pickNetworkSettings(settings: AppSettings) {
  return {
    proxyEnabled: settings.proxyEnabled,
    proxyUrl: settings.proxyUrl,
    proxyBypassList: settings.proxyBypassList,
    requestRetryCount: settings.requestRetryCount,
    networkRouteMode: settings.networkRouteMode,
  };
}

export default function App() {
  const [selectedNav, setSelectedNav] = useState<NavKey>("mods");
  const [runtimeInfo, setRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatusResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(createDefaultSettings());
  const [downloadState, setDownloadState] = useState<DownloadStateResponse>({
    queue: [],
    history: [],
    recentNxmLinks: [],
  });
  const [games, setGames] = useState<GameListEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameListEntry | null>(null);
  const [overview, setOverview] = useState<GameOverviewResponse | null>(null);
  const [selectedFeed, setSelectedFeed] = useState<FeedKey>("trending");
  const [selectedModId, setSelectedModId] = useState<number | null>(null);
  const [modDetail, setModDetail] = useState<ModDetailResponse | null>(null);
  const [gameSearch, setGameSearch] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [ssoSession, setSsoSession] = useState<SsoSessionResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [gamesBusy, setGamesBusy] = useState(false);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [protocolBusy, setProtocolBusy] = useState(false);
  const [queueActionId, setQueueActionId] = useState<string | null>(null);

  const activeNav = navigationItems.find((item) => item.key === selectedNav) ?? navigationItems[0];
  const activeMods = overview?.sections[selectedFeed] ?? [];
  const activeTransfers = downloadState.queue.filter(isActiveDownload).length;
  const generalSettingsDirty =
    JSON.stringify(pickGeneralSettings(settingsDraft)) !==
    JSON.stringify(pickGeneralSettings(settings));
  const networkSettingsDirty =
    JSON.stringify(pickNetworkSettings(settingsDraft)) !==
    JSON.stringify(pickNetworkSettings(settings));

  const filteredGames = useMemo(() => {
    const query = gameSearch.trim().toLowerCase();

    if (!query) {
      return games;
    }

    return games.filter((game) => {
      return (
        game.name.toLowerCase().includes(query) ||
        game.domainName.toLowerCase().includes(query) ||
        game.genre.toLowerCase().includes(query)
      );
    });
  }, [gameSearch, games]);

  const selectedMod =
    modDetail?.mod ?? activeMods.find((item) => item.modId === selectedModId) ?? null;

  function syncSettingsState(nextSettings: AppSettings, scope: "all" | "general" | "network" = "all") {
    setSettings(nextSettings);
    setSettingsDraft((current) => {
      if (scope === "all") {
        return nextSettings;
      }

      return {
        ...current,
        ...(scope === "general" ? pickGeneralSettings(nextSettings) : pickNetworkSettings(nextSettings)),
      };
    });
  }

  function resetDraftSection(scope: "general" | "network") {
    setSettingsDraft((current) => ({
      ...current,
      ...(scope === "general" ? pickGeneralSettings(settings) : pickNetworkSettings(settings)),
    }));
  }

  async function refreshRuntime() {
    try {
      setRuntimeInfo(await desktopBridge.getRuntimeInfo());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取桌面运行状态失败。");
    }
  }

  async function refreshAuth() {
    try {
      setAuth(await desktopBridge.getAuthStatus());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载账号状态失败。");
    }
  }

  async function refreshSettings() {
    try {
      const nextSettings = await desktopBridge.getSettings();
      syncSettingsState(nextSettings);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取应用配置失败。");
    }
  }

  async function refreshDownloadState() {
    try {
      setDownloadState(await desktopBridge.getDownloadState());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取下载状态失败。");
    }
  }

  async function loadGames() {
    setGamesBusy(true);

    try {
      const nextGames = await desktopBridge.getGames();
      setGames(nextGames);
      setSelectedGame((current) => {
        if (current) {
          const match = nextGames.find((game) => game.domainName === current.domainName);
          if (match) {
            return match;
          }
        }

        return nextGames[0] ?? null;
      });
      setErrorMessage(null);
    } catch (error) {
      setGames([]);
      setSelectedGame(null);
      setOverview(null);
      setModDetail(null);
      setErrorMessage(error instanceof Error ? error.message : "加载游戏列表失败。");
    } finally {
      setGamesBusy(false);
    }
  }

  async function loadOverview(gameDomain: string) {
    setOverviewBusy(true);

    try {
      const nextOverview = await desktopBridge.getGameOverview(gameDomain);
      setOverview(nextOverview);
      setErrorMessage(null);
    } catch (error) {
      setOverview(null);
      setModDetail(null);
      setErrorMessage(error instanceof Error ? error.message : "加载当前游戏失败。");
    } finally {
      setOverviewBusy(false);
    }
  }

  async function loadModDetail(gameDomain: string, modId: number) {
    setDetailBusy(true);

    try {
      setModDetail(await desktopBridge.getModDetail(gameDomain, modId));
      setErrorMessage(null);
    } catch (error) {
      setModDetail(null);
      setErrorMessage(error instanceof Error ? error.message : "加载模组详情失败。");
    } finally {
      setDetailBusy(false);
    }
  }

  async function handleApiKeyLogin() {
    if (!apiKey.trim()) {
      setErrorMessage("请先输入 Nexus API Key。");
      return;
    }

    setAuthBusy(true);
    setStatusMessage("正在验证 API Key...");

    try {
      setAuth(await desktopBridge.connectWithApiKey(apiKey.trim()));
      setApiKey("");
      setStatusMessage("已连接 Nexus 账号，本机会自动记住登录状态。");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "连接账号失败。");
      setStatusMessage(null);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleStartSso() {
    setAuthBusy(true);
    setStatusMessage("正在打开 Nexus 授权页面...");

    try {
      setSsoSession(await desktopBridge.startSsoLogin());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "启动 SSO 登录失败。");
      setStatusMessage(null);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    setAuthBusy(true);

    try {
      await desktopBridge.logout();
      setAuth(null);
      setGames([]);
      setSelectedGame(null);
      setOverview(null);
      setModDetail(null);
      setSsoSession(null);
      setStatusMessage("已断开 Nexus 账号，本地保存的会话也已清除。");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "退出登录失败。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleDispatchDownload(fileId?: number, fileName?: string) {
    if (!selectedMod) {
      return;
    }

    setDownloadBusy(true);

    try {
      const result = await desktopBridge.dispatchDownload({
        gameDomain: selectedMod.domainName,
        modId: selectedMod.modId,
        fileId,
        modName: selectedMod.name,
        fileName,
      });
      setStatusMessage(result.queueItem.requiresBrowser ? null : result.message);
      setErrorMessage(null);
      await refreshDownloadState();
      setSelectedNav("downloads");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "调度下载失败。");
    } finally {
      setDownloadBusy(false);
    }
  }

  async function handlePauseDownload(downloadId: string) {
    setQueueActionId(downloadId);

    try {
      setDownloadState(await desktopBridge.pauseDownload(downloadId));
      setStatusMessage("下载已暂停。");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "暂停下载失败。");
    } finally {
      setQueueActionId(null);
    }
  }

  async function handleResumeDownload(downloadId: string) {
    setQueueActionId(downloadId);

    try {
      setDownloadState(await desktopBridge.resumeDownload(downloadId));
      setStatusMessage("下载任务已恢复。");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "继续下载失败。");
    } finally {
      setQueueActionId(null);
    }
  }

  async function handlePickDirectory() {
    setSettingsBusy(true);

    try {
      const nextSettings = await desktopBridge.selectDownloadDirectory();
      setSettings(nextSettings);
      setSettingsDraft((current) => ({
        ...current,
        downloadDirectory: nextSettings.downloadDirectory,
      }));
      setStatusMessage("下载目录已更新。");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "选择下载目录失败。");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleSaveGeneralSettings() {
    setSettingsBusy(true);

    try {
      const nextSettings = await desktopBridge.updateSettings(pickGeneralSettings(settingsDraft));
      syncSettingsState(nextSettings, "general");
      setStatusMessage("通用配置已保存。");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存通用配置失败。");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleSaveNetworkSettings() {
    setSettingsBusy(true);

    try {
      const nextSettings = await desktopBridge.updateSettings(pickNetworkSettings(settingsDraft));
      syncSettingsState(nextSettings, "network");
      setStatusMessage("网络配置已保存。");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存网络配置失败。");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleRegisterProtocol() {
    setProtocolBusy(true);

    try {
      const result = await desktopBridge.registerNxmProtocol();
      await refreshRuntime();

      if (result.registered) {
        setStatusMessage(result.message);
        setErrorMessage(null);
      } else {
        setStatusMessage(null);
        setErrorMessage(result.message);
      }
    } catch (error) {
      setStatusMessage(null);
      setErrorMessage(error instanceof Error ? error.message : "重新注册 nxm 协议失败。");
    } finally {
      setProtocolBusy(false);
    }
  }

  useEffect(() => {
    void refreshRuntime();
    void refreshAuth();
    void refreshSettings();
    void refreshDownloadState();

    const dispose = desktopBridge.onNxmLink((event) => {
      setDownloadState((current) => ({
        ...current,
        recentNxmLinks: [event, ...current.recentNxmLinks].slice(0, 16),
      }));
      setStatusMessage("已收到 nxm:// 回调，桌面端正在接管本地下载流程。");
      void refreshDownloadState();
    });

    return dispose;
  }, []);

  useEffect(() => {
    if (!activeTransfers) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshDownloadState();
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeTransfers]);

  useEffect(() => {
    if (auth?.connected) {
      void loadGames();
      return;
    }

    setGames([]);
    setSelectedGame(null);
    setOverview(null);
    setModDetail(null);
  }, [auth?.connected]);

  useEffect(() => {
    if (!selectedGame || !auth?.connected) {
      return;
    }

    void loadOverview(selectedGame.domainName);
  }, [auth?.connected, selectedGame?.domainName]);

  useEffect(() => {
    if (!overview) {
      setSelectedModId(null);
      setModDetail(null);
      return;
    }

    const firstVisibleMod = overview.sections[selectedFeed][0] ?? null;
    setSelectedModId((current) => {
      if (current && overview.sections[selectedFeed].some((mod) => mod.modId === current)) {
        return current;
      }

      return firstVisibleMod?.modId ?? null;
    });
  }, [overview, selectedFeed]);

  useEffect(() => {
    if (!selectedGame || !selectedModId || !auth?.connected) {
      return;
    }

    void loadModDetail(selectedGame.domainName, selectedModId);
  }, [auth?.connected, selectedGame?.domainName, selectedModId]);

  useEffect(() => {
    if (!ssoSession || ssoSession.status !== "pending") {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const nextSession = await desktopBridge.pollSsoSession(ssoSession.id);
        setSsoSession(nextSession);

        if (nextSession.status === "authorized") {
          setStatusMessage("SSO 授权完成，账号已经恢复并持久化到本地。");
          await refreshAuth();
        }

        if (nextSession.status === "error") {
          setErrorMessage(nextSession.message ?? "SSO 登录失败。");
          setStatusMessage(null);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "轮询 SSO 状态失败。");
        setStatusMessage(null);
      }
    }, 1500);

    return () => {
      window.clearInterval(timer);
    };
  }, [ssoSession]);

  function renderLoginFields() {
    return (
      <div className="stack">
        <label className="field">
          <span>个人 API Key</span>
          <textarea
            rows={4}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="输入你的 Nexus API Key"
          />
        </label>

        <div className="command-row">
          <button
            type="button"
            className="command-button"
            onClick={() => {
              void handleApiKeyLogin();
            }}
            disabled={authBusy}
          >
            {authBusy ? <LoaderCircle size={16} className="spin" /> : <KeyRound size={16} />}
            <span>连接 API Key</span>
          </button>

          <button
            type="button"
            className="command-button secondary"
            onClick={() => {
              void handleStartSso();
            }}
            disabled={authBusy || !auth?.appIdAvailable}
          >
            <LogIn size={16} />
            <span>SSO 登录</span>
          </button>
        </div>

        <div className="detail-muted">
          {auth?.appIdAvailable
            ? "SSO 会在默认浏览器中打开 Nexus 授权页，成功后自动回到桌面应用。"
            : "先在 .env 中配置 NEXUS_APP_ID，才能启用桌面 SSO。"}
        </div>
      </div>
    );
  }

  function renderQueueList(limit = 10) {
    return (
      <div className="queue-list">
        {downloadState.queue.length === 0 ? (
          <div className="empty-inline">还没有下载请求进入队列。</div>
        ) : (
          downloadState.queue.slice(0, limit).map((item) => {
            const progress = item.progress ?? { bytesTransferred: 0 };

            return (
              <div key={item.id} className="queue-item">
                <div className="queue-top">
                  <div className="row-title">
                    <strong>{item.modName}</strong>
                    <p>
                      {item.gameDomain} / Mod {item.modId}
                      {item.fileId ? ` / File ${item.fileId}` : ""}
                    </p>
                  </div>
                  <span className={`badge-soft ${getStatusTone(item.status)}`}>
                    {getQueueStatusLabel(item.status)}
                  </span>
                </div>

                <div className="row-meta">
                  <span>{item.fileName ?? "主文件"}</span>
                  <span>{item.source === "app" ? "应用发起" : "协议回调"}</span>
                  <span>{formatDateTime(item.updatedAt)}</span>
                </div>

                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress.percent ?? 0}%` }} />
                </div>

                <div className="inline-stats">
                  <span>
                    {formatBytes(progress.bytesTransferred)}
                    {progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}
                  </span>
                  <span>
                    {progress.percent !== undefined ? `${progress.percent.toFixed(1)}%` : "--"}
                  </span>
                  <span>
                    {progress.speedBytesPerSecond
                      ? `${formatBytes(progress.speedBytesPerSecond)}/s`
                      : "--"}
                  </span>
                </div>

                <p>{item.message}</p>

                <div className="queue-actions">
                  {isActiveDownload(item) ? (
                    <button
                      type="button"
                      className="command-button secondary compact"
                      onClick={() => {
                        void handlePauseDownload(item.id);
                      }}
                      disabled={queueActionId === item.id}
                    >
                      <Pause size={16} />
                      <span>暂停</span>
                    </button>
                  ) : null}

                  {item.status === "paused" || item.status === "failed" ? (
                    <button
                      type="button"
                      className="command-button compact"
                      onClick={() => {
                        void handleResumeDownload(item.id);
                      }}
                      disabled={queueActionId === item.id}
                    >
                      <Play size={16} />
                      <span>继续</span>
                    </button>
                  ) : null}

                  {item.status === "awaitingBrowser" && item.browserPageUrl ? (
                    <button
                      type="button"
                      className="command-button secondary compact"
                      onClick={() => {
                        void desktopBridge.openExternal(item.browserPageUrl!);
                      }}
                    >
                      <ExternalLink size={16} />
                      <span>打开 Nexus 页面</span>
                    </button>
                  ) : null}

                  {item.status === "completed" && item.filePath ? (
                    <button
                      type="button"
                      className="command-button secondary compact"
                      onClick={() => {
                        void desktopBridge.openPath(item.filePath!);
                      }}
                    >
                      <FolderOpen size={16} />
                      <span>打开文件</span>
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  function renderHistoryList(limit = 10) {
    return (
      <div className="history-list">
        {downloadState.history.length === 0 ? (
          <div className="empty-inline">还没有历史记录。</div>
        ) : (
          downloadState.history.slice(0, limit).map((entry) => (
            <div key={entry.id} className="history-item">
              <div className="queue-top">
                <div className="row-title">
                  <strong>{entry.modName}</strong>
                  <p>
                    {getHistoryActionLabel(entry.action)} / {getQueueStatusLabel(entry.status)}
                  </p>
                </div>
                <span className={`badge-soft ${getStatusTone(entry.status)}`}>
                  {formatDateTime(entry.recordedAt)}
                </span>
              </div>

              <div className="row-meta">
                <span>{entry.gameDomain}</span>
                <span>Mod {entry.modId}</span>
                {entry.fileId ? <span>File {entry.fileId}</span> : null}
              </div>

              <p>{entry.message}</p>
            </div>
          ))
        )}
      </div>
    );
  }

  function renderProtocolList(limit = 10) {
    return (
      <div className="protocol-log">
        {downloadState.recentNxmLinks.length === 0 ? (
          <div className="empty-inline">暂时还没有收到 nxm:// 回调。</div>
        ) : (
          downloadState.recentNxmLinks.slice(0, limit).map((event) => (
            <div key={`${event.url}-${event.receivedAt}`} className="protocol-item">
              <strong>{formatDateTime(event.receivedAt)}</strong>
              <p>{getNxmSummary(event)}</p>
              <div className="protocol-meta">
                {event.parsed?.userId ? <span>用户 {event.parsed.userId}</span> : null}
                {event.parsed?.expires ? <span>过期 {event.parsed.expires}</span> : null}
                {event.matchedQueueId ? <span>匹配到队列</span> : null}
                {event.parsed?.hasKey ? <span>包含下载令牌</span> : null}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  function renderModsSection() {
    return (
      <div className="mods-layout">
        <aside className="catalog-panel">
          <section className="surface-panel">
            <div className={`connection-state${auth?.connected ? " connected" : ""}`}>
              <span>连接状态：{auth?.connected ? "已连接" : "未连接"}</span>
              {auth?.connected ? <BadgeCheck size={16} /> : <ShieldCheck size={16} />}
            </div>
            {!auth?.connected ? (
              <button
                type="button"
                className="command-button secondary jump-button"
                onClick={() => setSelectedNav("account")}
              >
                <UserRound size={16} />
                <span>前往账号连接</span>
              </button>
            ) : null}
          </section>

          <section className="surface-panel grow-panel">
            <div className="panel-header">
              <span>游戏目录</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  void loadGames();
                }}
                disabled={!auth?.connected || gamesBusy}
                aria-label="刷新游戏列表"
                title="刷新游戏列表"
              >
                <RefreshCw size={16} className={gamesBusy ? "spin" : undefined} />
              </button>
            </div>

            <label className="search-field">
              <Search size={16} />
              <input
                type="search"
                value={gameSearch}
                onChange={(event) => setGameSearch(event.target.value)}
                placeholder="搜索游戏"
                disabled={!auth?.connected}
              />
            </label>

            <div className="game-list">
              {filteredGames.map((game) => {
                const active = game.domainName === selectedGame?.domainName;

                return (
                  <button
                    key={`${game.domainName}-${game.id}`}
                    type="button"
                    className={`game-row${active ? " active" : ""}`}
                    onClick={() => setSelectedGame(game)}
                  >
                    <div>
                      <strong>{game.name}</strong>
                      <p>{game.genre || "游戏"}</p>
                    </div>
                    <span>{formatNumber(game.mods)}</span>
                  </button>
                );
              })}

              {!gamesBusy && auth?.connected && filteredGames.length === 0 ? (
                <div className="empty-list">没有匹配的游戏。</div>
              ) : null}

              {!auth?.connected ? <div className="empty-list">请先连接账号。</div> : null}
            </div>
          </section>
        </aside>

        <main className="main-stage">
          <section className="hero-band">
            {selectedGame ? (
              <>
                <div className="hero-copy">
                  <h2>{selectedGame.name}</h2>
                  <p className="hero-summary">
                    {selectedGame.genre || "游戏"} / {formatNumber(selectedGame.mods)} 个模组 /{" "}
                    {formatNumber(selectedGame.downloads)} 次下载
                  </p>
                </div>
                <div className="hero-stats">
                  <div>
                    <span>文件数</span>
                    <strong>{formatNumber(selectedGame.fileCount)}</strong>
                  </div>
                  <div>
                    <span>收录日期</span>
                    <strong>{formatDate(selectedGame.approvedDate)}</strong>
                  </div>
                </div>
              </>
            ) : (
              <div className="hero-copy">
                <h2>在这里浏览游戏、模组和文件列表</h2>
                <p className="hero-summary">
                  左侧选择游戏，右侧查看模组详情和具体文件，下载任务会统一汇总到“下载管理”。
                </p>
              </div>
            )}
          </section>

          <section className="surface-panel">
            <div className="info-grid">
              <div className="info-card">
                <span>活动下载</span>
                <strong>{activeTransfers}</strong>
              </div>
              <div className="info-card">
                <span>队列总数</span>
                <strong>{downloadState.queue.length}</strong>
              </div>
              <div className="info-card">
                <span>已完成</span>
                <strong>
                  {downloadState.queue.filter((item) => item.status === "completed").length}
                </strong>
              </div>
              <div className="info-card">
                <span>最近 nxm</span>
                <strong>{downloadState.recentNxmLinks.length}</strong>
              </div>
            </div>

            <div className="toolbar-row">
              <div className="feed-switch">
                {(Object.keys(feedLabels) as FeedKey[]).map((feed) => (
                  <button
                    key={feed}
                    type="button"
                    className={`segment${selectedFeed === feed ? " active" : ""}`}
                    onClick={() => setSelectedFeed(feed)}
                    disabled={!selectedGame}
                  >
                    {feedLabels[feed]}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="command-button secondary compact"
                onClick={() => setSelectedNav("downloads")}
              >
                <History size={16} />
                <span>查看下载管理</span>
              </button>
            </div>
          </section>

          <section className="mod-grid">
            {overviewBusy ? (
              <div className="loading-state">
                <LoaderCircle size={20} className="spin" />
                <span>正在加载模组...</span>
              </div>
            ) : null}

            {!overviewBusy &&
              activeMods.map((mod) => (
                <article
                  key={mod.modId}
                  className={`mod-card${selectedModId === mod.modId ? " active" : ""}`}
                >
                  <button
                    type="button"
                    className="card-select"
                    onClick={() => setSelectedModId(mod.modId)}
                  >
                    <div className="card-image">
                      {mod.pictureUrl ? (
                        <img src={mod.pictureUrl} alt={mod.name} />
                      ) : (
                        <div className="fallback-art">
                          <Gamepad2 size={24} />
                        </div>
                      )}
                    </div>

                    <div className="card-copy">
                      <div className="card-heading">
                        <h3>{mod.name}</h3>
                        <span>{mod.version}</span>
                      </div>
                      <p>{mod.summary || "暂无简介。"}</p>
                    </div>
                  </button>

                  <div className="card-meta">
                    <span>{formatNumber(mod.endorsementCount)} 次认可</span>
                    <span>{formatNumber(mod.modDownloads)} 次下载</span>
                  </div>

                  <div className="card-actions">
                    <button
                      type="button"
                      className="command-button secondary compact"
                      onClick={() => setSelectedModId(mod.modId)}
                    >
                      <ExternalLink size={16} />
                      <span>查看详情</span>
                    </button>
                    <button
                      type="button"
                      className="command-button compact"
                      onClick={() => {
                        void handleDispatchDownload();
                      }}
                      disabled={downloadBusy}
                    >
                      <ArrowDownToLine size={16} />
                      <span>{downloadBusy ? "处理中..." : "下载主文件"}</span>
                    </button>
                  </div>
                </article>
              ))}

            {!overviewBusy && selectedGame && activeMods.length === 0 ? (
              <div className="loading-state">
                <AlertCircle size={20} />
                <span>这个分区暂时没有返回模组。</span>
              </div>
            ) : null}
          </section>
        </main>

        <aside className="detail-panel">
          {detailBusy ? (
            <div className="detail-placeholder">
              <LoaderCircle size={20} className="spin" />
              <span>正在加载详情...</span>
            </div>
          ) : null}

          {!detailBusy && modDetail ? (
            <div className="detail-stack">
              <section className="detail-header">
                <div className="detail-title">
                  <h2>{modDetail.mod.name}</h2>
                  <button
                    type="button"
                    className="open-link"
                    onClick={() => {
                      void desktopBridge.openExternal(
                        `https://www.nexusmods.com/${modDetail.mod.domainName}/mods/${modDetail.mod.modId}`,
                      );
                    }}
                  >
                    <ExternalLink size={14} />
                    <span>原站页面</span>
                  </button>
                </div>
                <p>{modDetail.mod.description || modDetail.mod.summary || "暂无描述。"}</p>
                <div className="detail-tags">
                  <span>{modDetail.mod.author}</span>
                  <span>{formatDate(modDetail.mod.updatedTimestamp)}</span>
                  <span>{formatNumber(modDetail.mod.modUniqueDownloads)} 独立下载</span>
                </div>
              </section>

              <section className="detail-section">
                <div className="section-title-row">
                  <h3>文件列表</h3>
                  <button
                    type="button"
                    className="command-button compact"
                    onClick={() => {
                      void handleDispatchDownload();
                    }}
                    disabled={downloadBusy}
                  >
                    <FolderDown size={16} />
                    <span>调度主文件</span>
                  </button>
                </div>

                <div className="file-list">
                  {modDetail.files.files.map((file) => (
                    <div key={file.fileId} className="file-row">
                      <div>
                        <strong>{file.name}</strong>
                        <p>
                          {file.categoryName} / {file.version} /{" "}
                          {formatNumber(Math.round(file.sizeKb))} KB
                        </p>
                      </div>
                      <button
                        type="button"
                        className="icon-button anchor"
                        onClick={() => {
                          void handleDispatchDownload(file.fileId, file.fileName || file.name);
                        }}
                        aria-label={`下载 ${file.name}`}
                        title={`下载 ${file.name}`}
                      >
                        <ArrowDownToLine size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="detail-section">
                <div className="section-title-row">
                  <h3>最近更新</h3>
                  <CheckCircle2 size={16} />
                </div>
                <div className="changelog-list">
                  {Object.entries(modDetail.changelogs)
                    .slice(0, 3)
                    .map(([version, entries]) => (
                      <div key={version} className="changelog-block">
                        <strong>{version}</strong>
                        <ul>
                          {entries.slice(0, 4).map((entry) => (
                            <li key={`${version}-${entry}`}>{entry}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              </section>
            </div>
          ) : null}

          {!detailBusy && !modDetail ? (
            <div className="detail-placeholder">
              <ExternalLink size={20} />
              <span>选择一个模组后，这里会显示文件列表和下载入口。</span>
            </div>
          ) : null}
        </aside>
      </div>
    );
  }

  function renderGamesSection() {
    return (
      <div className="section-stack">
        <section className="hero-band">
          <div className="hero-copy">
            <p className="eyebrow">游戏管理</p>
            <h2>游戏本体管理与安装</h2>
            <p className="hero-summary">
              目前版本暂时只留导航位，后续会在这里接游戏库并增加版本管理、安装与修复功能。
            </p>
          </div>
        </section>

        <div className="double-grid">
          <section className="surface-panel placeholder-panel">
            <HardDriveDownload size={24} />
            <strong>游戏管理功能预留</strong>
            <p>后续可在这里接平台源、版本切换、安装与修复。</p>
          </section>

          <section className="surface-panel placeholder-panel">
            <FolderOpen size={24} />
            <strong>下载目录统一在“配置”中维护</strong>
            <p>
              {settings.downloadDirectory ||
                "请先到“配置”中设置下载目录，游戏管理与 Mod 下载会共用这里的目录策略。"}
            </p>
            <button
              type="button"
              className="command-button secondary compact"
              onClick={() => setSelectedNav("settings")}
            >
              <Settings2 size={16} />
              <span>前往配置</span>
            </button>
          </section>
        </div>
      </div>
    );
  }

  function renderSettingsSection() {
    return (
      <div className="section-stack">
        <div className="double-grid">
          <section className="surface-panel">
            <div className="panel-header">
              <span>应用配置</span>
              <Settings2 size={16} />
            </div>

            <div className="settings-stack">
              <div className="detail-muted">
                “游戏管理”和“NexusMod管理”共用这里的下载目录与下载策略，后续新增其他下载源也统一从这里维护。
              </div>

              <label className="field">
                <span>下载目录</span>
                <div className="path-field-row">
                  <input value={settingsDraft.downloadDirectory} readOnly />
                  <button
                    type="button"
                    className="command-button secondary inline-action"
                    onClick={() => {
                      void handlePickDirectory();
                    }}
                    disabled={settingsBusy}
                  >
                    <FolderOpen size={16} />
                    <span>设置</span>
                  </button>
                </div>
              </label>

              <div className="settings-grid">
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoStartOnNxm}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        autoStartOnNxm: event.target.checked,
                      }))
                    }
                  />
                  <span>收到 nxm:// 后自动开始下载</span>
                </label>

                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoResumeInterrupted}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        autoResumeInterrupted: event.target.checked,
                      }))
                    }
                  />
                  <span>应用重启后自动恢复下载</span>
                </label>

                <label className="field compact-field">
                  <span>并发下载数</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={settingsDraft.maxConcurrentDownloads}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        maxConcurrentDownloads: Number.parseInt(event.target.value || "1", 10),
                      }))
                    }
                  />
                </label>
              </div>

              <div className="settings-callout">
                <div>
                  <strong>网络配置已独立</strong>
                  <p>代理 URL、请求重试次数与路由模式已移动到“网络配置”页，方便单独保存和回滚。</p>
                </div>
                <button
                  type="button"
                  className="command-button secondary"
                  onClick={() => setSelectedNav("network")}
                >
                  <Link2 size={16} />
                  <span>前往网络配置</span>
                </button>
              </div>

              <div className="command-row">
                <button
                  type="button"
                  className="command-button"
                  onClick={() => {
                    void handleSaveGeneralSettings();
                  }}
                  disabled={settingsBusy || !generalSettingsDirty}
                >
                  <Save size={16} />
                  <span>保存通用配置</span>
                </button>

                <button
                  type="button"
                  className="command-button secondary"
                  onClick={() => resetDraftSection("general")}
                  disabled={settingsBusy || !generalSettingsDirty}
                >
                  <RefreshCw size={16} />
                  <span>恢复当前配置</span>
                </button>
              </div>
            </div>
          </section>

          <section className="surface-panel">
            <div className="panel-header">
              <span>桌面环境</span>
              <Laptop2 size={16} />
            </div>

            <div className="meta-grid">
              <div className="meta-tile">
                <span>运行宿主</span>
                <strong>{runtimeInfo?.shell === "electron" ? "Electron" : "浏览器预览"}</strong>
              </div>
              <div className="meta-tile">
                <span>nxm 协议</span>
                <strong>{runtimeInfo?.protocolRegistered ? "已注册" : "待注册"}</strong>
              </div>
              <div className="meta-tile">
                <span>平台</span>
                <strong>{runtimeInfo?.platform ?? "--"}</strong>
              </div>
              <div className="meta-tile">
                <span>版本</span>
                <strong>{runtimeInfo?.appVersion ?? "--"}</strong>
              </div>
            </div>

            <div className="command-row">
              <button
                type="button"
                className="command-button secondary"
                onClick={() => {
                  void handleRegisterProtocol();
                }}
                disabled={protocolBusy || runtimeInfo?.shell !== "electron"}
              >
                {protocolBusy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                <span>重新注册 nxm 协议</span>
              </button>
            </div>

            <div className="stack">
              <div className="detail-muted">系统下载目录：{runtimeInfo?.downloadsPath ?? "--"}</div>
              <div className="detail-muted">状态文件：{runtimeInfo?.dataPath ?? "--"}</div>
              <button
                type="button"
                className="command-button secondary"
                onClick={() => {
                  void desktopBridge.openPath(settings.downloadDirectory);
                }}
                disabled={!settings.downloadDirectory}
              >
                <FolderOpen size={16} />
                <span>打开当前下载目录</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderNetworkSection() {
    const draftBypassCount = settingsDraft.proxyBypassList
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean).length;
    const savedBypassCount = settings.proxyBypassList
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean).length;
    const isProxyEnabled = settingsDraft.proxyEnabled;
    const isCustomProxyMode = settingsDraft.networkRouteMode === "customProxy";
    const isBuiltInProxyMode = settingsDraft.networkRouteMode === "builtInProxy";

    const routeOptions: Array<{
      value: AppSettings["networkRouteMode"];
      label: string;
    }> = [
      { value: "systemProxy", label: "跟随系统" },
      { value: "builtInProxy", label: "Game++内置代理" },
      { value: "customProxy", label: "自定义代理" },
    ];

    return (
      <div className="section-stack">
        <div className="double-grid">
          <section className="surface-panel">
            <div className="panel-header">
              <span>网络请求</span>
              <Link2 size={16} />
            </div>

            <div className="settings-stack">
              <div className="detail-muted">
                在这里统一维护代理开关、代理模式与请求重试策略。保存后，新发起的 Nexus API 请求和本地下载都会使用最新网络配置。
              </div>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={settingsDraft.proxyEnabled}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      proxyEnabled: event.target.checked,
                    }))
                  }
                />
                <span>启动代理</span>
              </label>

              <label className="field">
                <span>代理模式</span>
                <div className="feed-switch route-switch">
                  {routeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`segment${
                        settingsDraft.networkRouteMode === option.value ? " active" : ""
                      }`}
                      onClick={() =>
                        setSettingsDraft((current) => ({
                          ...current,
                          networkRouteMode: option.value,
                        }))
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </label>

              {isCustomProxyMode ? (
                <label className="field">
                  <span>代理 URL</span>
                  <input
                    value={settingsDraft.proxyUrl}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        proxyUrl: event.target.value,
                      }))
                    }
                    placeholder="http://127.0.0.1:7890"
                  />
                </label>
              ) : null}

              <div className="detail-muted field-note">
                {!isProxyEnabled
                  ? "当前代理已关闭，请求会以直连方式发起；代理模式会作为下次启动代理时的预设。"
                  : isCustomProxyMode
                    ? "当前为自定义代理模式，保存后新的请求会通过上面的代理地址发起。支持 http://、https:// 和 socks://。"
                    : isBuiltInProxyMode
                      ? "Game++内置代理的入口列表后续将从你的服务端接口获取，这里先保留模式入口。"
                      : "当前为跟随系统模式，保存后会优先使用系统代理设置。"}
              </div>

              <div className="settings-grid network-grid">
                <label className="field compact-field">
                  <span>请求重试次数</span>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={settingsDraft.requestRetryCount}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        requestRetryCount: Number.parseInt(event.target.value || "0", 10),
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>当前代理状态</span>
                  <div className="detail-muted field-note">
                    {settingsDraft.proxyEnabled
                      ? `已启动 · ${getNetworkRouteLabel(settingsDraft.networkRouteMode)}`
                      : "已关闭"}
                  </div>
                </label>
              </div>

              <label className="field">
                <span>代理绕过列表</span>
                <textarea
                  rows={4}
                  value={settingsDraft.proxyBypassList}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      proxyBypassList: event.target.value,
                    }))
                  }
                  placeholder={"api.nexusmods.com\nnexusmods.com"}
                />
              </label>

              <div className="command-row">
                <button
                  type="button"
                  className="command-button"
                  onClick={() => {
                    void handleSaveNetworkSettings();
                  }}
                  disabled={settingsBusy || !networkSettingsDirty}
                >
                  <Save size={16} />
                  <span>保存网络配置</span>
                </button>

                <button
                  type="button"
                  className="command-button secondary"
                  onClick={() => resetDraftSection("network")}
                  disabled={settingsBusy || !networkSettingsDirty}
                >
                  <RefreshCw size={16} />
                  <span>恢复当前配置</span>
                </button>
              </div>
            </div>
          </section>

          <section className="surface-panel">
            <div className="panel-header">
              <span>生效摘要</span>
              <CheckCircle2 size={16} />
            </div>

            <div className="meta-grid">
              <div className="meta-tile">
                <span>代理状态</span>
                <strong>{settings.proxyEnabled ? "已启动" : "已关闭"}</strong>
              </div>
              <div className="meta-tile">
                <span>代理模式</span>
                <strong>{getNetworkRouteLabel(settings.networkRouteMode)}</strong>
              </div>
              <div className="meta-tile">
                <span>代理目标</span>
                <strong>
                  {settings.networkRouteMode === "customProxy"
                    ? settings.proxyUrl || "--"
                    : settings.networkRouteMode === "builtInProxy"
                      ? "服务端入口列表"
                      : "系统代理"}
                </strong>
              </div>
              <div className="meta-tile">
                <span>请求重试次数</span>
                <strong>{settings.requestRetryCount}</strong>
              </div>
              <div className="meta-tile">
                <span>绕过条目</span>
                <strong>{savedBypassCount}</strong>
              </div>
            </div>

            <div className="stack">
              <div className="detail-muted">
                代理开关、模式与绕过规则会保存在当前电脑上，方便后续为更多下载源复用同一套网络策略。
              </div>
              {networkSettingsDirty ? (
                <span className="badge-soft warn">
                  当前有未保存的网络变更，摘要区域显示的是已经生效的配置。
                </span>
              ) : null}
              {settingsDraft.proxyEnabled && isCustomProxyMode && !settingsDraft.proxyUrl.trim() ? (
                <span className="badge-soft warn">当前已选择自定义代理，但还没有填写代理 URL。</span>
              ) : settingsDraft.proxyEnabled && isBuiltInProxyMode ? (
                <span className="badge-soft warn">
                  Game++内置代理的入口列表后续需要从你的服务端接口获取，当前先保留模式与开关。
                </span>
              ) : !settingsDraft.proxyEnabled ? (
                <span className="badge-soft info">代理当前未启动，网络请求会直接连接。</span>
              ) : (
                <span className="badge-soft info">
                  当前将以“{getNetworkRouteLabel(settingsDraft.networkRouteMode)}”作为代理入口。
                </span>
              )}
              <div className="detail-muted">当前草稿中的绕过条目数：{draftBypassCount}</div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderAccountSection() {
    return (
      <div className="section-stack">
        <div className="double-grid">
          <section className="surface-panel">
            <div className="panel-header">
              <span>账号状态</span>
              {auth?.connected ? <BadgeCheck size={16} /> : <ShieldCheck size={16} />}
            </div>

            {auth?.connected && auth.user ? (
              <div className="stack">
                <div className="account-row">
                  <img className="avatar avatar-large" src={auth.user.profileUrl} alt={auth.user.name} />
                  <div>
                    <strong>{auth.user.name}</strong>
                    <p>{auth.user.isPremium ? "Premium 账号" : "标准账号"}</p>
                  </div>
                </div>

                <div className="chip-row">
                  <span className="tag">{auth.source === "sso" ? "SSO" : "API Key"}</span>
                  <span className="tag">{auth.user.isSupporter ? "Supporter" : "Standard"}</span>
                  <span className="tag">{auth.user.email}</span>
                </div>

                <div className="command-row">
                  <button
                    type="button"
                    className="command-button secondary"
                    onClick={() => setSelectedNav("downloads")}
                  >
                    <History size={16} />
                    <span>去“下载管理”</span>
                  </button>

                  <button
                    type="button"
                    className="command-button secondary"
                    onClick={() => {
                      void handleLogout();
                    }}
                    disabled={authBusy}
                  >
                    <LogOut size={16} />
                    <span>断开连接</span>
                  </button>
                </div>
              </div>
            ) : (
              renderLoginFields()
            )}
          </section>

          <section className="surface-panel">
            <div className="panel-header">
              <span>连接信息</span>
              <KeyRound size={16} />
            </div>

            <div className="stack">
              <div className="meta-grid">
                <div className="meta-tile">
                  <span>连接来源</span>
                  <strong>{auth?.connected ? (auth.source === "sso" ? "SSO" : "API Key") : "未连接"}</strong>
                </div>
                <div className="meta-tile">
                  <span>账号类型</span>
                  <strong>
                    {auth?.connected && auth.user
                      ? auth.user.isPremium
                        ? "Premium"
                        : "Standard"
                      : "--"}
                  </strong>
                </div>
                <div className="meta-tile">
                  <span>SSO 可用</span>
                  <strong>{auth?.appIdAvailable ? "已启用" : "未配置"}</strong>
                </div>
                <div className="meta-tile">
                  <span>当前会话</span>
                  <strong>{ssoSession?.status ?? (auth?.connected ? "connected" : "idle")}</strong>
                </div>
              </div>

              <div className="detail-muted">
                API Key 或 SSO 会话只保存在当前电脑，本应用不会通过公网服务代存你的账号凭据。
              </div>

              <button
                type="button"
                className="command-button secondary"
                onClick={() => setSelectedNav("settings")}
              >
                <Settings2 size={16} />
                <span>去“配置”查看应用设置</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderDownloadsSection() {
    const completedCount = downloadState.queue.filter((item) => item.status === "completed").length;
    const awaitingBrowserItems = downloadState.queue.filter((item) => item.status === "awaitingBrowser");
    const awaitingBrowserCount = awaitingBrowserItems.length;
    const latestAwaitingBrowserItem =
      awaitingBrowserItems.find((item) => Boolean(item.browserPageUrl)) ?? null;

    return (
      <div className="section-stack">
        <section className="surface-panel">
          <div className="panel-header">
            <span>下载目录</span>
            <button
              type="button"
              className="command-button secondary compact"
              onClick={() => setSelectedNav("settings")}
            >
              <Settings2 size={16} />
              <span>前往配置</span>
            </button>
          </div>

          <div className="detail-muted">
            {settings.downloadDirectory || "请先到“配置”中设置下载目录。"}
          </div>
        </section>

        <section className="surface-panel">
          <div className="info-grid">
            <div className="info-card">
              <span>活动下载</span>
              <strong>{activeTransfers}</strong>
            </div>
            <div className="info-card">
              <span>等待网页回调</span>
              <strong>{awaitingBrowserCount}</strong>
            </div>
            <div className="info-card">
              <span>已完成</span>
              <strong>{completedCount}</strong>
            </div>
            <div className="info-card">
              <span>协议回调</span>
              <strong>{downloadState.recentNxmLinks.length}</strong>
            </div>
          </div>
        </section>

        {awaitingBrowserCount > 0 ? (
          <section className="surface-panel">
            <div className="panel-header">
              <span>网页回调指引</span>
              <Link2 size={16} />
            </div>

            <div className="stack">
              <span className="badge-soft warn">
                当前有 {awaitingBrowserCount} 个任务在等待网页触发 nxm:// 回调
              </span>
              <div className="detail-muted">
                请在已经打开的 Nexus 文件页中点击 Mod Manager Download 或 Download with Manager，不要点击浏览器直接下载。
              </div>
              {!runtimeInfo?.protocolRegistered ? (
                <div className="detail-muted">
                  当前系统还没有把 nxm:// 默认交给这个应用。先去「配置」里重新注册协议，再回到网页重试会更稳。
                </div>
              ) : null}
              <div className="command-row">
                <button
                  type="button"
                  className="command-button secondary"
                  onClick={() => setSelectedNav("settings")}
                >
                  <Settings2 size={16} />
                  <span>前往配置</span>
                </button>

                <button
                  type="button"
                  className="command-button secondary"
                  onClick={() => {
                    if (latestAwaitingBrowserItem?.browserPageUrl) {
                      void desktopBridge.openExternal(latestAwaitingBrowserItem.browserPageUrl);
                    }
                  }}
                  disabled={!latestAwaitingBrowserItem?.browserPageUrl}
                >
                  <ExternalLink size={16} />
                  <span>重新打开 Nexus 页面</span>
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <div className="double-grid">
          <section className="surface-panel">
            <div className="panel-header">
              <span>下载队列</span>
              <Clock3 size={16} />
            </div>
            {renderQueueList(8)}
          </section>

          <section className="surface-panel">
            <div className="panel-header">
              <span>下载历史</span>
              <History size={16} />
            </div>
            {renderHistoryList(10)}
          </section>
        </div>

        <section className="surface-panel">
          <div className="panel-header">
            <span>协议回调</span>
            <Link2 size={16} />
          </div>
          {renderProtocolList(10)}
        </section>
      </div>
    );
  }

  function renderSection() {
    if (selectedNav === "mods") {
      return renderModsSection();
    }

    if (selectedNav === "games") {
      return renderGamesSection();
    }

    if (selectedNav === "settings") {
      return renderSettingsSection();
    }

    if (selectedNav === "network") {
      return renderNetworkSection();
    }

    if (selectedNav === "account") {
      return renderAccountSection();
    }

    return renderDownloadsSection();
  }

  return (
    <div className="app-shell">
      <aside className="nav-rail">
        <div className="nav-brand">
          <div className="brand-mark">
            <img src={appLogo} alt="Game++" className="brand-logo" />
          </div>
          <div>
            <div className="brand-copy">
              <span className="brand-subtitle">游戏管理工作台</span>
              <h1>Game++</h1>
            </div>
            <p className="eyebrow">桌面工作台</p>
            <h1>Nexus 中继站</h1>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = selectedNav === item.key;

            return (
              <button
                key={item.key}
                type="button"
                className={`nav-item${active ? " active" : ""}`}
                onClick={() => setSelectedNav(item.key)}
              >
                <Icon size={18} />
                <span className="nav-text">
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="nav-footer">
          <span className="nav-foot-tag">
            {runtimeInfo?.protocolRegistered ? "nxm 已接管" : "nxm 未注册"}
          </span>
          <span className="nav-foot-tag">{auth?.connected ? "账号已连接" : "未连接账号"}</span>
        </div>
      </aside>

      <div className="workspace-shell">
        {selectedNav === "mods" ? null : (
          <header className="workspace-header">
            <div className="header-copy">
              <p className="eyebrow">功能导航</p>
              <h2>{activeNav.label}</h2>
              <p>{activeNav.hint}</p>
            </div>

            <div className="header-tags">
              <span className="tag">{runtimeInfo?.shell === "electron" ? "Electron" : "预览"}</span>
              <span className="tag">{activeTransfers} 个活动下载</span>
              <span className="tag">{downloadState.queue.length} 个队列项</span>
            </div>
          </header>
        )}

        <div className="status-strip">
          {statusMessage ? (
            <div className="status-pill ok">
              <Sparkles size={16} />
              <span>{statusMessage}</span>
            </div>
          ) : null}
          {errorMessage ? (
            <div className="status-pill error">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          ) : null}
        </div>

        <div className="section-body">{renderSection()}</div>
      </div>
    </div>
  );
}
