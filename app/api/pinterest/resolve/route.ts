import { NextRequest, NextResponse } from "next/server";
import { classifyMedia, extractMediaUrls, PinterestBoard, PinterestPin, PinterestRequestError, pinterestFetch } from "../../../../lib/pinterest";
import { getPinterestToken } from "../../../../lib/token";
import { resolvePinterestShortUrl, slugifyPinterestBoardName } from "../../../../lib/pinterest-url";

type BoardListResponse = { items: PinterestBoard[]; bookmark?: string | null };
type PinsResponse = { items: PinterestPin[]; bookmark?: string | null };
type BoardCacheEntry = { expiresAt: number; boards: PinterestBoard[] };

const boardCache = new Map<string, BoardCacheEntry>();

function log(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "moodwire-web", event, ts: new Date().toISOString(), ...data }));
}

function issueFrom(error: unknown, requestId: string) {
  if (error instanceof PinterestRequestError) {
    return {
      code: error.code,
      user_message: error.code === "PINTEREST_AUTH" ? "Pinterest rejected the current connection." : error.code === "PINTEREST_RATE_LIMIT" ? "Pinterest is temporarily rate-limiting MoodWire." : error.code === "PINTEREST_NOT_FOUND" ? "Pinterest could not find that reference." : "Pinterest could not complete the request.",
      detail: error.message,
      retryable: error.retryable,
      action: error.code === "PINTEREST_AUTH" ? "Reconnect Pinterest and retry." : error.code === "PINTEREST_RATE_LIMIT" ? "Wait briefly, then retry." : "Check the reference and try again.",
      request_id: requestId,
    };
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  const code = message.toLowerCase().includes("timed out") ? "TIMEOUT" : "REFERENCE_ERROR";
  return {
    code,
    user_message: code === "TIMEOUT" ? "Pinterest took too long to respond." : "MoodWire could not resolve that Pinterest reference.",
    detail: message,
    retryable: code === "TIMEOUT",
    action: code === "TIMEOUT" ? "Retry once." : "Paste a Pinterest Pin, board, pin.it, or direct pinimg URL.",
    request_id: requestId,
  };
}

async function listBoards(token: string) {
  const cached = boardCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.boards;

  const boards: PinterestBoard[] = [];
  let bookmark: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (bookmark) params.set("bookmark", bookmark);
    const page = await pinterestFetch<BoardListResponse>(`/boards?${params}`, token);
    boards.push(...(page.items ?? []));
    bookmark = page.bookmark || undefined;
  } while (bookmark && boards.length < 1000);

  boardCache.set(token, { boards, expiresAt: Date.now() + 5 * 60_000 });
  if (boardCache.size > 20) boardCache.delete(boardCache.keys().next().value as string);
  return boards;
}

async function listBoardPins(boardId: string, token: string, limit = 48) {
  const pins: PinterestPin[] = [];
  let bookmark: string | undefined;
  do {
    const pageSize = Math.min(100, Math.max(1, limit - pins.length));
    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (bookmark) params.set("bookmark", bookmark);
    const page = await pinterestFetch<PinsResponse>(`/boards/${encodeURIComponent(boardId)}/pins?${params}`, token);
    pins.push(...(page.items ?? []));
    bookmark = page.bookmark || undefined;
  } while (bookmark && pins.length < limit);
  return pins.slice(0, limit);
}

function normalisePin(pin: PinterestPin) {
  const mediaUrls = extractMediaUrls(pin.media ?? pin);
  return {
    id: pin.id,
    title: pin.title ?? null,
    description: pin.description ?? null,
    source_url: `https://www.pinterest.com/pin/${pin.id}/`,
    link: pin.link ?? null,
    board_id: pin.board_id ?? null,
    media: mediaUrls.map((url) => ({ url, type: classifyMedia(url) })),
  };
}

