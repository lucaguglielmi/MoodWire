# MoodWire

MoodWire is a read-only visual-reference connector for AI. The first integration is Pinterest.

The product goal is deliberately simple: paste a Pinterest board, Pin, short link or direct Pinterest media URL into an AI conversation, retrieve the real visual references, select the ones that matter, and use them to inform a new original asset.

Examples include:

- generating a new image from several visual references;
- using selected references to define a 3D game asset or environment direction;
- studying typography, palette, composition or material treatment;
- using animation/video references to inform a motion system or animated logo.

Pinterest remains the source of truth. MoodWire retrieves and normalises references; the calling AI interprets them.

## What is implemented

The repository currently contains two complementary pieces.

### Next.js reference browser

The web PoC can:

- connect to Pinterest using OAuth;
- list boards from the authenticated account;
- fetch Pins from a board;
- paste and resolve board URLs, individual Pin URLs, `pin.it` short links and direct `pinimg` media URLs;
- surface image, GIF, video and stream URLs;
- render exposed images/videos;
- select multiple references and copy a stable reference manifest;
- optionally run the earlier server-side visual-analysis experiment.

### Cloudflare MCP Worker

`mcp-worker/` is a separate Cloudflare Worker using the Agents SDK stateless `createMcpHandler()` path and MCP SDK v2.

It exposes:

```text
resolve_pinterest_reference
list_pinterest_boards
get_pinterest_board_media
get_pinterest_pin
search_pinterest_board
load_reference_images
load_pinterest_image_url
```

The important tool is `load_reference_images`: rather than only returning image URLs or descriptions, it fetches up to eight selected Pinterest images/posters and returns their actual pixels as MCP image content. A vision-capable MCP client can therefore inspect the references directly.

For video Pins, the first implementation uses any available static/poster rendition. Representative video-frame extraction is intentionally deferred to a media worker because Pinterest direct video access varies by app/account and ffmpeg is better suited to a container runtime.

## Intended AI workflow

```text
Pinterest URL
     ↓
MoodWire resolves board / Pin / media
     ↓
metadata + stable IDs
     ↓
AI/user narrows references
     ↓
load_reference_images(selected Pin IDs)
     ↓
actual image pixels enter model context
     ↓
create an original image / 3D direction / motion concept
```

Stable IDs use forms such as `mw:pin:123456789` so a user-facing gallery can show simple numbers while the AI retains exact source identity.

See [`docs/REFERENCE_INGESTION_SPEC.md`](docs/REFERENCE_INGESTION_SPEC.md) for the product contract.

## Hosting direction

MoodWire is **Cloudflare-first**.

- Cloudflare Workers: MCP endpoint, Pinterest adapter and lightweight web/API workloads.
- D1: per-user connection metadata when multi-user persistence is introduced.
- R2: derived media such as sampled animation frames when needed.
- KV: optional non-authoritative cache.
- Queues / Workflows: async processing only where useful.
- Google Cloud Run: escape hatch for ffmpeg/native/heavy processing, not the default application platform.

The existing Next.js 16 PoC can be migrated to Workers with Cloudflare's current `vinext` path after running the compatibility check locally. The MCP worker is already Worker-native and does not depend on that migration.

See [`docs/SERVER_HOSTING_SPEC.md`](docs/SERVER_HOSTING_SPEC.md).

## Web PoC local setup

1. Create a Pinterest developer app and request `boards:read` and `pins:read`.
2. Add `http://localhost:3000/api/pinterest/oauth/callback` as the local callback.
3. Copy `.env.example` to `.env.local` and add Pinterest credentials.
4. Run:

```bash
npm install
npm run dev
```

## MCP Worker local setup

```bash
cd mcp-worker
npm install
npx wrangler secret put PINTEREST_ACCESS_TOKEN
npm run dev
```

Then test the `/mcp` endpoint with MCP Inspector.

From the repo root the convenience commands are:

```bash
npm run mcp:dev
npm run mcp:typecheck
npm run mcp:deploy
```

## Security

Never commit Pinterest secrets, OAuth tokens or OpenAI keys.

The web PoC currently supports a development token/cookie model. The MCP Worker currently supports a single private Pinterest token through a Cloudflare Worker secret and should be treated as a personal/private PoC until the MCP endpoint is protected with OAuth/Cloudflare Access and Pinterest credentials are stored per user.

The public/multi-user architecture must keep MoodWire identity separate from the user's Pinterest OAuth connection, encrypt stored credentials, validate OAuth state, rotate refresh tokens where supported, and never return credentials through MCP tools.

## Validation

GitHub Actions runs typechecking/build validation for the Next.js application and typechecking plus a Wrangler dry-run for `mcp-worker/`.
