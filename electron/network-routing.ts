import { session } from "electron";
import type { AppSettings } from "../shared/contracts";
import type { RequestDispatcherHandle } from "../server/nexus";
import { Agent, ProxyAgent } from "undici";

type NetworkRoutingSettings = Pick<
  AppSettings,
  "proxyEnabled" | "networkRouteMode" | "proxyUrl" | "proxyBypassList"
>;

function createDirectDispatcher(): RequestDispatcherHandle {
  const dispatcher = new Agent();

  return {
    dispatcher,
    close: () => dispatcher.close(),
  };
}

function createProxyDispatcher(proxyUrl: string): RequestDispatcherHandle {
  const dispatcher = new ProxyAgent(proxyUrl);

  return {
    dispatcher,
    close: () => dispatcher.close(),
  };
}

function normalizeBypassPattern(entry: string) {
  const trimmed = entry.trim().toLowerCase();

  if (!trimmed) {
    return "";
  }

  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith("*.")) {
    return trimmed.slice(1);
  }

  if (!trimmed.startsWith("[") && trimmed.includes(":")) {
    return trimmed.split(":")[0];
  }

  return trimmed;
}

function hostnameMatchesPattern(hostname: string, pattern: string) {
  if (!pattern) {
    return false;
  }

  if (pattern === "*") {
    return true;
  }

  if (pattern.startsWith(".")) {
    return hostname === pattern.slice(1) || hostname.endsWith(pattern);
  }

  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

function shouldBypassProxy(targetUrl: string, bypassList: string) {
  let hostname = "";

  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  return bypassList
    .split(/\r?\n/)
    .map(normalizeBypassPattern)
    .filter(Boolean)
    .some((pattern) => hostnameMatchesPattern(hostname, pattern));
}

function toProxyUrlFromRule(rule: string) {
  const normalizedRule = rule.trim();

  if (!normalizedRule) {
    return null;
  }

  const [rawMode, rawTarget] = normalizedRule.split(/\s+/, 2);
  const mode = rawMode?.toUpperCase();
  const target = rawTarget?.trim();

  if (!mode || mode === "DIRECT") {
    return null;
  }

  if (!target) {
    return null;
  }

  switch (mode) {
    case "PROXY":
    case "HTTP":
      return `http://${target}`;
    case "HTTPS":
      return `https://${target}`;
    case "SOCKS":
    case "SOCKS5":
      return `socks5://${target}`;
    case "SOCKS4":
      return `socks4://${target}`;
    default:
      return null;
  }
}

async function resolveSystemProxy(targetUrl: string) {
  const resolved = await session.defaultSession.resolveProxy(targetUrl);
  const rules = resolved
    .split(";")
    .map((rule) => rule.trim())
    .filter(Boolean);

  for (const rule of rules) {
    if (rule.toUpperCase() === "DIRECT") {
      return null;
    }

    const proxyUrl = toProxyUrlFromRule(rule);
    if (proxyUrl) {
      return proxyUrl;
    }
  }

  return null;
}

export async function createDispatcherForRequest(
  targetUrl: string,
  settings: NetworkRoutingSettings,
): Promise<RequestDispatcherHandle> {
  if (!settings.proxyEnabled) {
    return createDirectDispatcher();
  }

  if (shouldBypassProxy(targetUrl, settings.proxyBypassList)) {
    return createDirectDispatcher();
  }

  if (settings.networkRouteMode === "customProxy" && settings.proxyUrl) {
    return createProxyDispatcher(settings.proxyUrl);
  }

  if (settings.networkRouteMode === "builtInProxy") {
    throw new Error("Game++内置代理入口列表尚未接入服务端接口。");
  }

  if (settings.networkRouteMode === "systemProxy") {
    const proxyUrl = await resolveSystemProxy(targetUrl);

    if (proxyUrl) {
      return createProxyDispatcher(proxyUrl);
    }
  }

  return createDirectDispatcher();
}
