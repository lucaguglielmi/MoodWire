import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import {
  PinterestApiError,
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

function suggestionsFor(kind: "pin" | "board" | "media") {
  if (kind === "board") {
    return [
      { label: "Choose references", prompt: "Show me the strongest references from this board and help me choose a small set." },
      { label: "Create an original image", prompt: "Use selected references for broad visual direction and create a new original image." },
      { label: "Create a 3D asset brief", prompt: "Use selected references to define silhouette, materials, proportions and surface language for an original 3D asset." },
      { label: "Plan an animated identity", prompt: "Use the motion and composition cues in selected references to propose an original animated logo direction." },
    ];
  }
  return [
    { label: "Use as image reference", prompt: "Use this reference as visual direction for a new original image without copying it." },
    { label: "Describe useful visual traits", prompt: "Analyse this reference for composition, material, lighting, typography, shape and motion cues." },
    { label: "Create a 3D asset brief", prompt: "Turn the useful traits from this reference into an original 3D asset brief." },
    { label: "Compare with another reference", prompt: "Keep this reference loaded and compare it with another Pinterest reference I provide." },
  ];
}

function issueFrom(error: unknown, requestId: string) {
  if (error instanceof PinterestApiError) {
    const action = error.code === "PINTEREST_AUTH"
      ? "Reconnect Pinterest, then retry."
      : error.code === "PINTEREST_RATE_LIMIT"
        ? "Wait briefly and retry."
        : error.code === "PINTEREST_NOT_FOUND"
          ? "Check that the Pin or board still exists and is visible to the connected Pinterest account."
          : "Retry the request. If it keeps failing, check Pinterest service status or app permissions.";
    return {
      code: error.code,
      message: error.message,
      user_message: error.code === "PINTEREST_AUTH"
        ? "Pinterest rejected the current connection."
        : error.code === "PINTEREST_RATE_LIMIT"
          ? "Pinterest is temporarily rate-limiting MoodWire."
          : error.code === "PINTEREST_NOT_FOUND"
            ? "Pinterest could not find that reference for the connected account."
            : "Pinterest could not complete the request.",
      retryable: error.retryable,
      retry_after_seconds: error.retryAfterSeconds ?? null,
      action,
      request_id: requestId,
    };
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  const lower = message.toLowerCase();
  const code = lower.includes("timed out") ? "TIMEOUT" : lower.includes("valid url") || lower.includes("pinterest link") ? "INVALID_REFERENCE" : lower.includes("not configured") ? "NOT_CONFIGURED" : "MOODWIRE_ERROR";
  return {
    code,
    message,
    user_message: code === "TIMEOUT" ? "The request took too long." : code === "INVALID_REFERENCE" ? "MoodWire could not recognise that Pinterest reference." : code === "NOT_CONFIGURED" ? "MoodWire is not fully configured yet." : "MoodWire could not complete the request.",
    retryable: code === "TIMEOUT",
    action: code === "INVALID_REFERENCE" ? "Paste a Pinterest board, Pin, pin.it, or direct pinimg URL." : code === "NOT_CONFIGURED" ? "Configure the Pinterest connection on the Worker." : "Retry once. If it fails again, use the request ID when checking logs.",
    request_id: requestId,
  };
}

function log(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "moodwire", event, ts: new Date().toISOString(), ...data }));
}

async function runTool<T extends { content: unknown[] }>(tool: string, requestId: string, fn: () => Promise<T>): Promise<T | { isError: true; content: ReturnType<typeof jsonText>[] }> {
  const started = Date.now();
  log("tool_start", { tool, request_id: requestId });
  try {
    const result = await fn();
    log("tool_success", { tool, request_id: requestId, duration_ms: Date.now() - started });
    return result;
  } catch (error) {
    const issue = issueFrom(error, requestId);
    console.error(JSON.stringify({ service: "moodwire", event: "tool_error", ts: new Date().toISOString(), tool, request_id: requestId, duration_ms: Date.now() - started, code: issue.code, message: issue.message }));
    return { isError: true, content: [jsonText({ ok: false, issue })] };
  }
}

