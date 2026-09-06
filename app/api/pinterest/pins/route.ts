import { NextRequest, NextResponse } from "next/server";
import { classifyMedia, extractMediaUrls, pinterestFetch, PinterestPin } from "@/lib/pinterest";
import { getPinterestToken } from "@/lib/token";

type Page = { items: PinterestPin[]; bookmark?: string | null };

export async function GET(request: NextRequest) {
  try {
    const token = await getPinterestToken();
    if (!token) return NextResponse.json({ error: "not_connected" }, { status: 401 });
    const boardId = request.nextUrl.searchParams.get("boardId");
    if (!boardId || !/^\d+$/.test(boardId)) return NextResponse.json({ error: "A numeric boardId is required." }, { status: 400 });

    const all: PinterestPin[] = [];
    let bookmark: string | null | undefined;
    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (bookmark) query.set("bookmark", bookmark);
      const page = await pinterestFetch<Page>(`/boards/${boardId}/pins?${query}`, token);
      all.push(...(page.items ?? []));
      bookmark = page.bookmark;
    } while (bookmark && all.length < 1000);

    const items = all.map((pin) => {
      const mediaUrls = extractMediaUrls(pin.media ?? pin);
      return {
        ...pin,
        _media: mediaUrls.map((url) => ({ url, kind: classifyMedia(url) })),
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
