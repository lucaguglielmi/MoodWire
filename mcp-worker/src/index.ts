import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import {
  bestImageUrl,
  fetchImageAsMcpContent,
  getPin,
  listBoardPins,
  listBoards,
  normalisePin,
  resolvePinterestUrl,
  slugify,
  type Env,
  type NormalisedPin,
} from "./pinterest";

function jsonText(value: unknown) {
  return { type: "text" as const, text: JSON.stringify(value, null, 2) };
}

function requireToken(env: Env) {
  const token = env.PINTEREST_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("PINTEREST_ACCESS_TOKEN is not configured on the MoodWire Worker");
  return token;
}

async function resolveReference(url: string, token: string, limit = 100) {
  const reference = await resolvePinterestUrl(url);

  if (reference.kind === "pin") {
    return { kind: "pin" as const, requested_url: url, resolved_url: reference.url, pin: normalisePin(await getPin(reference.pinId, token)) };
  }

  if (reference.kind === "media") {
    return { kind: "media" as const, requested_url: url, resolved_url: reference.url, media: [{ url: reference.url }] };
  }

  if (reference.kind === "board") {
    const boards = await listBoards(token, 1000);
    const wantedSlug = slugify(reference.boardSlug);
    const wantedUser = reference.username.toLowerCase();
    const board = boards.find((item) => {
      const owner = item.owner?.username?.toLowerCase();
      return slugify(item.name) === wantedSlug && (!owner || owner === wantedUser);
    });
    if (!board) throw new Error("Board was not found in the connected Pinterest account");
    const pins = (await listBoardPins(board.id, token, Math.min(limit, 500))).map(normalisePin);
    return { kind: "board" as const, requested_url: url, resolved_url: reference.url, board, pins };
  }

  throw new Error("Pinterest URL was recognised but its resource type could not be determined");
}

function createServer(env: Env) {
  const token = requireToken(env);
  const server = new McpServer({ name: "MoodWire", version: "0.1.0" });

  server.registerTool(
    "resolve_pinterest_reference",
    {
      description: "Resolve a Pinterest Pin, board, pin.it short link, or direct pinimg media URL and return usable visual-reference metadata.",
      inputSchema: {
        url: z.string().url(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ url, limit }) => ({ content: [jsonText(await resolveReference(url, token, limit ?? 100))] }),
  );

  server.registerTool(
    "list_pinterest_boards",
    {
      description: "List boards from the Pinterest account connected to MoodWire.",
      inputSchema: { limit: z.number().int().min(1).max(1000).optional() },
    },
    async ({ limit }) => ({ content: [jsonText({ boards: await listBoards(token, limit ?? 250) })] }),
  );

  server.registerTool(
    "get_pinterest_board_media",
    {
      description: "Get normalised image, GIF, video, stream and source URLs for Pins in one Pinterest board.",
      inputSchema: {
        board_id: z.string().min(1),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ board_id, limit }) => {
      const pins = (await listBoardPins(board_id, token, limit ?? 100)).map(normalisePin);
      return { content: [jsonText({ board_id, pins })] };
    },
  );

  server.registerTool(
    "get_pinterest_pin",
    {
      description: "Get one Pinterest Pin and all visual media URLs MoodWire can discover for it.",
      inputSchema: { pin_id: z.string().regex(/^\d+$/) },
    },
    async ({ pin_id }) => ({ content: [jsonText({ pin: normalisePin(await getPin(pin_id, token)) })] }),
  );

  server.registerTool(
    "search_pinterest_board",
    {
      description: "Search Pin titles and descriptions within a board. Useful for narrowing a large visual-reference board before loading images.",
      inputSchema: {
        board_id: z.string().min(1),
        query: z.string().min(1),
        scan_limit: z.number().int().min(1).max(500).optional(),
        result_limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ board_id, query, scan_limit, result_limit }) => {
      const q = query.trim().toLowerCase();
      const pins = (await listBoardPins(board_id, token, scan_limit ?? 250))
        .map(normalisePin)
        .filter((pin) => `${pin.title ?? ""} ${pin.description ?? ""}`.toLowerCase().includes(q))
        .slice(0, result_limit ?? 25);
      return { content: [jsonText({ board_id, query, pins })] };
    },
  );

  server.registerTool(
    "load_reference_images",
    {
      description: "Load the actual pixels for up to 8 Pinterest Pins into the MCP result so the AI can inspect them as visual references, rather than relying on text descriptions. For video Pins, MoodWire uses an available poster/static rendition until frame extraction is enabled.",
      inputSchema: {
        pin_ids: z.array(z.string().regex(/^\d+$/)).min(1).max(8),
      },
    },
    async ({ pin_ids }) => {
      const content: Array<ReturnType<typeof jsonText> | Awaited<ReturnType<typeof fetchImageAsMcpContent>>> = [];
      const loaded: Array<{ pin: NormalisedPin; image_url: string | null; error?: string }> = [];

      for (const pinId of [...new Set(pin_ids)]) {
        const pin = normalisePin(await getPin(pinId, token));
        const imageUrl = bestImageUrl(pin);
        if (!imageUrl) {
          loaded.push({ pin, image_url: null, error: "No static image/poster rendition was exposed by Pinterest" });
          continue;
        }
        try {
          content.push(jsonText({ reference_id: `mw:pin:${pin.id}`, pin_id: pin.id, title: pin.title, source_url: pin.source_url, image_url: imageUrl }));
          content.push(await fetchImageAsMcpContent(imageUrl));
          loaded.push({ pin, image_url: imageUrl });
        } catch (error) {
          loaded.push({ pin, image_url: imageUrl, error: error instanceof Error ? error.message : "Image load failed" });
        }
      }

      if (!content.length) content.push(jsonText({ loaded }));
      else content.push(jsonText({ summary: loaded.map(({ pin, image_url, error }) => ({ reference_id: `mw:pin:${pin.id}`, image_url, error })) }));
      return { content };
    },
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "MoodWire MCP", version: "0.1.0" });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });

    // V1 is intended for a private deployment. Add Cloudflare Access/OAuth before exposing it broadly.
    return createMcpHandler(() => createServer(env), {
      route: "/mcp",
      responseMode: "auto",
      onerror: (error) => console.error("MoodWire MCP error", error),
    })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
