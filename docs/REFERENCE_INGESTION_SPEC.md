# MoodWire Reference Ingestion Specification

Status: **V1 product contract**

## Product goal

MoodWire turns Pinterest into visual memory for AI.

A user should be able to:

1. paste a Pinterest board, Pin, image or short `pin.it` link into ChatGPT;
2. have MoodWire identify the resource and retrieve the underlying visual references using the user's authenticated Pinterest connection;
3. inspect and select one or more references in the conversation;
4. use those references as input for a new creative task such as:
   - generating an original image;
   - defining a 3D asset or environment style;
   - designing a logo or animated identity;
   - extracting composition, typography, palette, material, motion or interaction cues.

MoodWire must remain a retrieval and normalisation layer. The calling model is responsible for interpretation and creation.

## Primary interaction

The target experience is intentionally simple:

```text
User:
Use this as reference:
https://www.pinterest.com/.../some-board/

ChatGPT -> MoodWire:
resolve_reference(url)

MoodWire -> ChatGPT:
board metadata + visual assets + stable reference IDs

ChatGPT:
Displays a browsable set of references and asks/infers which ones matter.

User:
Use 2, 5 and 7. Keep the material language from 2, the silhouette from 5,
and the motion rhythm from 7. Make an original asset for my game.
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

## Image generation workflow

For an image reference, the preferred path is:

```text
Pinterest Pin
   -> MoodWire normalised image URL
   -> model/creative tool receives image reference
   -> original generated asset
```

MoodWire should not pre-compute a generic "Visual DNA" by default. The same reference may be used for completely different questions: colour, composition, character silhouette, UI treatment, typography, material, lighting or motion.

## 3D asset workflow

Pinterest references can be used as visual direction even when the output is not an image.

Example:

```text
3 selected creature references
   -> ChatGPT analyses silhouette / proportions / material / surface language
   -> produces an original 3D asset brief or Three.js implementation direction
```

MoodWire does not need to generate 3D geometry itself. Its role is to reliably get the references into model context.

## Animation and video workflow

Pinterest supports video Pins, but API access to direct `video_url` is restricted for some apps/accounts. Therefore V1 must not depend on direct video URLs always being available.

When a usable video or GIF is available:

```text
video
  -> poster
  -> representative frames
  -> optional contact sheet
  -> direct video URL where permitted
```

For visual reasoning, representative frames are the reliable baseline. Recommended default: 6 frames sampled across the duration.

For motion-sensitive requests such as animated-logo direction, also expose metadata where possible:

- duration;
- looping behaviour;
- dimensions/aspect ratio;
- representative frame timestamps.

Later, motion analysis may add optical-flow or temporal summaries, but this is not necessary for the first usable version.

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

## Originality principle

References are input to a creative transformation, not instructions to reproduce a source work.

When creating a new asset, the model should combine broader characteristics across references and the user's explicit requirements rather than copying a distinctive source composition or asset.

## V1 success criterion

The key end-to-end demo should work as follows:

```text
User pastes a Pinterest board or Pin link in ChatGPT
        ↓
MoodWire resolves it
        ↓
Actual images / video posters appear in the conversation
        ↓
User selects one or more
        ↓
ChatGPT can visually inspect the selected references
        ↓
User asks for a new image, 3D asset direction or animated-logo concept
        ↓
The new output is informed by those references
```

That is the core product. Everything else is secondary.
