import type { NxmLinkEvent, NxmLinkPayload } from "../shared/contracts";

export interface NxmSecretPayload {
  rawUrl: string;
  key?: string;
  userId?: number;
  expires?: number;
}

function toOptionalNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function maskQueryValue(key: string, value: string) {
  return key.toLowerCase() === "key" && value ? "***" : value;
}

export function sanitizeNxmUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);

    for (const key of parsedUrl.searchParams.keys()) {
      if (key.toLowerCase() === "key") {
        parsedUrl.searchParams.set(key, "***");
      }
    }

    return parsedUrl.toString();
  } catch {
    return url;
  }
}

export function parseNxmLink(url: string): {
  event: NxmLinkEvent;
  secret?: NxmSecretPayload;
} {
  const receivedAt = new Date().toISOString();

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "nxm:") {
      return {
        event: {
          url: sanitizeNxmUrl(url),
          receivedAt,
          parseError: "这不是一个 nxm:// 协议链接。",
        },
      };
    }

    const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
    const modId =
      pathSegments[0] === "mods" ? toOptionalNumber(pathSegments[1] ?? null) : undefined;
    const fileId =
      pathSegments[2] === "files" ? toOptionalNumber(pathSegments[3] ?? null) : undefined;

    const query: Record<string, string> = {};
    parsedUrl.searchParams.forEach((value, key) => {
      query[key] = maskQueryValue(key, value);
    });

    const payload: NxmLinkPayload = {
      gameDomain: parsedUrl.hostname,
      pathSegments,
      modId,
      fileId,
      userId: toOptionalNumber(parsedUrl.searchParams.get("user_id")),
      expires: toOptionalNumber(parsedUrl.searchParams.get("expires")),
      hasKey: parsedUrl.searchParams.has("key"),
      query,
    };

    return {
      event: {
        url: sanitizeNxmUrl(url),
        receivedAt,
        parsed: payload,
      },
      secret: {
        rawUrl: url,
        key: parsedUrl.searchParams.get("key") ?? undefined,
        userId: payload.userId,
        expires: payload.expires,
      },
    };
  } catch (error) {
    return {
      event: {
        url: sanitizeNxmUrl(url),
        receivedAt,
        parseError: error instanceof Error ? error.message : "无法解析 nxm:// 链接。",
      },
    };
  }
}
