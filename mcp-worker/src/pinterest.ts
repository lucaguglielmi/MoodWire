export const PINTEREST_API = "https://api.pinterest.com/v5";

export type Env = {
  PINTEREST_ACCESS_TOKEN: string;
};

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

export type MediaItem = {
  url: string;
  type: "image" | "gif" | "video" | "stream";
};

export type NormalisedPin = {
  id: string;
  title: string | null;
  description: string | null;
  source_url: string;
  link: string | null;
  board_id: string | null;
  media: MediaItem[];
};

type Page<T> = { items?: T[]; bookmark?: string | null };
type CacheEntry<T> = { expiresAt: number; value: T };

const boardCache = new Map<string, CacheEntry<PinterestBoard[]>>();
const pinCache = new Map<string, CacheEntry<PinterestPin>>();
const boardPinsCache = new Map<string, CacheEntry<PinterestPin[]>>();

const BOARD_TTL_MS = 5 * 60_000;
const PIN_TTL_MS = 5 * 60_000;
const BOARD_PINS_TTL_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;

export class PinterestApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "PinterestApiError";
    this.status = status;
    this.retryable = status === 429 || status >= 500;
    this.retryAfterSeconds = retryAfterSeconds;
    this.code = status === 401 || status === 403
      ? "PINTEREST_AUTH"
      : status === 404
        ? "PINTEREST_NOT_FOUND"
        : status === 429
          ? "PINTEREST_RATE_LIMIT"
          : status >= 500
            ? "PINTEREST_UPSTREAM"
            : "PINTEREST_REQUEST";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function putCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (cache.size > 250) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
}

function retryDelay(attempt: number, retryAfterSeconds?: number) {
  if (retryAfterSeconds && retryAfterSeconds > 0) return Math.min(retryAfterSeconds * 1000, 5_000);
  return Math.min(300 * (2 ** attempt) + Math.floor(Math.random() * 150), 2_500);
}

export async function pinterestFetch<T>(path: string, token: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${PINTEREST_API}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) return response.json() as Promise<T>;

      const body = await response.text();
      const retryAfter = Number(response.headers.get("retry-after") || "") || undefined;
      const error = new PinterestApiError(`Pinterest ${response.status}: ${body.slice(0, 300)}`, response.status, retryAfter);
      lastError = error;

      if (!error.retryable || attempt === MAX_ATTEMPTS - 1) throw error;
      console.warn(JSON.stringify({ event: "pinterest_retry", status: response.status, attempt: attempt + 1, path: path.split("?")[0] }));
      await sleep(retryDelay(attempt, retryAfter));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (error instanceof PinterestApiError) {
        if (!error.retryable || attempt === MAX_ATTEMPTS - 1) throw error;
        continue;
      }
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new Error(isAbort ? "Pinterest request timed out" : `Pinterest network request failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      console.warn(JSON.stringify({ event: "pinterest_retry", reason: isAbort ? "timeout" : "network", attempt: attempt + 1, path: path.split("?")[0] }));
      await sleep(retryDelay(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Pinterest request failed");
}

const mediaExtension = /\.(?:png|jpe?g|webp|gif|mp4|mov|webm|m3u8)(?:\?|$)/i;

export function classifyMedia(url: string): MediaItem["type"] {
  if (/\.(?:mp4|mov|webm)(?:\?|$)/i.test(url)) return "video";
  if (/\.m3u8(?:\?|$)/i.test(url)) return "stream";
  if (/\.gif(?:\?|$)/i.test(url)) return "gif";
  return "image";
}

export function extractMediaUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      if (/^https?:\/\//i.test(node) && (mediaExtension.test(node) || /pinimg\.com/i.test(node))) urls.add(node);
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") Object.values(node as Record<string, unknown>).forEach(walk);
  };
  walk(value);
  return [...urls];
}

export function normalisePin(pin: PinterestPin): NormalisedPin {
  const media = extractMediaUrls(pin.media ?? pin).map((url) => ({ url, type: classifyMedia(url) }));
  return {
    id: pin.id,
    title: pin.title ?? null,
    description: pin.description ?? null,
    source_url: `https://www.pinterest.com/pin/${pin.id}/`,
    link: pin.link ?? null,
    board_id: pin.board_id ?? null,
    media,
  };
}

