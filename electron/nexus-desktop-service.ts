import "dotenv/config";
import { app, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  AppSettings,
  AppSettingsInput,
  AuthSource,
  AuthStatusResponse,
  DesktopRuntimeInfo,
  DownloadDispatchRequest,
  DownloadDispatchResult,
  DownloadHistoryAction,
  DownloadHistoryEntry,
  NetworkRouteMode,
  DownloadQueueItem,
  DownloadQueueStatus,
  DownloadStateResponse,
  NxmLinkEvent,
  NxmLinkPayload,
  NexusUser,
  SsoSessionResponse,
} from "../shared/contracts";
import { createNexusClient } from "../server/nexus";
import { consumeAuthorizedSsoSession, createSsoSession, getSsoSession } from "../server/sso";
import { DownloadAbortError, downloadToFile } from "./local-download";
import { createDispatcherForRequest } from "./network-routing";
import { parseNxmLink } from "./nxm-link";
import {
  DesktopPersistence,
  type PersistedDownloadQueueItem,
  type RestoredAuthSession,
} from "./persistence";

interface AuthSession {
  apiKey: string;
  source: AuthSource;
  user: NexusUser;
}

interface ActiveDownloadTask {
  controller: AbortController;
}

const MAX_QUEUE_ITEMS = 24;
const MAX_HISTORY_ITEMS = 80;
const MAX_NXM_EVENTS = 16;

export class DesktopServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopServiceError";
  }
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof DesktopServiceError || error instanceof Error) {
    return error.message;
  }

  return "桌面服务发生了未预期错误。";
}

function isPlaceholderModName(name: string) {
  return /^Mod #\d+$/i.test(name);
}

function clampConcurrentDownloads(value: number) {
  return Math.min(Math.max(Math.round(value), 1), 4);
}

function clampRequestRetryCount(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 6);
}

function normalizeNetworkRouteMode(value: string | undefined): NetworkRouteMode {
  switch (value) {
    case "systemProxy":
    case "builtInProxy":
    case "customProxy":
      return value;
    default:
      return "systemProxy";
  }
}

function normalizeProxyEnabled(value: boolean | undefined) {
  return Boolean(value);
}

function normalizeProxyUrl(value: string | undefined) {
  return value?.trim() ?? "";
}

function isValidProxyUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "socks:", "socks4:", "socks5:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function normalizeProxyBypassList(value: string | undefined) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeQueueStatus(
  status: string | undefined,
  requiresBrowser: boolean,
): DownloadQueueStatus {
  switch (status) {
    case "queued":
    case "resolving":
    case "awaitingBrowser":
    case "downloading":
    case "paused":
    case "completed":
    case "failed":
      return status;
    case "dispatching":
      return "queued";
    case "externalOpened":
      return requiresBrowser ? "awaitingBrowser" : "paused";
    case "nxmReceived":
      return "paused";
    default:
      return requiresBrowser ? "awaitingBrowser" : "paused";
  }
}

function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
  const withoutTrailingDots = cleaned.replace(/[. ]+$/g, "");
  return withoutTrailingDots || "download.bin";
}

function splitFileName(fileName: string) {
  const extension = path.extname(fileName);
  return {
    baseName: extension ? fileName.slice(0, -extension.length) : fileName,
    extension,
  };
}

function stripInternalQueueItem(item: PersistedDownloadQueueItem): DownloadQueueItem {
  const { rawNxmUrl: _rawNxmUrl, nxmKey: _nxmKey, ...publicItem } = item;
  return publicItem;
}

function normalizePersistedQueueItem(item: PersistedDownloadQueueItem): PersistedDownloadQueueItem {
  const requiresBrowser = Boolean(item.requiresBrowser ?? item.browserPageUrl);

  return {
    ...item,
    strategy: item.strategy ?? (requiresBrowser ? "browser" : "direct"),
    status: normalizeQueueStatus(item.status, requiresBrowser),
    requiresBrowser,
    isResumable: item.isResumable ?? true,
    progress: {
      bytesTransferred: item.progress?.bytesTransferred ?? 0,
      totalBytes: item.progress?.totalBytes,
      percent: item.progress?.percent,
      speedBytesPerSecond: item.progress?.speedBytesPerSecond,
    },
  };
}

