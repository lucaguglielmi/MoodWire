export const PINTEREST_API = "https://api.pinterest.com/v5";

export type PinterestBoard = {
  id: string;
  name: string;
  description?: string;
  privacy?: string;
  pin_count?: number;
  owner?: { username?: string };
};

export type PinterestPin = Record<string, unknown> & {
  id: string;
  title?: string;
  description?: string;
  link?: string;
  board_id?: string;
  media?: unknown;
};

export class PinterestRequestError extends Error {
  status: number;
  code: string;
  retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PinterestRequestError";
    this.status = status;
    this.retryable = status === 429 || status >= 500;
    this.code = status === 401 || status === 403 ? "PINTEREST_AUTH" : status === 404 ? "PINTEREST_NOT_FOUND" : status === 429 ? "PINTEREST_RATE_LIMIT" : status >= 500 ? "PINTEREST_UPSTREAM" : "PINTEREST_REQUEST";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pinterestFetch<T>(path: string, token: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${PINTEREST_API}${path}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) return response.json() as Promise<T>;

      const body = await response.text();
      const error = new PinterestRequestError(`Pinterest ${response.status}: ${body.slice(0, 300)}`, response.status);
      lastError = error;
      if (!error.retryable || attempt === 2) throw error;
      await sleep(Math.min(300 * (2 ** attempt), 1500));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (error instanceof PinterestRequestError) {
        if (!error.retryable || attempt === 2) throw error;
        continue;
      }
      if (attempt === 2) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("Pinterest request timed out");
        throw error;
      }
      await sleep(Math.min(300 * (2 ** attempt), 1500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Pinterest request failed");
}

const mediaExtensions = /\.(?:png|jpe?g|webp|gif|mp4|mov|webm|m3u8)(?:\?|$)/i;

export function extractMediaUrls(value: unknown): string[] {
  const urls = new Set<string>();
  function walk(node: unknown) {
    if (typeof node === "string") {
      if (/^https?:\/\//i.test(node) && (mediaExtensions.test(node) || /pinimg\.com/i.test(node))) urls.add(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") Object.values(node as Record<string, unknown>).forEach(walk);
  }
  walk(value);
  return [...urls];
}

export function classifyMedia(url: string) {
  if (/\.(mp4|mov|webm)(?:\?|$)/i.test(url)) return "video" as const;
  if (/\.m3u8(?:\?|$)/i.test(url)) return "stream" as const;
  if (/\.gif(?:\?|$)/i.test(url)) return "gif" as const;
  return "image" as const;
}
