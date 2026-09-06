# MoodWire MCP Worker

Cloudflare Worker that exposes Pinterest visual references through a stateless remote MCP server.

## Endpoint

- `GET /health` — deployment health check
- `POST /mcp` — Streamable HTTP MCP endpoint

The server uses Cloudflare Agents SDK `createMcpHandler()` and MCP SDK v2.

## Tools

- `resolve_pinterest_reference` — accepts full Pinterest Pin/board URLs, `pin.it` short links, and direct `pinimg` media URLs.
- `list_pinterest_boards` — lists boards visible to the connected Pinterest account.
- `get_pinterest_board_media` — returns normalised media references for a board.
- `get_pinterest_pin` — returns one normalised Pin.
- `search_pinterest_board` — text-searches Pin titles/descriptions after retrieving a board.
- `load_reference_images` — fetches and returns actual image bytes for up to eight Pin IDs as MCP image content. This is the important bridge from “metadata about a reference” to “the model can actually see the reference.”

For video Pins, the current implementation loads a static image/poster rendition when Pinterest exposes one. Actual temporal frame extraction is a later media-worker concern.

## Local setup

```bash
cd mcp-worker
npm install
npx wrangler secret put PINTEREST_ACCESS_TOKEN
npm run dev
```

For local-only development you can also use Wrangler local secret files rather than committing credentials.

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
```

Connect it to the local `/mcp` URL printed by Wrangler.

## Deploy

```bash
npm run deploy
```

Then set the production Pinterest token using Wrangler secrets if it was not already configured for the remote Worker.

## Security

The first deploy is a personal/private proof of concept. Do not advertise the Worker URL publicly while it holds a single account-level Pinterest token. Before multi-user/public use, place the MCP route behind OAuth/Cloudflare Access and move Pinterest OAuth credentials to per-user encrypted storage.