export async function listBoards(token: string, limit = 250): Promise<PinterestBoard[]> {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const key = `${token}|boards|${safeLimit}`;
  const hit = cached(boardCache, key);
  if (hit) return hit;

  const items: PinterestBoard[] = [];
  let bookmark: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: String(Math.min(100, safeLimit - items.length)) });
    if (bookmark) params.set("bookmark", bookmark);
    const page = await pinterestFetch<Page<PinterestBoard>>(`/boards?${params}`, token);
    items.push(...(page.items ?? []));
    bookmark = page.bookmark || undefined;
  } while (bookmark && items.length < safeLimit);

  const result = items.slice(0, safeLimit);
  putCache(boardCache, key, result, BOARD_TTL_MS);
  return result;
}

export async function listBoardPins(boardId: string, token: string, limit = 100): Promise<PinterestPin[]> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const key = `${token}|board:${boardId}|${safeLimit}`;
  const hit = cached(boardPinsCache, key);
  if (hit) return hit;

  const items: PinterestPin[] = [];
  let bookmark: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: String(Math.min(100, safeLimit - items.length)) });
    if (bookmark) params.set("bookmark", bookmark);
    const page = await pinterestFetch<Page<PinterestPin>>(`/boards/${encodeURIComponent(boardId)}/pins?${params}`, token);
    items.push(...(page.items ?? []));
    bookmark = page.bookmark || undefined;
  } while (bookmark && items.length < safeLimit);

  const result = items.slice(0, safeLimit);
  putCache(boardPinsCache, key, result, BOARD_PINS_TTL_MS);
  return result;
}

export async function getPin(pinId: string, token: string): Promise<PinterestPin> {
  const key = `${token}|pin:${pinId}`;
  const hit = cached(pinCache, key);
  if (hit) return hit;
  const pin = await pinterestFetch<PinterestPin>(`/pins/${encodeURIComponent(pinId)}`, token);
  putCache(pinCache, key, pin, PIN_TTL_MS);
  return pin;
}

export function bestImageUrl(pin: NormalisedPin): string | null {
  const candidates = pin.media.filter((item) => item.type === "image" || item.type === "gif");
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => b.url.length - a.url.length)[0]?.url ?? null;
}

export function slugify(value: string) {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export type PinterestReference =
  | { kind: "pin"; url: string; pinId: string }
  | { kind: "board"; url: string; username: string; boardSlug: string }
  | { kind: "media"; url: string }
  | { kind: "unknown"; url: string };

function parsePinterestUrl(value: string): PinterestReference {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("That does not look like a valid URL");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "i.pinimg.com" || host.endsWith(".pinimg.com")) return { kind: "media", url: url.toString() };
  if (host === "pin.it") return { kind: "unknown", url: url.toString() };
  if (host !== "pinterest.com" && !host.endsWith(".pinterest.com")) throw new Error("The URL is not a Pinterest link");
  const parts = url.pathname.split("/").filter(Boolean);
  const pinIndex = parts.findIndex((part) => part.toLowerCase() === "pin");
  if (pinIndex >= 0 && /^\d+$/.test(parts[pinIndex + 1] ?? "")) return { kind: "pin", url: url.toString(), pinId: parts[pinIndex + 1] };
  const reserved = new Set(["pin", "search", "ideas", "today", "settings", "login", "business", "oauth"]);
  if (parts.length >= 2 && !reserved.has(parts[0].toLowerCase())) {
    return { kind: "board", url: url.toString(), username: decodeURIComponent(parts[0]), boardSlug: decodeURIComponent(parts[1]) };
  }
  return { kind: "unknown", url: url.toString() };
}

export async function resolvePinterestUrl(value: string): Promise<PinterestReference> {
  const parsed = parsePinterestUrl(value);
  if (parsed.kind !== "unknown" || new URL(parsed.url).hostname.toLowerCase() !== "pin.it") return parsed;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(parsed.url, { redirect: "follow", headers: { "User-Agent": "MoodWire/0.1" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Pinterest short link could not be resolved (${response.status})`);
    return parsePinterestUrl(response.url);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Pinterest short link resolution timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchImageAsMcpContent(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { headers: { Accept: "image/*" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
    const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!contentType.startsWith("image/")) throw new Error(`Expected image media, got ${contentType}`);
    const declaredSize = Number(response.headers.get("content-length") || "0");
    if (declaredSize > 4_500_000) throw new Error("Image is too large to inline safely");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 4_500_000) throw new Error("Image is too large to inline safely");
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return { type: "image" as const, data: btoa(binary), mimeType: contentType };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Image fetch timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
