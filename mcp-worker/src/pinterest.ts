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

export async function pinterestFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${PINTEREST_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pinterest ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json() as Promise<T>;
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
  const items: PinterestBoard[] = [];
  let bookmark: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: String(Math.min(100, limit - items.length)) });
    if (bookmark) params.set("bookmark", bookmark);
    const page = await pinterestFetch<Page<PinterestBoard>>(`/boards?${params}`, token);
    items.push(...(page.items ?? []));
    bookmark = page.bookmark || undefined;
  } while (bookmark && items.length < limit);
  return items.slice(0, limit);
}

export async function listBoardPins(boardId: string, token: string, limit = 100): Promise<PinterestPin[]> {
  const items: PinterestPin[] = [];
  let bookmark: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: String(Math.min(100, limit - items.length)) });
    if (bookmark) params.set("bookmark", bookmark);
    const page = await pinterestFetch<Page<PinterestPin>>(`/boards/${encodeURIComponent(boardId)}/pins?${params}`, token);
    items.push(...(page.items ?? []));
    bookmark = page.bookmark || undefined;
  } while (bookmark && items.length < limit);
  return items.slice(0, limit);
}

export async function getPin(pinId: string, token: string): Promise<PinterestPin> {
  return pinterestFetch<PinterestPin>(`/pins/${encodeURIComponent(pinId)}`, token);
}

export function bestImageUrl(pin: NormalisedPin): string | null {
  const candidates = pin.media.filter((item) => item.type === "image" || item.type === "gif");
  if (!candidates.length) return null;
  // Pinterest media payloads commonly include multiple image renditions. The largest/original URL tends to be longest.
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
  const url = new URL(value.trim());
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "i.pinimg.com" || host.endsWith(".pinimg.com")) return { kind: "media", url: url.toString() };
  if (host === "pin.it") return { kind: "unknown", url: url.toString() };
  if (host !== "pinterest.com" && !host.endsWith(".pinterest.com")) throw new Error("URL is not a Pinterest URL");
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
  const response = await fetch(parsed.url, { redirect: "follow", headers: { "User-Agent": "MoodWire/0.1" } });
  if (!response.ok) throw new Error(`Could not resolve Pinterest short URL (${response.status})`);
  return parsePinterestUrl(response.url);
}

export async function fetchImageAsMcpContent(url: string) {
  const response = await fetch(url, { headers: { Accept: "image/*" } });
  if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error(`Expected image media, got ${contentType}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 4_500_000) throw new Error("Image is too large to inline safely");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return { type: "image" as const, data: btoa(binary), mimeType: contentType };
}
