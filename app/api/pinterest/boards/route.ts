import { NextResponse } from "next/server";
import { pinterestFetch, PinterestBoard } from "@/lib/pinterest";
import { getPinterestToken } from "@/lib/token";

type Page = { items: PinterestBoard[]; bookmark?: string | null };

export async function GET() {
  try {
    const token = await getPinterestToken();
    if (!token) return NextResponse.json({ error: "not_connected" }, { status: 401 });

    const all: PinterestBoard[] = [];
    let bookmark: string | null | undefined;
    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (bookmark) query.set("bookmark", bookmark);
      const page = await pinterestFetch<Page>(`/boards?${query}`, token);
      all.push(...(page.items ?? []));
      bookmark = page.bookmark;
    } while (bookmark && all.length < 1000);

    return NextResponse.json({ items: all });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
