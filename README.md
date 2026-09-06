# MoodWire

MoodWire is a read-only visual-reference connector for AI. The first integration is Pinterest: authenticate your account, choose a project board, and make its saved images and animations available as reference context.

The current repository contains the initial Next.js proof of concept. It can:

- connect to Pinterest using OAuth;
- list boards from the authenticated account;
- fetch every Pin from a selected board;
- inspect Pinterest media and surface image, GIF, video and stream URLs;
- render directly exposed video assets;
- optionally send static/GIF references to an OpenAI vision model for exploratory visual analysis.

The target product is not a Pinterest clone or moodboard UI. MoodWire should become an MCP/App connector that ChatGPT and other compatible agents can call when a user wants to use a curated board as visual context. Pinterest remains the source of truth.

## Hosting direction

MoodWire is **Cloudflare-first**.

The target runtime is Cloudflare Workers, with a stateless Streamable HTTP MCP endpoint at `/mcp`. The existing Next.js 16 PoC should be migrated using Cloudflare's recommended `vinext` path after running its compatibility check.

Use Cloudflare services incrementally:

- Workers — web app, OAuth, Pinterest adapter and MCP endpoint;
- D1 — encrypted Pinterest connection/account metadata when multi-user persistence is added;
- R2 — derived animation frames only when needed;
- KV — optional non-authoritative cache data;
- Queues / Workflows — asynchronous processing only when required.

Google Cloud Run is reserved as an escape hatch for ffmpeg or other heavy/native media workloads rather than as a second general application platform.

See [`docs/SERVER_HOSTING_SPEC.md`](docs/SERVER_HOSTING_SPEC.md) for the architecture source of truth.

## Local setup

1. Create a Pinterest developer app and request `boards:read` and `pins:read`.
2. Add the callback URL `http://localhost:3000/api/pinterest/oauth/callback`.
3. Copy `.env.example` to `.env.local` and add your Pinterest credentials.
4. Run:

```bash
npm install
npm run dev
```

Optional: set `OPENAI_API_KEY` to enable the current Visual DNA experiment. This analysis should not become a mandatory connector layer; the long-term architecture should return usable visual references to the calling AI and let that AI decide how to interpret them.

## Current test board

The PoC automatically selects **CSS animation reference** when that board exists in the authenticated Pinterest account.

## Security

Do not commit Pinterest secrets, OAuth tokens, or OpenAI keys. The PoC currently stores the Pinterest access token in an HTTP-only cookie. Production must use encrypted server-side token storage and proper refresh-token rotation.
