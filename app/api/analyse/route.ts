import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Set OPENAI_API_KEY to enable analysis." }, { status: 400 });
    }

    const { imageUrls, boardName } = await request.json() as { imageUrls?: string[]; boardName?: string };
    const clean = (imageUrls ?? []).filter((url) => /^https?:\/\//.test(url)).slice(0, 20);
    if (!clean.length) return NextResponse.json({ error: "No usable static image URLs found." }, { status: 400 });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const content: any[] = [
      {
        type: "input_text",
        text: `Analyse these visual references from the Pinterest board "${boardName ?? "Untitled"}". Extract a reusable visual DNA for ORIGINAL logo and illustration generation. Describe shape language, geometry, line/edge treatment, composition, typography tendencies if visible, palette tendencies, texture, visual personality, motion cues that can be inferred from the frames, and recurring motifs. Do not recommend copying any individual work. End with a concise generation brief and an explicit list of traits to avoid reproducing too literally.`,
      },
      ...clean.map((image_url) => ({ type: "input_image", image_url, detail: "low" })),
    ];

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5",
      input: [{ role: "user", content }],
    });

    return NextResponse.json({ analysis: response.output_text, analysed: clean.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
