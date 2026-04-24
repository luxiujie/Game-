import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  AppSettings,
  AuthSource,
  DownloadHistoryEntry,
  DownloadQueueItem,
  NxmLinkEvent,
  NexusUser,
} from "../shared/contracts";

interface PersistedAuthSession {
  source: AuthSource;
  user: NexusUser;
  encryptedApiKey?: string;
  plainApiKey?: string;
}

export interface RestoredAuthSession {
  apiKey: string;
  source: AuthSource;
  user: NexusUser;
}

export interface PersistedDownloadQueueItem extends DownloadQueueItem {
  rawNxmUrl?: string;
  nxmKey?: string;
}

export interface PersistedDesktopState {
  version: 2;
  settings: AppSettings;
  authSession: PersistedAuthSession | null;
  queue: PersistedDownloadQueueItem[];
  history: DownloadHistoryEntry[];
  recentNxmLinks: NxmLinkEvent[];
}

function defaultSettings(): AppSettings {
  return {
    downloadDirectory: path.join(app.getPath("downloads"), "Nexus Relay Starter"),
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

function defaultState(): PersistedDesktopState {
  return {
    version: 2,
    settings: defaultSettings(),
    authSession: null,
    queue: [],
    history: [],
    recentNxmLinks: [],
  };
}

function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export class DesktopPersistence {
  private readonly filePath = path.join(app.getPath("userData"), "desktop-state.json");

  getFilePath() {
    return this.filePath;
  }

  load(): PersistedDesktopState {
    try {
      if (!fs.existsSync(this.filePath)) {
        return defaultState();
      }

      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedDesktopState> & {
        settings?: Partial<AppSettings>;
      };

      return {
        version: 2,
        settings: {
          ...defaultSettings(),
          ...(parsed.settings ?? {}),
          proxyEnabled:
            typeof parsed.settings?.proxyEnabled === "boolean"
              ? parsed.settings.proxyEnabled
              : parsed.settings?.networkRouteMode === "systemProxy" ||
                  parsed.settings?.networkRouteMode === "customProxy" ||
                  parsed.settings?.networkRouteMode === "builtInProxy",
        },
        authSession: parsed.authSession ?? null,
        queue: normalizeArray<PersistedDownloadQueueItem>(parsed.queue),
        history: normalizeArray<DownloadHistoryEntry>(parsed.history),
        recentNxmLinks: normalizeArray<NxmLinkEvent>(parsed.recentNxmLinks),
      };
    } catch {
      return defaultState();
    }
  }

  save(state: PersistedDesktopState) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }

  ensureDirectory(directoryPath: string) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }

  createPersistedAuthSession(session: RestoredAuthSession): PersistedAuthSession {
    if (safeStorage.isEncryptionAvailable()) {
      const encryptedApiKey = safeStorage.encryptString(session.apiKey).toString("base64");
      return {
        source: session.source,
        user: session.user,
        encryptedApiKey,
      };
    }

    return {
      source: session.source,
      user: session.user,
      plainApiKey: session.apiKey,
    };
  }

  restoreAuthSession(authSession: PersistedAuthSession | null): RestoredAuthSession | null {
    if (!authSession) {
      return null;
    }

    try {
      if (authSession.encryptedApiKey) {
        if (!safeStorage.isEncryptionAvailable()) {
          return null;
        }

        return {
          apiKey: safeStorage.decryptString(Buffer.from(authSession.encryptedApiKey, "base64")),
          source: authSession.source,
          user: authSession.user,
        };
      }

      if (authSession.plainApiKey) {
        return {
          apiKey: authSession.plainApiKey,
          source: authSession.source,
          user: authSession.user,
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}
