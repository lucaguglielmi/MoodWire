# MoodWire Privacy Policy

_Last updated: 2026-09-24_

MoodWire is a personal, single-user tool. It is not a public product, does not have user accounts, and does not collect or process data belonging to anyone other than its one operator (the person who deployed it and connected their own Pinterest account).

## What MoodWire accesses

MoodWire connects to the Pinterest API using a personal access token that the operator generates for their own Pinterest account and stores as a private secret on their own Cloudflare Worker. Using that token, MoodWire can read:

- the operator's Pinterest boards;
- Pins on those boards (titles, descriptions, and image/video media URLs);
- individual Pins the operator looks up directly.

MoodWire only ever reads data belonging to the Pinterest account the operator explicitly connected. It does not access any other Pinterest account, and it requests read-only scopes (`boards:read`, `pins:read`) — it cannot create, edit, or delete anything on Pinterest.

## What MoodWire does with that data

Pinterest data retrieved by MoodWire is returned directly to the operator's own conversation with their own AI assistant (an MCP client such as Claude), so the operator can use those images/videos as visual references. MoodWire does not:

- share, sell, or transmit Pinterest data to any third party other than the AI assistant the operator directly and knowingly invoked;
- use Pinterest data to train or fine-tune any AI/ML model;
- run any analytics, tracking, or advertising service;
- maintain user accounts, since there is only one user (the operator).

## Storage and retention

MoodWire does not maintain a database of Pinterest content. Board and Pin metadata may be held briefly (a few minutes) in the memory of the Cloudflare Worker instance handling a request, purely to avoid redundant API calls, and is discarded automatically — it is not written to persistent storage. The Pinterest access token itself is stored only as an encrypted Cloudflare Worker secret and is never returned in any MoodWire response or written to logs.

## Revoking access

The operator can revoke MoodWire's access to their Pinterest account at any time from Pinterest's own account settings (disconnecting the app), and can independently take the Cloudflare Worker offline at any time.

## Contact

This tool is operated by a single individual for personal use. Questions can be directed to the repository owner via the project's GitHub repository.