async function resolveReference(url: string, token: string, limit = 48) {
  const reference = await resolvePinterestUrl(url);

  if (reference.kind === "pin") {
    const pin = normalisePin(await getPin(reference.pinId, token));
    return { kind: "pin" as const, requested_url: url, resolved_url: reference.url, pin, suggestions: suggestionsFor("pin") };
  }

  if (reference.kind === "media") {
    return { kind: "media" as const, requested_url: url, resolved_url: reference.url, media: [{ url: reference.url }], suggestions: suggestionsFor("media") };
  }

  if (reference.kind === "board") {
    const boards = await listBoards(token, 1000);
    const wantedSlug = slugify(reference.boardSlug);
    const wantedUser = reference.username.toLowerCase();
    const board = boards.find((item) => {
      const owner = item.owner?.username?.toLowerCase();
      return slugify(item.name) === wantedSlug && (!owner || owner === wantedUser);
    });
    if (!board) throw new PinterestApiError("Board was not found in the connected Pinterest account", 404);
    const pins = (await listBoardPins(board.id, token, Math.min(limit, 500))).map(normalisePin);
    return { kind: "board" as const, requested_url: url, resolved_url: reference.url, board, pins, preview_count: pins.length, suggestions: suggestionsFor("board") };
  }

  throw new Error("Pinterest URL was recognised but its resource type could not be determined");
}

function assertPinimgUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (host !== "i.pinimg.com" && !host.endsWith(".pinimg.com")) throw new Error("Only Pinterest pinimg media URLs can be loaded directly");
  return url.toString();
}

