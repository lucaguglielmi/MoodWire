# MoodWire Server & Hosting Specification

Status: **Cloudflare-first architecture**

## Goal

MoodWire lets a user authenticate their Pinterest account and expose selected Pinterest boards as visual-reference context to ChatGPT and other MCP-compatible AI clients.

MoodWire is a retrieval and normalisation layer. The calling AI remains responsible for interpreting references and creating original work.

## Hosting decision

### Default platform: Cloudflare Workers

MoodWire should use **Cloudflare Workers as its primary runtime**.

This is also the preferred default for future small MCP connectors built from the same pattern: many independent projects, low traffic, minimal idle cost and fast deployment.

Cloudflare is a strong fit because it provides:

- native remote MCP support through the Cloudflare Agents SDK;
- stateless Streamable HTTP MCP handlers;
- OAuth-capable Workers;
- Workers Secrets for credentials;
- D1, KV, R2, Queues, Workflows and Durable Objects without introducing a second infrastructure platform;
- inexpensive scale-to-zero style economics for many low-volume projects;
- custom domains and `workers.dev` endpoints;
- observability within the same platform.

For new MCP implementations use the current stateless `createMcpHandler()` path and **Streamable HTTP**. Do not build new functionality around deprecated SSE or the deprecated stateful `McpAgent` pattern.

## Application runtime

The existing PoC is Next.js 16. Cloudflare currently recommends **vinext** as the default path for running existing Next.js applications on Workers.

Migration path:

1. run `npx vinext check`;
2. run `npx vinext init` and select Cloudflare Workers;
3. verify all existing route handlers and OAuth cookie behaviour in the Workers runtime;
4. keep normal `next dev` available during migration;
5. use the generated Workers configuration and Cloudflare deployment scripts.

Do not migrate blindly. The current PoC must first pass the vinext compatibility check and production build.

If vinext exposes a compatibility blocker, OpenNext for Cloudflare is the fallback rather than moving the project back to Vercel.

## V1 architecture

MoodWire V1 consists of:

1. **Cloudflare Worker / web app**
   - account/connect UI;
   - Pinterest OAuth routes;
   - Pinterest API adapter;
   - remote MCP `/mcp` endpoint;
   - authentication/session handling.
2. **Pinterest OAuth integration**
   - minimum scopes: `boards:read` and `pins:read`;
   - credentials stored encrypted server-side.
3. **Pinterest adapter**
   - list boards;
   - read a board;
   - read all Pins with pagination;
   - normalise image, GIF, video and stream media.
4. **Optional media processor**
   - only needed when the consuming AI cannot inspect an animation directly;
   - extracts representative frames from video/GIF media.
5. **Minimal account UI**
   - connect Pinterest;
   - connection status;
   - disconnect/reconnect.

## MCP endpoint

Expose a remote MCP endpoint at:

```text
/mcp
```

Use Streamable HTTP and a stateless handler unless a concrete requirement for durable MCP session state emerges.

Initial tool surface:

```text
pinterest_list_boards()

pinterest_get_board(board_id | board_name)

pinterest_get_board_media(
  board_id | board_name,
  limit?,
  section_id?,
  media_types?
)

pinterest_search_board(
  board_id | board_name,
  query
)
```

Recommended media response:

```json
{
  "board": {
    "id": "...",
    "name": "Brand X identity"
  },
  "pins": [
    {
      "id": "...",
      "title": "...",
      "description": "...",
      "source_url": "...",
      "media_type": "image | gif | video | stream",
      "image_url": "...",
      "video_url": "...",
      "poster_url": "...",
      "frames": []
    }
  ]
}
```

Pinterest credentials must never be returned to MCP clients.

## Production topology

```text
ChatGPT / MCP client
        |
        | HTTPS + Streamable HTTP MCP
        v
Cloudflare Worker — MoodWire
        |
        +-- MoodWire auth/session
        |
        +-- Pinterest adapter ------> Pinterest API v5
        |
        +-- encrypted connection ---> D1
        |
        +-- short-lived/cache data -> KV (only where useful)
        |
        +-- derived media ----------> R2
        |
        +-- async processing -------> Queue / Workflow
                                          |
                                          v
                              optional Cloud Run worker
                              (ffmpeg / heavy binaries)
```

