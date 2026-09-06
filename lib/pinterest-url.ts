export type PinterestReference =
  | { kind: "pin"; url: string; pinId: string }
  | { kind: "board"; url: string; username: string; boardSlug: string }
  | { kind: "media"; url: string }
  | { kind: "unknown"; url: string };

const PINTEREST_HOSTS = new Set([
  "pinterest.com",
  "www.pinterest.com",
  "uk.pinterest.com",
  "it.pinterest.com",
  "pin.it",
]);

function normaliseHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function slugifyPinterestBoardName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parsePinterestUrl(value: string): PinterestReference {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Invalid URL");
  }

  const host = normaliseHost(url.hostname);

  if (host === "i.pinimg.com" || host.endsWith(".pinimg.com")) {
    return { kind: "media", url: url.toString() };
  }

  if (!PINTEREST_HOSTS.has(url.hostname.toLowerCase()) && host !== "pinterest.com" && host !== "pin.it") {
    throw new Error("URL is not a Pinterest URL");
  }

  if (host === "pin.it") {
    return { kind: "unknown", url: url.toString() };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const pinIndex = parts.findIndex((part) => part.toLowerCase() === "pin");

  if (pinIndex >= 0 && parts[pinIndex + 1] && /^\d+$/.test(parts[pinIndex + 1])) {
    return {
      kind: "pin",
      url: url.toString(),
      pinId: parts[pinIndex + 1],
    };
  }

  // Normal Pinterest board URLs are /{username}/{board-slug}/.
  // Exclude well-known non-board routes.
  const reserved = new Set([
    "pin",
    "search",
    "ideas",
    "today",
    "settings",
    "login",
    "business",
    "oauth",
  ]);

  if (parts.length >= 2 && !reserved.has(parts[0].toLowerCase())) {
    return {
      kind: "board",
      url: url.toString(),
      username: decodeURIComponent(parts[0]),
      boardSlug: decodeURIComponent(parts[1]),
    };
  }

  return { kind: "unknown", url: url.toString() };
}

export async function resolvePinterestShortUrl(value: string) {
  const parsed = parsePinterestUrl(value);
  if (parsed.kind !== "unknown" || normaliseHost(new URL(parsed.url).hostname) !== "pin.it") {
    return parsed;
  }

  const response = await fetch(parsed.url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "MoodWire/0.1 (+https://github.com/lucaguglielmi/MoodWire)",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Could not resolve Pinterest short URL (${response.status})`);
  }

  return parsePinterestUrl(response.url);
}
