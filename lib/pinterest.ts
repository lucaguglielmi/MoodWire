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

export async function pinterestFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${PINTEREST_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pinterest ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

const mediaExtensions = /\.(?:png|jpe?g|webp|gif|mp4|mov|webm|m3u8)(?:\?|$)/i;

export function extractMediaUrls(value: unknown): string[] {
  const urls = new Set<string>();

  function walk(node: unknown) {
    if (typeof node === "string") {
      if (/^https?:\/\//i.test(node) && (mediaExtensions.test(node) || /pinimg\.com/i.test(node))) {
        urls.add(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(walk);
    }
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