function createServer(env: Env, requestId: string) {
  const token = requireToken(env);
  const server = new McpServer({ name: "MoodWire", version: "0.2.0" });

  server.registerTool(
    "resolve_pinterest_reference",
    {
      description: "Resolve a Pinterest Pin, board, pin.it short link, or direct pinimg media URL. Returns visual metadata plus suggested next actions. Board previews default to 48 items for faster first response.",
      inputSchema: { url: z.string().url(), limit: z.number().int().min(1).max(500).optional() },
    },
    async ({ url, limit }) => runTool("resolve_pinterest_reference", requestId, async () => ({ content: [jsonText(await resolveReference(url, token, limit ?? 48))] })),
  );

  server.registerTool(
    "list_pinterest_boards",
    { description: "List boards from the Pinterest account connected to MoodWire. Warm Worker instances cache board lists briefly for faster repeated retrieval.", inputSchema: { limit: z.number().int().min(1).max(1000).optional() } },
    async ({ limit }) => runTool("list_pinterest_boards", requestId, async () => ({ content: [jsonText({ boards: await listBoards(token, limit ?? 250) })] })),
  );

  server.registerTool(
    "get_pinterest_board_media",
    {
      description: "Get normalised image, GIF, video, stream and source URLs for Pins in one Pinterest board.",
      inputSchema: { board_id: z.string().min(1), limit: z.number().int().min(1).max(500).optional() },
    },
    async ({ board_id, limit }) => runTool("get_pinterest_board_media", requestId, async () => {
      const pins = (await listBoardPins(board_id, token, limit ?? 48)).map(normalisePin);
      return { content: [jsonText({ board_id, pins, suggestions: suggestionsFor("board") })] };
    }),
  );

  server.registerTool(
    "get_pinterest_pin",
    { description: "Get one Pinterest Pin and all visual media URLs MoodWire can discover for it.", inputSchema: { pin_id: z.string().regex(/^\d+$/) } },
    async ({ pin_id }) => runTool("get_pinterest_pin", requestId, async () => ({ content: [jsonText({ pin: normalisePin(await getPin(pin_id, token)), suggestions: suggestionsFor("pin") })] })),
  );

  server.registerTool(
    "search_pinterest_board",
    {
      description: "Search Pin titles and descriptions within a board. Useful for narrowing a large visual-reference board before loading images.",
      inputSchema: { board_id: z.string().min(1), query: z.string().min(1), scan_limit: z.number().int().min(1).max(500).optional(), result_limit: z.number().int().min(1).max(50).optional() },
    },
    async ({ board_id, query, scan_limit, result_limit }) => runTool("search_pinterest_board", requestId, async () => {
      const q = query.trim().toLowerCase();
      const pins = (await listBoardPins(board_id, token, scan_limit ?? 200)).map(normalisePin).filter((pin) => `${pin.title ?? ""} ${pin.description ?? ""}`.toLowerCase().includes(q)).slice(0, result_limit ?? 25);
      return { content: [jsonText({ board_id, query, pins })] };
    }),
  );

  server.registerTool(
    "load_reference_images",
    {
      description: "Load the actual pixels for up to 8 Pinterest Pins into MCP image content. Images are fetched in parallel. Video Pins use an available static/poster rendition until temporal frame extraction is enabled.",
      inputSchema: { pin_ids: z.array(z.string().regex(/^\d+$/)).min(1).max(8) },
    },
    async ({ pin_ids }) => runTool("load_reference_images", requestId, async () => {
      const uniqueIds = [...new Set(pin_ids)];
      const results = await Promise.all(uniqueIds.map(async (pinId) => {
        try {
          const pin = normalisePin(await getPin(pinId, token));
          const imageUrl = bestImageUrl(pin);
          if (!imageUrl) return { pin, imageUrl: null, image: null, error: "No static image/poster rendition was exposed by Pinterest" };
          const image = await fetchImageAsMcpContent(imageUrl);
          return { pin, imageUrl, image, error: undefined };
        } catch (error) {
          return { pin: null, pinId, imageUrl: null, image: null, error: error instanceof Error ? error.message : "Image load failed" };
        }
      }));

      const content: Array<ReturnType<typeof jsonText> | Awaited<ReturnType<typeof fetchImageAsMcpContent>>> = [];
      for (const result of results) {
        if (result.pin && result.image) {
          content.push(jsonText({ reference_id: `mw:pin:${result.pin.id}`, pin_id: result.pin.id, title: result.pin.title, source_url: result.pin.source_url, image_url: result.imageUrl }));
          content.push(result.image);
        }
      }
      content.push(jsonText({
        summary: results.map((result) => ({
          reference_id: result.pin ? `mw:pin:${result.pin.id}` : `mw:pin:${result.pinId}`,
          image_url: result.imageUrl,
          error: result.error,
        })),
        suggestions: suggestionsFor("pin"),
      }));
      return { content };
    }),
  );

  server.registerTool(
    "load_pinterest_image_url",
    {
      description: "Load a direct i.pinimg.com image URL as actual MCP image content and return suggested next creative actions.",
      inputSchema: { url: z.string().url() },
    },
    async ({ url }) => runTool("load_pinterest_image_url", requestId, async () => {
      const safeUrl = assertPinimgUrl(url);
      return { content: [jsonText({ reference_id: `mw:media:${safeUrl}`, source_url: safeUrl, suggestions: suggestionsFor("media") }), await fetchImageAsMcpContent(safeUrl)] };
    }),
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const requestId = request.headers.get("cf-ray") || crypto.randomUUID();

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "MoodWire MCP", version: "0.2.0", configured: Boolean(env.PINTEREST_ACCESS_TOKEN?.trim()), request_id: requestId }, { headers: { "x-moodwire-request-id": requestId } });
    }
    if (url.pathname !== "/mcp") return Response.json({ ok: false, issue: { code: "NOT_FOUND", user_message: "MoodWire endpoint not found.", request_id: requestId } }, { status: 404, headers: { "x-moodwire-request-id": requestId } });

    const started = Date.now();
    log("request_start", { request_id: requestId, method: request.method, path: url.pathname });
    try {
      const response = await createMcpHandler(() => createServer(env, requestId), {
        route: "/mcp",
        responseMode: "auto",
        onerror: (error) => console.error(JSON.stringify({ service: "moodwire", event: "mcp_handler_error", ts: new Date().toISOString(), request_id: requestId, message: error instanceof Error ? error.message : String(error) })),
      })(request, env, ctx);
      response.headers.set("x-moodwire-request-id", requestId);
      log("request_end", { request_id: requestId, status: response.status, duration_ms: Date.now() - started });
      return response;
    } catch (error) {
      const issue = issueFrom(error, requestId);
      console.error(JSON.stringify({ service: "moodwire", event: "request_error", ts: new Date().toISOString(), request_id: requestId, duration_ms: Date.now() - started, code: issue.code, message: issue.message }));
      return Response.json({ ok: false, issue }, { status: 500, headers: { "x-moodwire-request-id": requestId } });
    }
  },
} satisfies ExportedHandler<Env>;