## Cloudflare services

### Workers

Primary application, OAuth and MCP runtime.

### D1

Preferred V1 durable store for small amounts of account state:

- MoodWire user ID;
- Pinterest account identifier;
- encrypted Pinterest access token;
- encrypted refresh token where applicable;
- token expiry;
- OAuth connection metadata;
- created/updated timestamps.

Do not ingest all boards and Pins into D1. Pinterest remains authoritative and board content is fetched on demand.

### KV

Optional. Use only for simple ephemeral/cache data where eventual consistency is acceptable, such as board-list cache metadata. Do not use KV as the authoritative credential store.

### R2

Add only when MoodWire starts creating derived media such as sampled animation frames. Do not copy every Pinterest image into R2 by default.

### Queues / Workflows

Add when media processing needs asynchronous orchestration, retries or fan-out. Keep V1 synchronous while retrieval remains cheap and reliable.

### Durable Objects

Not required for V1. Add only if a real need for strongly coordinated per-user or per-session state appears. Do not use Durable Objects merely because the Agents SDK supports them.

## Heavy-media exception: Google Cloud Run

Cloudflare Workers remain the default runtime, but do not force workloads with native binaries into Workers.

Use a small **Google Cloud Run** container when MoodWire needs capabilities such as:

- ffmpeg;
- long video downloads;
- CPU-heavy frame extraction;
- native Node/Python dependencies that are unsuitable for Workers;
- other long-running media processing.

The Worker should enqueue/request the job and store/cache resulting derived assets in R2.

Cloud Run is an implementation escape hatch, not a second general application platform.

## Authentication model

Keep these identities separate:

- **MoodWire user/client authorization** — who may call MoodWire's MCP tools;
- **Pinterest OAuth connection** — which Pinterest account MoodWire may read.

A global `PINTEREST_ACCESS_TOKEN` secret is acceptable only for local/single-user development.

Production requirements:

- OAuth state/CSRF validation;
- secure HTTP-only SameSite cookies where browser sessions are used;
- encrypted server-side token storage;
- explicit disconnect/revoke path;
- refresh-token handling/rotation where supported;
- no credentials in MCP responses or logs;
- MCP authorization must map the caller to the correct Pinterest connection.

## Secrets and bindings

Secrets should be configured using Cloudflare Workers Secrets rather than committed files.

Logical configuration:

```text
PINTEREST_CLIENT_ID
PINTEREST_CLIENT_SECRET
PINTEREST_REDIRECT_URI
TOKEN_ENCRYPTION_KEY
APP_BASE_URL
SESSION_SECRET
```

Development / optional:

```text
PINTEREST_ACCESS_TOKEN
OPENAI_API_KEY
OPENAI_MODEL
```

Cloudflare bindings should be used for D1, R2, KV and Queues rather than URL/key environment variables wherever possible.

`OPENAI_API_KEY` should not be required by the final connector. MoodWire should return usable visual references and let ChatGPT interpret them.

## Media handling

### Static images

Return the best available image URL plus useful metadata such as dimensions and source Pin URL.

### Animated Pins

Normalise whatever Pinterest exposes into:

- direct video URL;
- HLS/stream URL;
- GIF URL;
- poster/thumbnail;
- duration and dimensions where available.

If the consuming AI cannot inspect the original animation, MoodWire may generate 4–8 representative frames on demand.

Frame extraction should:

- happen only when requested;
- be cached by Pin/media version;
- avoid permanently retaining original media unless required;
- store derived frames in R2 when caching is useful;
- return signed/expiring URLs where appropriate.

## Cache strategy

Suggested initial cache times:

- board list: 5 minutes;
- board Pins: 5 minutes;
- normalised media metadata: 30 minutes;
- extracted frames: content-addressed cache for 7–30 days.

Pinterest remains authoritative.

## Privacy and permissions

V1 principles:

