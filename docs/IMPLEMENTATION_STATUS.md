# MoodWire Implementation Status

Updated: 2026-09-06

## Working in code

### Pinterest retrieval

- Pinterest OAuth routes in the Next.js PoC.
- Board listing with pagination.
- Board Pin listing with pagination.
- Individual Pin lookup.
- Media URL discovery across Pinterest media payloads.
- Image/GIF/video/HLS classification.
- Full Pinterest Pin URL parsing.
- Full Pinterest board URL parsing.
- `pin.it` short-link resolution by following redirects.
- Direct `pinimg` media URL recognition.

### Reference browser

- Paste a Pinterest URL and resolve it.
- Browse a connected Pinterest board.
- Render image/video references where direct media is available.
- Select one or more references.
- Stable reference IDs (`mw:pin:{id}`).
- Copy a selected reference manifest for debugging/interoperability.
- Optional legacy Visual DNA experiment remains available but is not part of the core architecture.

### MCP server

A Worker-native stateless MCP server exists in `mcp-worker/` using Cloudflare Agents SDK `createMcpHandler()` and MCP SDK v2.

Implemented tools:

- `resolve_pinterest_reference`
- `list_pinterest_boards`
- `get_pinterest_board_media`
- `get_pinterest_pin`
- `search_pinterest_board`
- `load_reference_images`
- `load_pinterest_image_url`

`load_reference_images` is the critical model-context bridge: it fetches selected Pinterest image/poster bytes and returns them as MCP image content rather than merely returning URLs or text descriptions.

### Cloudflare

- Dedicated Worker package.
- Wrangler configuration.
- `/health` endpoint.
- `/mcp` endpoint.
- Worker observability enabled.
- CI includes Worker typecheck and Wrangler dry-run.

## Deliberately not implemented yet

### Production MCP authentication

The current Worker uses a single account-level `PINTEREST_ACCESS_TOKEN` Worker secret. This is suitable only for a private proof of concept.

Before a public/multi-user deployment:

- protect `/mcp` with an MCP-compatible OAuth flow / Cloudflare Access;
- map each MoodWire identity to its own Pinterest OAuth connection;
- encrypt Pinterest access/refresh tokens at rest;
- store per-user connection metadata in D1 or an equivalent durable store;
- implement disconnect/revoke and refresh-token rotation.

This boundary is intentional: deploying the current single-token endpoint publicly would expose the connected Pinterest account to anyone who could invoke the MCP tools.

### Video frame extraction

The Worker returns video/HLS URLs when Pinterest exposes them and can load static/poster renditions. It does not run ffmpeg.

When direct video reasoning is insufficient, add a small Cloud Run media service that:

1. receives a validated Pinterest video/media URL from MoodWire;
2. downloads it temporarily;
3. samples approximately six representative frames;
4. stores derived frames in R2 using content-addressed keys;
5. returns signed/expiring frame URLs;
6. deletes transient originals.

Do this only after a real Pinterest API response proves that the feature is necessary and that usable video URLs are available.

### Embedded ChatGPT gallery

The web PoC already demonstrates the selection interaction. The production in-chat gallery depends on the ChatGPT app/MCP client surface used for deployment.

The MCP layer has been designed so that a gallery can be added without changing source semantics: it already returns stable IDs, source URLs, media URLs and actual MCP image content on selection.

## Validation

The repository now contains a GitHub Actions workflow that performs:

- Next.js TypeScript check;
- Next.js production build;
- MCP Worker TypeScript check;
- Wrangler deployment dry-run.

A passing CI run is required before considering this implementation verified.

## Definition of first usable private demo

The private V1 demo is complete when all of the following are true:

1. Pinterest credentials are configured.
2. `moodwire-mcp` is deployed to Cloudflare Workers.
3. MCP Inspector can connect to `/mcp`.
4. A pasted board or Pin URL resolves through `resolve_pinterest_reference`.
5. `load_reference_images` returns visible/model-readable image content for selected Pin IDs.
6. An MCP-capable AI can use those images to reason about a new, original creative asset.

The remaining blockers for that demo are deployment credentials/account access, not missing core retrieval code.
