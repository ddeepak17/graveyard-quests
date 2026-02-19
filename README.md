# Graveyard Quests

> Social questing on Solana — powered by [Tapestry](https://usetapestry.dev) onchain social graph + a [Torque](https://torque.so)-style loyalty layer.

Connect any Solana wallet (Phantom, Backpack, etc.), create posts and quests, like, comment, mark quests complete with an onchain Solana Memo proof, and track loyalty points on a live leaderboard — all persisted via Tapestry's content graph on devnet.

---

## Bounty Alignment

### Tapestry (Onchain Social)

- **Quests as social content** — quests are Tapestry content nodes with structured `properties` (`type`, `title`, `reward`, `details`). Because `content.properties` can be `null` in feed responses, we store a human-readable `[QUEST]` text fallback and detect quests via a three-tier check.
- **Full social graph** — likes (`POST/DELETE /likes/{id}`), comments (`POST /comments/`, `GET /comments/`), and paginated feed (`GET /contents/`) are all live Tapestry calls made server-side.
- **Completion proof stored as comment** — marking a quest complete posts `✅ Completed: <proof>` directly to Tapestry via `POST /comments/`, making the proof a first-class social object readable by anyone.
- **Optional onchain anchor** — a Solana Memo transaction on devnet encodes the full proof string; the tx signature is embedded in the completion comment and rendered as a clickable Devnet Explorer link.
- **Any Solana wallet** — uses the wallet-standard `signAndSendTransaction` feature with a `signTransaction` + manual RPC fallback, so Phantom, Backpack, and any other wallet-standard wallet works.

### Torque (Loyalty)

- **Rewards layer** — `GET /api/rewards` aggregates Tapestry social activity into a loyalty points score: posts +10, quests +20, quest completions +30, likes/comments received +1 each.
- **Live leaderboard** — scored from the last 50 feed items + all their comments; recomputed server-side on demand, zero extra database.
- **Torque-compatible** — data shape and scoring model are designed to plug into a production Torque loyalty program; swap the scoring backend for the real Torque API to go live.

---

## Features

| Feature | Description |
|---|---|
| **Profile** | Auto-created on first interaction via `profiles/findOrCreate` |
| **Post** | Text posts stored as Tapestry content nodes |
| **Feed** | Paginated feed with cards, raw JSON toggle, and three tabs (All / Quests / My Activity) |
| **Like / Unlike** | Toggle like on any post; unlike passes `startId` as query param to survive HTTP DELETE body stripping |
| **Comments** | Thread comments on any post; list per content ID with author + timestamp |
| **Quests** | Special content nodes with `type`, `title`, `reward`, `details` properties; `[QUEST]` text prefix fallback when `content.properties` is `null` |
| **Mark Complete** | Submits a Solana Memo tx (devnet) anchoring the proof onchain, then posts `✅ Completed: <proof>\nTx: <sig>` as a comment |
| **My Activity** | Dedicated tab showing only your authored posts/quests + your completion proofs |
| **Demo Seed** | One-click: creates a quest + post, comments on it, likes it |
| **Rewards** | Torque-style loyalty scoring — points for posts, quests, completions, and engagement; live leaderboard |

---

## Quick start

### 1. Environment

Create `.env.local` in the project root:

```
TAPESTRY_API_KEY=your_tapestry_api_key_here
```

The key is used **server-side only** in Next.js API routes — never bundled into client code or logged.

### 2. Install & run

```bash
npm install
npm run dev
```

### 3. Demo flow

1. Open [http://localhost:3000/feed](http://localhost:3000/feed) and connect Phantom.
2. Click **Demo seed** to create a quest + post + comment + like in one click.
3. Explore: switch between **All Posts**, **⚔️ Quests**, and **My Activity** tabs.
4. Mark a quest complete — Phantom prompts for a devnet Memo tx. Approve it.
5. Click **🏆 Rewards** to see your loyalty points and the leaderboard.

---

## Tapestry Integration

**Base URL:** `https://api.usetapestry.dev/api/v1`

All Tapestry calls are made from Next.js API routes (`app/api/tapestry/*`) with `TAPESTRY_API_KEY` passed as the `apiKey` query parameter. The key never reaches the browser.

### User flow → Tapestry endpoint mapping

| User action | Our route | Tapestry endpoint | Notes |
|---|---|---|---|
| Connect wallet / first post | `POST /api/tapestry/profile` | `POST /profiles/findOrCreate` | Returns `{ profile, operation }` |
| Create a text post | `POST /api/tapestry/post` | `POST /contents/findOrCreate` | Body: `{ id (uuid), profileId, properties: [{key:"text", value}] }` |
| Create a quest | `POST /api/tapestry/quest` | `POST /contents/findOrCreate` | Same as post but with `type`, `title`, `reward`, `details` properties |
| Load feed | `GET /api/tapestry/feed` | `GET /contents/?profileId=...&pageSize=...&page=...` | Paginated; response has `contents[]` with `socialCounts` |
| Like a post | `POST /api/tapestry/like` | `POST /likes/{contentId}` | Body: `{ startId: profileId }` |
| Unlike a post | `POST /api/tapestry/like` | `DELETE /likes/{contentId}?startId={profileId}` | `startId` in query param — Node.js/undici drops DELETE body |
| Post a comment | `POST /api/tapestry/comment` | `POST /comments/` | Body: `{ profileId, contentId, text }` |
| List comments | `GET /api/tapestry/comments` | `GET /comments/?contentId=...&pageSize=...&page=...` | Returns `{ comments[], page, pageSize }` |

### Quest detection (three-tier fallback)

`content.properties` may be `null` in feed responses. To reliably detect quests, we store a readable text fallback and check three tiers:

1. **`content.type === "quest"`** — if Tapestry inflates the `type` property to a top-level field
2. **`content.properties[].key === "type"` equals `"quest"`** — if the array is present
3. **`content.text` starts with `[QUEST]`** — always present; format: `[QUEST] <title> — Reward: <reward>\n<details>`

### Onchain proof of completion

When a user marks a quest complete, the client builds a Solana Memo transaction on devnet:

```
GRAVEYARD_QUEST_COMPLETE|questId=<ID>|proof=<≤120 chars>|ts=<unix>
```

The wallet signs and sends the tx via Phantom's `signAndSendTransaction` feature. The resulting tx signature is included in the completion comment posted to Tapestry. If the tx fails (insufficient SOL, user rejects), the comment is posted anyway with `Tx: (failed to submit)` — graceful degradation.

---

## Torque (Loyalty) — Rewards Layer

`/rewards` implements a Torque-compatible loyalty scoring system computed live from Tapestry social data.

### Points model

| Activity | Points |
|---|---|
| Create a post | +10 |
| Create a quest | +20 |
| Mark a quest complete (proof comment with `Tx:` or Memo prefix) | +30 |
| Like received on your content | +1 each |
| Comment received on your content | +1 each |

### Server-side aggregation

`GET /api/rewards?walletAddress=...`:

1. Resolves profile via `profiles/findOrCreate` (key stays server-only).
2. Fetches the last 50 feed items for that profile.
3. Fetches comments for every item (max 5 concurrent — rate-limited).
4. Scores each author: content creation + engagement received + completion proofs.
5. Returns `{ profile, totalPoints, breakdown, leaderboard (top 5), computedFrom, computedAt }`.

**Completion proof detection:** a comment is scored if it contains `"✅ Completed:"` AND either a `"Tx:"` signature line or the `"GRAVEYARD_QUEST_COMPLETE"` Memo prefix.

Points are not transferable. They are recomputed from Tapestry data on each request, making this layer fully compatible with a production Torque loyalty integration — just swap the scoring backend.

---

## Routes

```
/              — landing (starter kit)
/profile       — create / view Tapestry profile
/feed          — main feed: posts, quests, my activity, likes, comments
/rewards       — Torque-style points + leaderboard
```

API routes (server-only, `TAPESTRY_API_KEY` never exposed):

```
POST /api/tapestry/profile     — find or create profile
POST /api/tapestry/post        — create a text post
POST /api/tapestry/quest       — create a quest
GET  /api/tapestry/feed        — paginated feed
POST /api/tapestry/like        — like or unlike (action: "like" | "unlike")
POST /api/tapestry/comment     — post a comment
GET  /api/tapestry/comments    — list comments for a content ID
GET  /api/rewards              — Torque-style scoring + leaderboard
```

---

## Build & deploy

```bash
npm run build     # production build (Turbopack)
npm start         # serve production build
```

Deployment: any Node.js host (Vercel, Railway, etc.). Set `TAPESTRY_API_KEY` as an environment variable.

---

## Testing

See [`SMOKE_TEST.md`](./SMOKE_TEST.md) for a complete 5-minute "Golden Path" covering every feature — curl commands + browser verification steps.