- read-only Pinterest scopes;
- least privilege;
- no Pinterest writes;
- no cross-user cache leakage;
- preserve source Pin URLs;
- make it clear when visual references are being sent to the calling AI;
- never expose OAuth credentials to an MCP client.

## Originality

MoodWire is a retrieval layer, not a copying engine. The calling AI should infer broader visual characteristics rather than reproduce individual references.

A later originality guard could compare generated-output embeddings against source-reference embeddings and flag unusually close matches, but that is outside V1.

## Observability

Record at minimum:

- MCP tool name;
- request duration;
- Pinterest response status;
- rate-limit failures;
- OAuth failures;
- media-normalisation failures;
- user-scoped request ID.

Never log OAuth tokens or secrets.

Use Cloudflare's native Worker observability first. Add an external service such as Sentry only when it provides a concrete debugging advantage.

## Environments

Use three logical environments:

- **local** — local Worker/Next development and optional Pinterest test token;
- **staging** — stable staging Worker URL and Pinterest callback;
- **production** — production domain, Pinterest credentials and durable bindings.

Avoid binding production Pinterest credentials to arbitrary preview deployments.

Suggested endpoints:

```text
local       http://localhost:3000
staging     https://moodwire-staging.<account>.workers.dev
production  https://moodwire.<domain>/mcp
```

## Deployment strategy

Prefer GitHub-connected Cloudflare Workers Builds once the runtime migration is proven.

Desired flow:

```text
feature branch / PR
      |
      v
build + tests
      |
      v
main
      |
      v
Cloudflare production deployment
```

A deployment must not proceed when type-check/build/tests fail.

## Implementation phases

### Phase 1 — migrate runtime and prove Pinterest retrieval

- run the vinext compatibility check against the current PoC;
- initialize Cloudflare Workers support;
- add Worker bindings/configuration;
- deploy a staging Worker;
- authenticate a Pinterest account;
- read a real project board;
- verify exactly what Pinterest exposes for animated Pins.

### Phase 2 — expose retrieval through MCP

- add Cloudflare Agents SDK;
- implement stateless `/mcp` using `createMcpHandler()`;
- implement `list_boards`, `get_board` and `get_board_media`;
- connect MoodWire to ChatGPT;
- ask ChatGPT to read a named project board and reason over returned visuals.

### Phase 3 — production multi-user auth

- add caller identity/session model;
- add encrypted D1 token storage;
- add reconnect/disconnect flows;
- verify account isolation through MCP calls.

### Phase 4 — animation processing only if required

- add R2 derived-media storage;
- add Queue/Workflow orchestration if useful;
- add Cloud Run ffmpeg worker only if Workers cannot perform the required media processing cleanly;
- keep direct media URLs as the preferred path.

### Phase 5 — additional visual sources

Keep the connector model source-agnostic enough to later add Are.na, Cosmos, Figma, uploads or other visual collections without changing the core MoodWire concept.

## Reusable infrastructure direction

MoodWire should establish conventions reusable by future connectors:

```text
project-name/
├── src / app
├── tools
├── auth
├── adapters
├── wrangler config
└── docs
```

Standardise across projects:

- `/mcp` endpoint;
- Streamable HTTP;
- Cloudflare Workers Secrets;
- OAuth helper pattern;
- D1 migrations when persistence is needed;
- R2 naming/cache conventions;
- structured tool errors;
- request IDs/logging;
- staging + production Worker environments.

The goal is to make a new connector mostly an adapter and tool-definition exercise rather than a new infrastructure project.

## V1 non-goals

Do not build yet:

- Pinterest write/create-Pin tools;
- a full moodboard editor;
- permanent ingestion of all user boards;
- vector database/embeddings by default;
- mandatory server-side AI analysis;
- logo generation inside MoodWire;
- complex team/workspace permissions;
- Durable Objects without a demonstrated need;
- Cloud Run unless media processing actually needs it.

## Success criterion

V1 succeeds when a user can connect Pinterest once, then inside ChatGPT invoke MoodWire and ask it to read a named project board, with ChatGPT receiving enough real visual media to reason about those references without manual image uploads.
