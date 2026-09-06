import { NextRequest, NextResponse } from "next/server";
import { classifyMedia, extractMediaUrls, PinterestBoard, PinterestPin, pinterestFetch } from "../../../../lib/pinterest";
import { getPinterestToken } from "../../../../lib/token";
import { resolvePinterestShortUrl, slugifyPinterestBoardName } from "../../../../lib/pinterest-url";

type BoardListResponse = {
  items: PinterestBoard[];
  bookmark?: string | null;
};

type PinsResponse = {
  items: PinterestPin[];
  bookmark?: string | null;
};

async function listBoards(token: string) {
  const boards: PinterestBoard[] = [];
  let bookmark: string | undefined;

  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (bookmark) params.set("bookmark", bookmark);
    const page = await pinterestFetch<BoardListResponse>(`/boards?${params}`, token);
    boards.push(...(page.items ?? []));
    bookmark = page.bookmark || undefined;
  } while (bookmark && boards.length < 2000);

  return boards;
}

async function listBoardPins(boardId: string, token: string, limit = 100) {
  const pins: PinterestPin[] = [];
  let bookmark: string | undefined;

  do {
    const pageSize = Math.min(100, Math.max(1, limit - pins.length));
    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (bookmark) params.set("bookmark", bookmark);
    const page = await pinterestFetch<PinsResponse>(`/boards/${boardId}/pins?${params}`, token);
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
    raw_media: pin.media ?? null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const token = await getPinterestToken();
    if (!token) {
      return NextResponse.json({ error: "Pinterest is not connected" }, { status: 401 });
    }

    const body = (await request.json()) as { url?: string; limit?: number };
    if (!body.url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const reference = await resolvePinterestShortUrl(body.url);

    if (reference.kind === "pin") {
      const pin = await pinterestFetch<PinterestPin>(`/pins/${reference.pinId}`, token);
      return NextResponse.json({
        kind: "pin",
        requested_url: body.url,
        resolved_url: reference.url,
        pin: normalisePin(pin),
      });
    }

    if (reference.kind === "board") {
      const boards = await listBoards(token);
      const requestedSlug = slugifyPinterestBoardName(reference.boardSlug);
      const requestedUser = reference.username.toLowerCase();
      const board = boards.find((candidate) => {
        const owner = candidate.owner?.username?.toLowerCase();
        return (
          slugifyPinterestBoardName(candidate.name) === requestedSlug &&
          (!owner || owner === requestedUser)
        );
      });

      if (!board) {
        return NextResponse.json(
          {
            error: "Board was not found in the connected Pinterest account",
            requested_url: body.url,
            resolved_url: reference.url,
          },
          { status: 404 },
        );
      }

      const pins = await listBoardPins(board.id, token, Math.min(body.limit ?? 100, 500));
      return NextResponse.json({
        kind: "board",
        requested_url: body.url,
        resolved_url: reference.url,
        board,
        pins: pins.map(normalisePin),
      });
    }

    if (reference.kind === "media") {
      return NextResponse.json({
        kind: "media",
        requested_url: body.url,
        resolved_url: reference.url,
        media: [{ url: reference.url, type: classifyMedia(reference.url) }],
      });
    }

    return NextResponse.json(
      {
        error: "Pinterest URL was recognised but its resource type could not be determined",
        requested_url: body.url,
        resolved_url: reference.url,
      },
      { status: 422 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