function suggestions(kind: "pin" | "board" | "media") {
  return kind === "board"
    ? ["Choose the strongest references", "See more from this board", "Compare shortlisted references", "Discuss the visual style"]
    : ["Keep as a reference", "Describe its useful visual traits", "Compare it with another reference"];
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-vercel-id") || crypto.randomUUID();
  const started = Date.now();
  log("resolve_start", { request_id: requestId });

  try {
    const token = await getPinterestToken();
    if (!token) {
      return NextResponse.json({ ok: false, issue: { code: "NOT_CONNECTED", user_message: "Pinterest is not connected yet.", retryable: false, action: "Connect Pinterest first.", request_id: requestId } }, { status: 401, headers: { "x-moodwire-request-id": requestId } });
    }

    const body = (await request.json()) as { url?: string; limit?: number };
    if (!body.url?.trim()) {
      return NextResponse.json({ ok: false, issue: { code: "MISSING_URL", user_message: "Paste a Pinterest reference first.", retryable: false, action: "Paste a board, Pin, pin.it, or direct media URL.", request_id: requestId } }, { status: 400, headers: { "x-moodwire-request-id": requestId } });
    }

    const reference = await resolvePinterestShortUrl(body.url.trim());
    const limit = Math.max(1, Math.min(body.limit ?? 48, 500));

    if (reference.kind === "pin") {
      const pin = await pinterestFetch<PinterestPin>(`/pins/${reference.pinId}`, token);
      const response = { ok: true, kind: "pin", requested_url: body.url, resolved_url: reference.url, pin: normalisePin(pin), suggestions: suggestions("pin"), request_id: requestId, duration_ms: Date.now() - started };
      log("resolve_success", { request_id: requestId, kind: "pin", duration_ms: response.duration_ms });
      return NextResponse.json(response, { headers: { "x-moodwire-request-id": requestId } });
    }

    if (reference.kind === "board") {
      const boards = await listBoards(token);
      const requestedSlug = slugifyPinterestBoardName(reference.boardSlug);
      const requestedUser = reference.username.toLowerCase();
      const board = boards.find((candidate) => {
        const owner = candidate.owner?.username?.toLowerCase();
        return slugifyPinterestBoardName(candidate.name) === requestedSlug && (!owner || owner === requestedUser);
      });

      if (!board) {
        return NextResponse.json({ ok: false, issue: { code: "BOARD_NOT_VISIBLE", user_message: "That board is not visible through the connected Pinterest account.", retryable: false, action: "Check the board account/visibility or choose it from your connected board list.", request_id: requestId }, requested_url: body.url, resolved_url: reference.url }, { status: 404, headers: { "x-moodwire-request-id": requestId } });
      }

      const pins = await listBoardPins(board.id, token, limit);
      const response = { ok: true, kind: "board", requested_url: body.url, resolved_url: reference.url, board, pins: pins.map(normalisePin), preview_count: pins.length, suggestions: suggestions("board"), request_id: requestId, duration_ms: Date.now() - started };
      log("resolve_success", { request_id: requestId, kind: "board", pin_count: pins.length, duration_ms: response.duration_ms });
      return NextResponse.json(response, { headers: { "x-moodwire-request-id": requestId } });
    }

    if (reference.kind === "media") {
      const response = { ok: true, kind: "media", requested_url: body.url, resolved_url: reference.url, media: [{ url: reference.url, type: classifyMedia(reference.url) }], suggestions: suggestions("media"), request_id: requestId, duration_ms: Date.now() - started };
      log("resolve_success", { request_id: requestId, kind: "media", duration_ms: response.duration_ms });
      return NextResponse.json(response, { headers: { "x-moodwire-request-id": requestId } });
    }

    return NextResponse.json({ ok: false, issue: { code: "UNSUPPORTED_REFERENCE", user_message: "Pinterest URL recognised, but MoodWire could not determine whether it is a board, Pin or media item.", retryable: false, action: "Open the specific Pin or board in Pinterest and paste that URL instead.", request_id: requestId } }, { status: 422, headers: { "x-moodwire-request-id": requestId } });
  } catch (error) {
    const issue = issueFrom(error, requestId);
    console.error(JSON.stringify({ service: "moodwire-web", event: "resolve_error", ts: new Date().toISOString(), request_id: requestId, duration_ms: Date.now() - started, code: issue.code, detail: issue.detail }));
    return NextResponse.json({ ok: false, issue }, { status: 500, headers: { "x-moodwire-request-id": requestId } });
  }
}