function buildBrowserPageUrl(request: DownloadDispatchRequest) {
  const url = new URL(`https://www.nexusmods.com/${request.gameDomain}/mods/${request.modId}`);
  url.searchParams.set("tab", "files");

  if (request.fileId) {
    url.searchParams.set("file_id", String(request.fileId));
  }

  return url.toString();
}

export class NexusDesktopService {
  private readonly displayAppName = process.env.NEXUS_PROXY_UI_NAME?.trim() || "Game++";
  private readonly requestAppName =
    process.env.NEXUS_PROXY_API_NAME?.trim() || "GamePlusPlusDesktop";
  private readonly nexusAppId = process.env.NEXUS_APP_ID?.trim();
  private readonly appVersion = app.getVersion();
  private readonly protocolVersion = "1.1.5";
  private readonly persistence = new DesktopPersistence();
  private readonly activeDownloads = new Map<string, ActiveDownloadTask>();
  private authSession: AuthSession | null;
  private settings: AppSettings;
  private downloadQueue: PersistedDownloadQueueItem[];
  private downloadHistory: DownloadHistoryEntry[];
  private recentNxmLinks: NxmLinkEvent[];

  private readonly nexusClient = createNexusClient({
    appName: this.requestAppName,
    appVersion: this.appVersion,
    protocolVersion: this.protocolVersion,
    getRequestRetryCount: () => this.settings.requestRetryCount,
    getDispatcherForUrl: (url) => createDispatcherForRequest(url, this.settings),
  });

  constructor() {
    const persistedState = this.persistence.load();
    const restoredAuth = this.persistence.restoreAuthSession(persistedState.authSession);

    this.authSession = restoredAuth ? this.toAuthSession(restoredAuth) : null;
    this.settings = {
      ...persistedState.settings,
      maxConcurrentDownloads: clampConcurrentDownloads(persistedState.settings.maxConcurrentDownloads),
      proxyEnabled: normalizeProxyEnabled(persistedState.settings.proxyEnabled),
      requestRetryCount: clampRequestRetryCount(persistedState.settings.requestRetryCount),
      networkRouteMode: normalizeNetworkRouteMode(persistedState.settings.networkRouteMode),
      proxyUrl: normalizeProxyUrl(persistedState.settings.proxyUrl),
      proxyBypassList: normalizeProxyBypassList(persistedState.settings.proxyBypassList),
    };
    this.downloadQueue = persistedState.queue
      .slice(0, MAX_QUEUE_ITEMS)
      .map(normalizePersistedQueueItem);
    this.downloadHistory = persistedState.history.slice(0, MAX_HISTORY_ITEMS);
    this.recentNxmLinks = persistedState.recentNxmLinks.slice(0, MAX_NXM_EVENTS);

    this.persistence.ensureDirectory(this.settings.downloadDirectory);
    this.recoverQueueAfterRestart();
  }

  getRuntimeInfo(protocolRegistered: boolean): DesktopRuntimeInfo {
    return {
      shell: "electron",
      appName: this.displayAppName,
      appVersion: this.appVersion,
      platform: process.platform,
      protocolRegistered,
      downloadsPath: app.getPath("downloads"),
      dataPath: this.persistence.getFilePath(),
    };
  }

