# MoodWire Server & Hosting Specification

Status: **Initial architecture spec**

## Goal

MoodWire lets a user authenticate their Pinterest account and expose selected Pinterest boards as visual-reference context to ChatGPT and other MCP-compatible AI clients.

MoodWire should retrieve and normalise references. The calling AI should remain responsible for interpreting the visual language and generating original work.

## V1 architecture

MoodWire V1 consists of:

1. **Remote MCP / ChatGPT app endpoint**
   - Read-only tools.
   - Hosted over HTTPS.
   - Maps each MoodWire user to their Pinterest OAuth connection.
2. **Pinterest OAuth integration**
   - Minimum scopes: `boards:read` and `pins:read`.
   - Access and refresh credentials stored server-side.
3. **Pinterest adapter**
   - List boards.
   - Read a board.
   - Read all Pins with pagination.
   - Normalise image, GIF, video and stream media.
4. **Optional media worker**
   - Only needed when an AI client cannot inspect an animation directly.
   - Samples representative frames from video/GIF media.
5. **Minimal account UI**
   - Connect Pinterest.
   - Connection status.
   - Disconnect/reconnect.

## MCP tool contract

Keep the first tool surface deliberately small:

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

## Hosting decision

### Recommended V1: Vercel

Use Vercel for the Next.js app, OAuth routes and remote MCP HTTP endpoint.

Reasons:

- the current PoC is already Next.js;
- HTTPS and production deployments are simple;
- environment variables are easy to manage;
- Pinterest API calls fit normal server-side route handlers;
- this keeps the first production deployment operationally small.

### Video/frame-processing exception

Do not make ffmpeg a hard dependency of Vercel serverless routes.

First, test whether direct Pinterest video/GIF URLs are sufficient for ChatGPT. Only add frame extraction if needed.

If frame extraction becomes necessary, use a small containerised worker such as Fly.io, Railway or Render. The main Vercel app can request frames and receive signed URLs to cached output.

## Production topology

```text
ChatGPT / MCP client
        |
        | HTTPS + MCP
        v
MoodWire app/server (Vercel)
        |
        +-- MoodWire auth/session
        |
        +-- Pinterest adapter ------> Pinterest API v5
        |
        +-- encrypted token store --> Postgres
        |
        +-- optional media worker --> ffmpeg
                                      |
                                      +--> object storage/cache
```

## Database

Use Postgres only for durable account/auth state in V1:

- MoodWire user ID;
- Pinterest account identifier;
- encrypted Pinterest access token;
- encrypted refresh token where applicable;
- token expiry;
- OAuth connection metadata;
- created/updated timestamps.

Do not ingest every board and Pin into the database initially. Pinterest remains the source of truth and board content is fetched on demand.

Supabase Postgres or Neon are both suitable.

## Authentication model

Keep these identities separate:

- **MoodWire user/session** — who is calling the connector;
- **Pinterest OAuth connection** — which Pinterest account MoodWire may read.

A global `PINTEREST_ACCESS_TOKEN` environment variable is acceptable only for local development.

Production requirements:

- OAuth state/CSRF validation;
- secure HTTP-only SameSite cookies;
- encrypted server-side token storage;
- explicit disconnect/revoke path;
- refresh-token handling/rotation where supported;
- no credentials in MCP responses or logs.

## Environment variables

Production:

```text
PINTEREST_CLIENT_ID
PINTEREST_CLIENT_SECRET
PINTEREST_REDIRECT_URI
DATABASE_URL
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

`OPENAI_API_KEY` should not be required by the final connector. MoodWire should ideally return the raw usable visual references and let ChatGPT perform the interpretation.

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
- use signed/expiring URLs where possible.

## Cache strategy

Suggested initial cache times:

- board list: 5 minutes;
- board Pins: 5 minutes;
- normalised media metadata: 30 minutes;
- extracted frames: content-addressed cache for 7–30 days.

Pinterest remains authoritative.

## Privacy and permissions

V1 principles:

- read-only;
- least-privilege Pinterest scopes;
- no Pinterest writes;
- no cross-user cache leakage;
- preserve source Pin URLs;
- make it clear when visual references are being sent to the calling AI;
- do not imply that referenced work becomes training data.

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

Never log OAuth tokens or secrets. Sentry or equivalent is appropriate.

## Environments

Use three environments:

- **local** — localhost OAuth callback and optional test token;
- **preview/staging** — separate callback URL and test users;
- **production** — production Pinterest app credentials and database.

Avoid using production OAuth credentials in arbitrary preview deployments.

## Implementation phases

### Phase 1 — prove real Pinterest media retrieval

- Deploy the existing PoC.
- Authenticate a Pinterest account.
- Read a real project board.
- Verify exactly what Pinterest exposes for animated Pins.

### Phase 2 — expose retrieval through MCP

- Add remote MCP endpoint.
- Implement `list_boards`, `get_board` and `get_board_media`.
- Connect MoodWire to ChatGPT.
- Ask ChatGPT to read a named project board and reason over the returned visuals.

### Phase 3 — production multi-user auth

- Add MoodWire user/session model.
- Add encrypted database token storage.
- Add reconnect/disconnect flows.

### Phase 4 — animation processing only if required

- Add on-demand frame extraction.
- Add object storage/cache.
- Keep direct media URLs as the preferred path.

### Phase 5 — additional visual sources

Keep the connector model source-agnostic enough to later add Are.na, Cosmos, Figma, uploads or other visual collections without changing the core MoodWire concept.

## V1 non-goals

Do not build yet:

- Pinterest write/create-Pin tools;
- a full moodboard editor;
- permanent ingestion of all user boards;
- vector database/embeddings by default;
- mandatory server-side AI analysis;
- logo generation inside MoodWire;
- complex team/workspace permissions.

## Success criterion

V1 succeeds when a user can connect Pinterest once, then inside ChatGPT invoke MoodWire and ask it to read a named project board, with ChatGPT receiving enough real visual media to reason about those references without manual image uploads.
