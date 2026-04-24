import fs from "node:fs";
import path from "node:path";
import { fetch, type RequestInit, type Response } from "undici";
import type { RequestDispatcherHandle } from "../server/nexus";

export class DownloadAbortError extends Error {
  constructor() {
    super("下载已暂停。");
    this.name = "DownloadAbortError";
  }
}

export interface DownloadProgressSnapshot {
  bytesTransferred: number;
  totalBytes?: number;
  percent?: number;
  speedBytesPerSecond?: number;
}

interface DownloadToFileOptions {
  url: string;
  destinationPath: string;
  signal: AbortSignal;
  retryCount?: number;
  getDispatcherForUrl?: (
    url: string,
  ) => Promise<RequestDispatcherHandle | null> | RequestDispatcherHandle | null;
  onProgress: (progress: DownloadProgressSnapshot) => void;
}

function parseContentRange(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }

  const match = headerValue.match(/\/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function ensureFileDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function shouldRetryStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function getRetryDelayMs(attempt: number) {
  return Math.min(500 * 2 ** Math.max(attempt - 1, 0), 3000);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeChunk(stream: fs.WriteStream, chunk: Uint8Array) {
  return new Promise<void>((resolve, reject) => {
    stream.write(Buffer.from(chunk), (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function finishStream(stream: fs.WriteStream) {
  return new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readBodyToFile(
  response: Response,
  tempPath: string,
  initialBytes: number,
  signal: AbortSignal,
  onProgress: (progress: DownloadProgressSnapshot) => void,
) {
  if (!response.body) {
    throw new Error("下载响应没有返回可读取的数据流。");
  }

  const totalBytes =
    response.status === 206
      ? parseContentRange(response.headers.get("content-range"))
      : (() => {
          const contentLength = response.headers.get("content-length");
          return contentLength ? initialBytes + Number.parseInt(contentLength, 10) : undefined;
        })();

  const writer = fs.createWriteStream(tempPath, {
    flags: initialBytes > 0 && response.status === 206 ? "a" : "w",
  });

  const reader = response.body.getReader();
  let bytesTransferred = initialBytes;
  let sampleBytes = initialBytes;
  let sampleTime = Date.now();
  let lastReportAt = 0;

  try {
    onProgress({
      bytesTransferred,
      totalBytes,
      percent: totalBytes ? (bytesTransferred / totalBytes) * 100 : undefined,
    });

    while (true) {
      if (signal.aborted) {
        throw new DownloadAbortError();
      }

      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      await writeChunk(writer, value);
      bytesTransferred += value.byteLength;

      const now = Date.now();
      if (now - lastReportAt >= 250) {
        const elapsedSeconds = Math.max((now - sampleTime) / 1000, 0.001);
        const speedBytesPerSecond = Math.max(
          Math.round((bytesTransferred - sampleBytes) / elapsedSeconds),
          0,
        );

        onProgress({
          bytesTransferred,
          totalBytes,
          percent: totalBytes ? (bytesTransferred / totalBytes) * 100 : undefined,
          speedBytesPerSecond,
        });

        lastReportAt = now;
        sampleTime = now;
        sampleBytes = bytesTransferred;
      }
    }

    await finishStream(writer);

    onProgress({
      bytesTransferred,
      totalBytes,
      percent: totalBytes ? 100 : undefined,
      speedBytesPerSecond: 0,
    });

    return {
      bytesTransferred,
      totalBytes,
    };
  } catch (error) {
    writer.destroy();
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function downloadToFile(options: DownloadToFileOptions) {
  ensureFileDirectory(options.destinationPath);

  const tempPath = `${options.destinationPath}.part`;
  const maxAttempts = Math.max(1, (options.retryCount ?? 0) + 1);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let resumeOffset = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
    let dispatcherHandle: RequestDispatcherHandle | null = null;

    try {
      dispatcherHandle = (await options.getDispatcherForUrl?.(options.url)) ?? null;

      const requestInit: RequestInit = {
        headers: resumeOffset > 0 ? { Range: `bytes=${resumeOffset}-` } : undefined,
        signal: options.signal,
        redirect: "follow",
      };

      if (dispatcherHandle) {
        requestInit.dispatcher = dispatcherHandle.dispatcher;
      }

      const response = await fetch(options.url, requestInit);

      if (!response.ok && response.status !== 206) {
        if (attempt < maxAttempts && shouldRetryStatus(response.status)) {
          await delay(getRetryDelayMs(attempt));
          continue;
        }

        throw new Error(`下载失败，HTTP ${response.status} ${response.statusText}`);
      }

      if (resumeOffset > 0 && response.status === 200) {
        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { force: true });
        }

        resumeOffset = 0;
      }

      const result = await readBodyToFile(
        response,
        tempPath,
        resumeOffset,
        options.signal,
        options.onProgress,
      );

      return {
        ...result,
        tempPath,
      };
    } catch (error) {
      if (error instanceof DownloadAbortError || options.signal.aborted) {
        throw error instanceof DownloadAbortError ? error : new DownloadAbortError();
      }

      lastError = error instanceof Error ? error : new Error("下载失败。");

      if (attempt >= maxAttempts) {
        throw lastError;
      }

      await delay(getRetryDelayMs(attempt));
    } finally {
      if (dispatcherHandle) {
        await dispatcherHandle.close().catch(() => undefined);
      }
    }
  }

  throw lastError ?? new Error("下载失败。");
}
