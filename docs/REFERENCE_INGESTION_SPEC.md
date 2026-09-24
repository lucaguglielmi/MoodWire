# MoodWire Reference Ingestion Specification

Status: **personal experiment, single-user**

## Product goal

MoodWire is a personal experiment that lets a Pinterest board or Pin be browsed from inside an AI conversation.

A user should be able to:

1. paste a Pinterest board, Pin, image or short `pin.it` link into an AI conversation;
2. have MoodWire identify the resource and retrieve the underlying visual references using the user's own authenticated Pinterest connection;
3. inspect and select one or more references in the conversation;
4. keep talking about those references — asking questions about them, comparing them, or discussing what stands out.

MoodWire is only a retrieval and normalisation layer. It does not interpret, transform, or generate anything from Pinterest content itself — whatever happens with the retrieved references is between the user and the AI assistant they're using.

## Primary interaction

The target experience is intentionally simple:

```text
User:
Take a look at this board:
https://www.pinterest.com/.../some-board/

AI assistant -> MoodWire:
resolve_reference(url)

MoodWire -> AI assistant:
board metadata + visual assets + stable reference IDs

AI assistant:
Displays a browsable set of references and asks/infers which ones matter.

User:
Show me 2, 5 and 7 in more detail.
```

A direct Pin link should skip the board-selection step.

## Supported input URLs

V1 should accept:

- full Pinterest Pin URLs such as `/pin/{pin_id}/`;
- full Pinterest board URLs such as `/{username}/{board-slug}/`;
- `pin.it` short links, resolved server-side by following redirects;
- direct `i.pinimg.com` media links when the user already has one.

The URL is only an identifier. MoodWire should use the authenticated Pinterest API wherever possible rather than scraping Pinterest HTML.

## Canonical MCP tool surface

Prefer resource-oriented tools over Pinterest-specific conversational actions.

```text
resolve_reference(
  url,
  limit?
)
```

Returns either a board, a Pin or direct media after resolving short links.

```text
list_boards()
```

Returns boards from the connected account for discovery when the user does not have a URL.

```text
get_board_media(
  board_id | board_name,
  limit?,
  section_id?,
  media_types?
)
```

```text
get_reference_media(
  reference_id,
  rendition?
)
```

The last tool provides a specific selected asset in a form useful to the AI client.

## Stable reference IDs

Every returned item should receive a compact conversation-safe ID, for example:

```text
mw:pin:123456789
mw:pin:987654321
mw:frame:123456789:03
```

This lets users say "use 2, 5 and 7" while the model can retain stable machine identifiers beneath the UI.

## Normalised media model

```json
{
  "reference_id": "mw:pin:123456789",
  "source": "pinterest",
  "source_url": "https://www.pinterest.com/pin/123456789/",
  "title": "...",
  "description": "...",
  "media_type": "image | gif | video | stream",
  "image_url": "https://...",
  "poster_url": "https://...",
  "video_url": "https://...",
  "frames": [],
  "width": 1200,
  "height": 1600,
  "duration_ms": null
}
```

Return the highest useful image rendition available rather than only thumbnails.

## Images inside ChatGPT

The intended UX is to make the references visible, not merely describe them as text.

MoodWire should support two complementary representations:

1. **Model-readable media** — direct image URLs or image content that can be passed to a vision-capable model.
2. **Human-visible media** — an Apps SDK / MCP UI component that renders the returned board or Pin as a visual gallery inside ChatGPT, with numbered items and source links.

The gallery is not a permanent moodboard editor. It is a temporary selection surface for the conversation.

When the user selects references, the model should request only those full-resolution assets rather than repeatedly moving the entire board through context.

## What happens after retrieval

Once a reference is retrieved, MoodWire's job is done. It does not pre-compute any analysis or "Visual DNA" of a reference by default — the same image might matter to the user for entirely different reasons on different days (colour, composition, typography, material, or nothing analytical at all, just wanting to see it again). Whatever use the user and their AI assistant make of a retrieved reference happens entirely within their own conversation, outside MoodWire.

## Video and animated Pins

Pinterest supports video Pins, but API access to direct `video_url` is restricted for some apps/accounts, so V1 must not depend on direct video URLs always being available.

When a usable video or GIF is available:

```text
video
  -> poster
  -> representative frames (if extraction is added)
  -> direct video URL where permitted
```

For now, a static poster/thumbnail rendition is the reliable baseline. If representative-frame sampling is added later, useful accompanying metadata includes duration, looping behaviour, and dimensions/aspect ratio.

## Gallery UX

For a board, ChatGPT should be able to show a compact grid/carousel containing:

- thumbnail/poster;
- item number;
- image/video indicator;
- short Pin title when useful;
- source link.

The model can then refer to both user-facing indices and stable `reference_id`s.

Example:

```text
[1] image   [2] video   [3] image   [4] image
[5] gif     [6] image   [7] video   [8] image
```

The user should not need to open Pinterest again merely to tell ChatGPT which reference they mean.

## Context and performance

Do not send every full-resolution board image to the model automatically.

Recommended flow:

1. board request returns metadata + thumbnails/posters;
2. model/user narrows the set;
3. MoodWire fetches high-quality renditions for selected references;
4. only selected references enter expensive vision/generation context.

Default board preview: 20–40 items. Pagination remains available.

## URL-resolution behaviour

### Full Pin URL

Extract numeric Pin ID and call Pinterest `GET /v5/pins/{pin_id}`.

### Full board URL

For boards belonging to the connected account, match `{username}/{board-slug}` against the authenticated board list, then fetch board Pins with pagination.

### pin.it URL

Follow the HTTP redirect server-side, then process the resulting canonical Pinterest URL.

### Direct Pin media URL

Return it as a media reference and preserve its source URL. Where provenance to a Pin is unknown, do not invent Pin metadata.

## Permissions and limitations

V1 remains read-only and uses `boards:read` and `pins:read`.

Known Pinterest limitation: direct video URLs can be unavailable unless the Pinterest app/account has access to the restricted `video_url` feature. Poster images and other media metadata should still be used when available.

Board URL resolution in V1 is guaranteed for boards discoverable through the authenticated user's board list. Arbitrary third-party board URLs may require a later public-resource resolution strategy if Pinterest's API does not expose a supported lookup path.

## Scope boundary

MoodWire's responsibility ends at handing back an accurate, unmodified copy of what Pinterest already returns for the connected account's own content, with a clear link back to the source Pin. It does not analyse, transform, remix, or reproduce Pinterest content as a new work in its own right.

## V1 success criterion

The key end-to-end demo should work as follows:

```text
User pastes a Pinterest board or Pin link into the AI conversation
        ↓
MoodWire resolves it
        ↓
Actual images / video posters appear in the conversation
        ↓
User selects one or more
        ↓
The AI assistant can visually inspect the selected references
```

That is the core product. Everything else is secondary.