  getAuthStatus(): AuthStatusResponse {
    return {
      connected: Boolean(this.authSession),
      source: this.authSession?.source,
      user: this.authSession?.user,
      appIdAvailable: Boolean(this.nexusAppId),
      appName: this.displayAppName,
    };
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  async selectDownloadDirectory(): Promise<AppSettings> {
    const selection = await dialog.showOpenDialog({
      title: "选择下载目录",
      defaultPath: this.settings.downloadDirectory,
      properties: ["openDirectory", "createDirectory"],
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return this.getSettings();
    }

    return this.updateSettings({
      downloadDirectory: selection.filePaths[0],
    });
  }

  async updateSettings(input: AppSettingsInput): Promise<AppSettings> {
    const nextSettings: AppSettings = {
      ...this.settings,
      ...input,
    };

    if (!nextSettings.downloadDirectory.trim()) {
      throw new DesktopServiceError("下载目录不能为空。");
    }

    nextSettings.maxConcurrentDownloads = clampConcurrentDownloads(nextSettings.maxConcurrentDownloads);
    nextSettings.proxyEnabled = normalizeProxyEnabled(nextSettings.proxyEnabled);
    nextSettings.requestRetryCount = clampRequestRetryCount(nextSettings.requestRetryCount);
    nextSettings.networkRouteMode = normalizeNetworkRouteMode(nextSettings.networkRouteMode);
    nextSettings.proxyUrl = normalizeProxyUrl(nextSettings.proxyUrl);
    nextSettings.proxyBypassList = normalizeProxyBypassList(nextSettings.proxyBypassList);

    if (
      nextSettings.proxyEnabled &&
      nextSettings.networkRouteMode === "customProxy" &&
      !nextSettings.proxyUrl
    ) {
      throw new DesktopServiceError("启用自定义代理时，代理 URL 不能为空。");
    }

    if (nextSettings.proxyUrl && !isValidProxyUrl(nextSettings.proxyUrl)) {
      throw new DesktopServiceError(
        "代理 URL 格式无效，请使用 http://、https://、socks://、socks4:// 或 socks5:// 地址。",
      );
    }

    this.persistence.ensureDirectory(nextSettings.downloadDirectory);
    this.settings = nextSettings;
    this.persistState();

    void this.processQueue();
    return this.getSettings();
  }

  getDownloadState(): DownloadStateResponse {
    return {
      queue: this.downloadQueue.map(stripInternalQueueItem),
      history: [...this.downloadHistory],
      recentNxmLinks: [...this.recentNxmLinks],
    };
  }

  async connectWithApiKey(apiKey: string): Promise<AuthStatusResponse> {
    const normalizedKey = apiKey.trim();

    if (!normalizedKey) {
      throw new DesktopServiceError("请输入有效的 Nexus API Key。");
    }

    const user = await this.nexusClient.validateApiKey(normalizedKey);
    this.authSession = {
      apiKey: normalizedKey,
      source: "manual",
      user,
    };
    this.persistState();
    void this.processQueue();

    return this.getAuthStatus();
  }

  async startSsoLogin(): Promise<SsoSessionResponse> {
    if (!this.nexusAppId) {
      throw new DesktopServiceError("尚未配置 NEXUS_APP_ID，暂时无法启用 SSO。");
    }

    const session = await createSsoSession(this.nexusAppId, this.nexusClient.validateApiKey);
    await shell.openExternal(session.loginUrl);
    return session;
  }

  async pollSsoSession(id: string): Promise<SsoSessionResponse> {
    const session = getSsoSession(id);

    if (!session) {
      throw new DesktopServiceError("SSO 会话不存在或已经过期。");
    }

    if (session.status === "authorized") {
      const authorizedSession = consumeAuthorizedSsoSession(id);

      if (!authorizedSession) {
        throw new DesktopServiceError("SSO 会话已经失效。");
      }

      this.authSession = {
        apiKey: authorizedSession.apiKey,
        source: "sso",
        user: authorizedSession.user,
      };
      this.persistState();
      void this.processQueue();

      return {
        ...session,
        user: authorizedSession.user,
      };
    }

    return session;
  }

  async logout(): Promise<void> {
    this.authSession = null;
    this.persistState();
  }

  async getGames() {
    const auth = this.requireAuth();
    return this.nexusClient.getGames(auth.apiKey);
  }

  async getGameOverview(gameDomain: string) {
    const auth = this.requireAuth();
    return this.nexusClient.getGameOverview(auth.apiKey, gameDomain);
  }

  async getModDetail(gameDomain: string, modId: number) {
    const auth = this.requireAuth();
    return this.nexusClient.getModDetail(auth.apiKey, gameDomain, modId);
  }

  async dispatchDownload(request: DownloadDispatchRequest): Promise<DownloadDispatchResult> {
    const auth = this.requireAuth();
    const now = new Date().toISOString();
    const browserPageUrl = auth.user.isPremium ? undefined : buildBrowserPageUrl(request);

    const queueItem = this.pushQueueItem({
      id: createId("queue"),
      source: "app",
      strategy: auth.user.isPremium ? "direct" : "browser",
      status: auth.user.isPremium ? "queued" : "awaitingBrowser",
      requestedAt: now,
      updatedAt: now,
      gameDomain: request.gameDomain,
      modId: request.modId,
      fileId: request.fileId,
      modName: request.modName?.trim() || `Mod #${request.modId}`,
      fileName: request.fileName?.trim() || undefined,
      message: auth.user.isPremium
        ? "已加入下载队列，准备开始本地下载。"
        : "已打开 Nexus 文件页，等待网页触发 nxm:// 回调。",
      browserPageUrl,
      requiresBrowser: !auth.user.isPremium,
      isResumable: true,
      progress: {
        bytesTransferred: 0,
      },
    });

    const dispatchedItem = auth.user.isPremium
      ? queueItem
      : this.patchQueueItem(queueItem.id, {
          browserPageUrl,
          message:
            "已打开 Nexus 文件页，请在网页中点击 Mod Manager Download（不要点浏览器直接下载）来触发 nxm:// 回调。",
        });

    this.pushHistoryEntry(dispatchedItem, "requested", dispatchedItem.browserPageUrl);

    if (!auth.user.isPremium && dispatchedItem.browserPageUrl) {
      await shell.openExternal(dispatchedItem.browserPageUrl);
      this.pushHistoryEntry(dispatchedItem, "browserOpened", dispatchedItem.browserPageUrl);
    } else {
      void this.processQueue();
    }

    return {
      strategy: dispatchedItem.strategy,
      opened: Boolean(dispatchedItem.browserPageUrl),
      target: dispatchedItem.browserPageUrl,
      message: dispatchedItem.message,
      queueItem: stripInternalQueueItem(dispatchedItem),
    };
  }

  pauseDownload(downloadId: string): DownloadStateResponse {
    const item = this.getQueueItem(downloadId);

    if (!item) {
      throw new DesktopServiceError("找不到对应的下载任务。");
    }

    if (item.status === "completed") {
      throw new DesktopServiceError("这个下载已经完成，不需要暂停。");
    }

    const activeTask = this.activeDownloads.get(downloadId);

    if (activeTask) {
      this.patchQueueItem(downloadId, {
        status: "paused",
        message: "下载已暂停，可继续续传。",
      });
      this.pushHistoryEntry(this.getQueueItemOrThrow(downloadId), "paused");
      activeTask.controller.abort();
    } else if (item.status === "queued" || item.status === "failed") {
      this.patchQueueItem(downloadId, {
        status: "paused",
        message: "下载已暂停，可继续续传。",
      });
      this.pushHistoryEntry(this.getQueueItemOrThrow(downloadId), "paused");
    }

    return this.getDownloadState();
  }

  resumeDownload(downloadId: string): DownloadStateResponse {
    const item = this.getQueueItem(downloadId);

    if (!item) {
      throw new DesktopServiceError("找不到对应的下载任务。");
    }

    if (item.status === "completed") {
      throw new DesktopServiceError("这个下载已经完成。");
    }

    if (item.status === "awaitingBrowser" && !item.rawNxmUrl) {
      throw new DesktopServiceError("当前任务还在等待网页回调，请先完成 Nexus 页面上的下载触发。");
    }

    this.patchQueueItem(downloadId, {
      status: "queued",
      message: item.progress.bytesTransferred > 0 ? "准备继续下载。" : "准备开始下载。",
    });
    this.pushHistoryEntry(this.getQueueItemOrThrow(downloadId), "resumed");
    void this.processQueue();

    return this.getDownloadState();
  }

  async openPath(targetPath: string) {
    const error = await shell.openPath(targetPath);

    if (error) {
      throw new DesktopServiceError(error);
    }
  }

  recordNxmLink(url: string): NxmLinkEvent {
    const parsed = parseNxmLink(url);
    const matchedQueueId = this.captureNxmIntoQueue(parsed.event.parsed, parsed.secret);

    const event: NxmLinkEvent = {
      ...parsed.event,
      matchedQueueId,
    };

    this.recentNxmLinks = [event, ...this.recentNxmLinks].slice(0, MAX_NXM_EVENTS);
    this.persistState();

    if (matchedQueueId && this.settings.autoStartOnNxm) {
      void this.processQueue();
    }

    return event;
  }

  private toAuthSession(session: RestoredAuthSession): AuthSession {
    return {
      apiKey: session.apiKey,
      source: session.source,
      user: session.user,
    };
  }

  private persistState() {
    this.persistence.save({
      version: 2,
      settings: this.settings,
      authSession: this.authSession
        ? this.persistence.createPersistedAuthSession(this.authSession)
        : null,
      queue: this.downloadQueue,
      history: this.downloadHistory,
      recentNxmLinks: this.recentNxmLinks,
    });
  }

  private recoverQueueAfterRestart() {
    let changed = false;

    this.downloadQueue = this.downloadQueue.map((item) => {
      if (item.status === "downloading" || item.status === "resolving") {
        changed = true;
        return {
          ...item,
          status: this.authSession && this.settings.autoResumeInterrupted ? "queued" : "paused",
          message: this.authSession && this.settings.autoResumeInterrupted
            ? "应用已恢复，准备继续下载。"
            : "应用已重新启动，可继续续传。",
        };
      }

      return item;
    });

    if (changed) {
      this.persistState();
    }

    if (this.authSession && this.settings.autoResumeInterrupted) {
      void this.processQueue();
    }
  }

  private requireAuth(): AuthSession {
    if (!this.authSession) {
      throw new DesktopServiceError("请先连接 Nexus 账号。");
    }

    return this.authSession;
  }

  private getQueueItem(id: string) {
    return this.downloadQueue.find((entry) => entry.id === id);
  }

  private getQueueItemOrThrow(id: string) {
    const item = this.getQueueItem(id);

    if (!item) {
      throw new DesktopServiceError("下载队列项不存在。");
    }

    return item;
  }

  private pushQueueItem(item: PersistedDownloadQueueItem) {
    this.downloadQueue = [item, ...this.downloadQueue.filter((entry) => entry.id !== item.id)].slice(
      0,
      MAX_QUEUE_ITEMS,
    );
    this.persistState();
    return item;
  }

  private patchQueueItem(
    id: string,
    patch: Partial<Omit<PersistedDownloadQueueItem, "id" | "requestedAt">>,
  ) {
    const existing = this.getQueueItem(id);

    if (!existing) {
      throw new DesktopServiceError("下载队列项不存在。");
    }

    const nextItem: PersistedDownloadQueueItem = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.downloadQueue = [nextItem, ...this.downloadQueue.filter((entry) => entry.id !== id)].slice(
      0,
      MAX_QUEUE_ITEMS,
    );
    this.persistState();
    return nextItem;
  }

  private pushHistoryEntry(
    item: PersistedDownloadQueueItem,
    action: DownloadHistoryAction,
    target?: string,
  ) {
    const entry: DownloadHistoryEntry = {
      id: createId("history"),
      queueItemId: item.id,
      recordedAt: new Date().toISOString(),
      action,
      strategy: item.strategy,
      status: item.status,
      gameDomain: item.gameDomain,
      modId: item.modId,
      fileId: item.fileId,
      modName: item.modName,
      fileName: item.fileName,
      message: item.message,
      target,
    };

    this.downloadHistory = [entry, ...this.downloadHistory].slice(0, MAX_HISTORY_ITEMS);
    this.persistState();
  }

  private captureNxmIntoQueue(
    payload: NxmLinkPayload | undefined,
    secret: { rawUrl: string; key?: string } | undefined,
  ) {
    if (!payload?.modId) {
      return undefined;
    }

    const matchingItem = this.downloadQueue.find((item) => {
      if (item.gameDomain !== payload.gameDomain || item.modId !== payload.modId) {
        return false;
      }

      if (payload.fileId && item.fileId && payload.fileId !== item.fileId) {
        return false;
      }

      return item.status === "awaitingBrowser" || item.status === "paused" || item.status === "failed";
    });

    const nextStatus: DownloadQueueStatus =
      this.settings.autoStartOnNxm && this.authSession ? "queued" : "paused";

    if (matchingItem) {
      const updatedItem = this.patchQueueItem(matchingItem.id, {
        strategy: "nxm",
        status: nextStatus,
        fileId: payload.fileId ?? matchingItem.fileId,
        nxm: payload,
        rawNxmUrl: secret?.rawUrl,
        nxmKey: secret?.key,
        requiresBrowser: false,
        message:
          nextStatus === "queued"
            ? "已收到 nxm:// 回调，准备开始本地下载。"
            : "已收到 nxm:// 回调，随时可以继续下载。",
      });

      this.pushHistoryEntry(updatedItem, "nxmReceived");
      return updatedItem.id;
    }

    const now = new Date().toISOString();
    const item = this.pushQueueItem({
      id: createId("queue"),
      source: "nxm",
      strategy: "nxm",
      status: nextStatus,
      requestedAt: now,
      updatedAt: now,
      gameDomain: payload.gameDomain,
      modId: payload.modId,
      fileId: payload.fileId,
      modName: `Mod #${payload.modId}`,
      message:
        nextStatus === "queued"
          ? "检测到独立的 nxm:// 回调，准备开始下载。"
          : "检测到独立的 nxm:// 回调，已加入可恢复队列。",
      requiresBrowser: false,
      isResumable: true,
      progress: {
        bytesTransferred: 0,
      },
      nxm: payload,
      rawNxmUrl: secret?.rawUrl,
      nxmKey: secret?.key,
    });

    this.pushHistoryEntry(item, "nxmReceived");
    return item.id;
  }

  private async processQueue() {
    if (!this.authSession) {
      return;
    }

    while (this.activeDownloads.size < this.settings.maxConcurrentDownloads) {
      const nextItem = this.downloadQueue.find(
        (item) => item.status === "queued" && !this.activeDownloads.has(item.id),
      );

      if (!nextItem) {
        return;
      }

      this.startDownload(nextItem.id);
    }
  }

  private startDownload(downloadId: string) {
    const item = this.getQueueItem(downloadId);

    if (!item || this.activeDownloads.has(downloadId)) {
      return;
    }

    const controller = new AbortController();
    this.activeDownloads.set(downloadId, { controller });

    void this.runDownload(downloadId, controller).finally(() => {
      this.activeDownloads.delete(downloadId);
      void this.processQueue();
    });
  }

  private async runDownload(downloadId: string, controller: AbortController) {
    try {
      let item = this.patchQueueItem(downloadId, {
        status: "resolving",
        message: "正在解析下载地址和文件信息。",
      });

      const resolved = await this.resolveDownloadContext(item);
      item = this.patchQueueItem(downloadId, {
        ...resolved.itemPatch,
        status: "downloading",
        message: "正在下载到本地目录。",
        filePath: resolved.destinationPath,
      });

      this.pushHistoryEntry(item, "resolved", resolved.destinationPath);
      this.pushHistoryEntry(item, "started", resolved.destinationPath);

      const result = await downloadToFile({
        url: resolved.downloadUrl,
        destinationPath: resolved.destinationPath,
        signal: controller.signal,
        retryCount: this.settings.requestRetryCount,
        getDispatcherForUrl: (url) => createDispatcherForRequest(url, this.settings),
        onProgress: (progress) => {
          const current = this.getQueueItem(downloadId);

          if (!current || current.status === "paused") {
            return;
          }

          this.patchQueueItem(downloadId, {
            status: "downloading",
            progress,
            message: progress.percent
              ? `正在下载，已完成 ${progress.percent.toFixed(1)}%。`
              : "正在下载，正在统计大小。",
          });
        },
      });

      const finalPath = this.finalizeDownloadedFile(resolved.destinationPath, result.tempPath);
      const completedItem = this.patchQueueItem(downloadId, {
        status: "completed",
        filePath: finalPath,
        progress: {
          bytesTransferred: result.bytesTransferred,
          totalBytes: result.totalBytes,
          percent: result.totalBytes ? 100 : undefined,
          speedBytesPerSecond: 0,
        },
        message: "下载完成，文件已经保存到本地目录。",
      });

      this.pushHistoryEntry(completedItem, "completed", finalPath);
    } catch (error) {
      if (error instanceof DownloadAbortError || controller.signal.aborted) {
        const current = this.getQueueItem(downloadId);

        if (current && current.status !== "paused") {
          const pausedItem = this.patchQueueItem(downloadId, {
            status: "paused",
            message: "下载已暂停，可继续续传。",
          });
          this.pushHistoryEntry(pausedItem, "paused", pausedItem.filePath);
        }

        return;
      }

      const failedItem = this.patchQueueItem(downloadId, {
        status: "failed",
        message: normalizeErrorMessage(error),
      });
      this.pushHistoryEntry(failedItem, "failed", failedItem.filePath);
    }
  }

  private async resolveDownloadContext(item: PersistedDownloadQueueItem) {
    const auth = this.requireAuth();
    let modName = item.modName;
    let fileId = item.fileId;
    let fileName = item.fileName;

    if (!fileId) {
      const primaryFile = await this.nexusClient.getPrimaryFile(auth.apiKey, item.gameDomain, item.modId);

      if (!primaryFile) {
        throw new DesktopServiceError("这个模组当前没有可下载的主文件。");
      }

      fileId = primaryFile.fileId;
      fileName = fileName || primaryFile.fileName || primaryFile.name;
    } else if (!fileName) {
      const fileInfo = await this.nexusClient.getFileInfo(
        auth.apiKey,
        item.gameDomain,
        item.modId,
        fileId,
      );
      fileName = fileInfo?.fileName || fileInfo?.name || `file-${fileId}.bin`;
    }

    if (isPlaceholderModName(modName)) {
      const mod = await this.nexusClient.getMod(auth.apiKey, item.gameDomain, item.modId);
      modName = mod.name;
    }

    let downloadUrl: string | undefined;

    if (item.nxmKey && item.nxm?.expires && fileId) {
      const urls = await this.nexusClient.getDownloadUrlsFromNxm(
        auth.apiKey,
        item.gameDomain,
        item.modId,
        fileId,
        {
          key: item.nxmKey,
          expires: item.nxm.expires,
          userId: item.nxm.userId,
        },
      );
      downloadUrl = urls[0];
    } else if (auth.user.isPremium && fileId) {
      const urls = await this.nexusClient.getDownloadUrls(
        auth.apiKey,
        item.gameDomain,
        item.modId,
        fileId,
      );
      downloadUrl = urls[0];
    }

    if (!downloadUrl) {
      throw new DesktopServiceError("无法解析实际下载地址，请重新触发下载流程。");
    }

    const destinationPath = this.resolveDestinationPath({
      fileName,
      filePath: item.filePath,
    });

    return {
      destinationPath,
      downloadUrl,
      itemPatch: {
        modName,
        fileId,
        fileName,
        progress: item.progress,
      },
    };
  }

  private resolveDestinationPath(item: {
    fileName?: string;
    filePath?: string;
  }) {
    if (item.filePath) {
      return item.filePath;
    }

    const desiredName = sanitizeFileName(item.fileName || "download.bin");
    const { baseName, extension } = splitFileName(desiredName);
    let candidate = path.join(this.settings.downloadDirectory, `${baseName}${extension}`);
    let attempt = 1;

    while (fs.existsSync(candidate) || fs.existsSync(`${candidate}.part`)) {
      candidate = path.join(
        this.settings.downloadDirectory,
        `${baseName} (${attempt})${extension}`,
      );
      attempt += 1;
    }

    return candidate;
  }

  private finalizeDownloadedFile(destinationPath: string, tempPath: string) {
    if (fs.existsSync(destinationPath)) {
      fs.rmSync(destinationPath, { force: true });
    }

    fs.renameSync(tempPath, destinationPath);
    return destinationPath;
  }
}

