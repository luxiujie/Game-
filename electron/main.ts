import { app, BrowserWindow, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { registerDesktopIpc } from "./ipc";

let mainWindow: BrowserWindow | null = null;
let desktopIpc: ReturnType<typeof registerDesktopIpc> | null = null;
const pendingProtocolUrls: string[] = [];

function isDev() {
  return !app.isPackaged;
}

function getRendererUrl() {
  const explicitUrl = process.env.NEXUS_DEV_RENDERER_URL?.trim();

  if (explicitUrl) {
    return explicitUrl;
  }

  try {
    const manifestPath = path.resolve(process.cwd(), ".nexus-dev-server.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { url?: string };

    if (typeof manifest.url === "string" && manifest.url.trim()) {
      return manifest.url.trim();
    }
  } catch {
    // Fallback to the default development port if the manifest is not ready yet.
  }

  return "http://localhost:5180";
}

function getWindowIconPath() {
  const candidates = [
    path.resolve(process.cwd(), "logo.png"),
    path.resolve(process.resourcesPath, "logo.png"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function getNxmArgs(argv: string[]) {
  return argv.filter((entry) => entry.startsWith("nxm://"));
}

function focusMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

function tryRegisterNxmProtocol() {
  if (process.defaultApp) {
    const appEntry = process.argv[1] ? path.resolve(process.argv[1]) : app.getAppPath();
    return app.setAsDefaultProtocolClient("nxm", process.execPath, [appEntry]);
  }

  return app.setAsDefaultProtocolClient("nxm");
}

function registerNxmProtocol() {
  const requested = tryRegisterNxmProtocol();
  const registered = app.isDefaultProtocolClient("nxm");

  return {
    protocol: "nxm" as const,
    requested,
    registered,
    message: registered
      ? "nxm 协议已由当前应用接管。"
      : requested
        ? "已发起 nxm 协议注册，但当前系统默认处理程序仍不是本应用。请关闭占用 nxm:// 的其他管理器后重试。"
        : "当前环境未能完成 nxm 协议注册，请稍后重试或使用安装版应用。",
  };
}

function enqueueProtocolUrls(urls: string[]) {
  pendingProtocolUrls.push(...urls);

  if (!desktopIpc) {
    return;
  }

  for (const protocolUrl of pendingProtocolUrls.splice(0)) {
    desktopIpc.queueNxmLink(protocolUrl);
  }

  desktopIpc.flushQueuedNxmLinks();
}

function bindMainWindow(window: BrowserWindow) {
  window.webContents.on("did-finish-load", () => {
    desktopIpc?.flushQueuedNxmLinks();
  });

  return window;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loadRenderer(window: BrowserWindow) {
  if (!isDev()) {
    await window.loadFile(path.resolve(__dirname, "../../dist/index.html"));
    return;
  }

  const rendererUrl = getRendererUrl();
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await window.loadURL(rendererUrl);
      return;
    } catch (error) {
      lastError = error;
      await delay(400);
    }
  }

  throw lastError;
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: "#131210",
    title: "Game++",
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error("[electron] did-fail-load", {
      errorCode,
      errorDescription,
      validatedUrl,
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[electron] render-process-gone", details);
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error("[renderer]", { message, line, sourceId });
      return;
    }

    if (isDev()) {
      console.log("[renderer]", { message, line, sourceId });
    }
  });

  window.on("ready-to-show", () => {
    window.show();
  });

  void loadRenderer(window).catch((error) => {
    console.error("[electron] renderer load failed", error);
  });

  return window;
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

enqueueProtocolUrls(getNxmArgs(process.argv));

app.on("second-instance", (_event, argv) => {
  focusMainWindow();
  enqueueProtocolUrls(getNxmArgs(argv));
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  focusMainWindow();
  enqueueProtocolUrls([url]);
});

app.whenReady().then(() => {
  registerNxmProtocol();

  desktopIpc = registerDesktopIpc({
    getMainWindow: () => mainWindow,
    isProtocolRegistered: () => app.isDefaultProtocolClient("nxm"),
    registerProtocol: () => registerNxmProtocol(),
  });

  enqueueProtocolUrls([]);

  mainWindow = bindMainWindow(createMainWindow());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = bindMainWindow(createMainWindow());
    return;
  }

  focusMainWindow();
});
