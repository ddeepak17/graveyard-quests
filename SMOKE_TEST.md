# Smoke Test – Graveyard Quests (Tapestry integration)

## Tapestry API base

All server-side fetch calls hit `https://api.usetapestry.dev/api/v1` (confirmed from live OpenAPI spec).

## Correct Tapestry endpoint map

| Operation | Method | Path |
|-----------|--------|------|
| Create / find profile | POST | `/profiles/findOrCreate` |
| Create content (post) | POST | `/contents/findOrCreate` |
| List content by profile | GET | `/contents/` + `?profileId=...&pageSize=...&page=...` |

> `/contents/create` and `/contents/profile/{id}` do **not exist** in the spec and will 404.

## Content body shape

`POST /contents/findOrCreate` expects:
```json
{
  "id": "<uuid>",
  "profileId": "<profile.id from findOrCreate response>",
  "properties": [{ "key": "text", "value": "the post content" }]
}
```
The `id` must be unique per content node; the route uses `crypto.randomUUID()`.

---

## Pre-requisites

- `TAPESTRY_API_KEY` is set in `.env.local`
- Phantom wallet browser extension is installed
- Dev server is running: `npm run dev`

---

## 3 curl smoke-test commands (replace `<KEY>` and `<WALLET>`)

### 1 – Create / find profile
```bash
curl -s -X POST \
  "https://api.usetapestry.dev/api/v1/profiles/findOrCreate?apiKey=<KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "<WALLET>",
    "username": "smoketest",
    "bio": "",
    "blockchain": "SOLANA",
    "execution": "FAST_UNCONFIRMED"
  }' | jq .
```
Expected: `{ "profile": { "id": "smoketest", "namespace": "...", ... }, "operation": "CREATED"|"FOUND", ... }`

### 2 – Create a post (via Next.js route)
```bash
curl -s -X POST http://localhost:3000/api/tapestry/post \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "<WALLET>",
    "text": "smoke test post"
  }' | jq .
```
Expected: `{ "id": "<uuid>", "namespace": "...", "created_at": ... }` (ContentSchema)

### 3 – Load feed (via Next.js route)
```bash
curl -s \
  "http://localhost:3000/api/tapestry/feed?walletAddress=<WALLET>&limit=5" \
  | jq '.contents | length, .[0].content.text'
```
Expected: a non-zero count and `"smoke test post"` (or your last posted text) for the first item.

---

## Manual browser tests

### Test 1 – Profile: create / load

1. Open `http://localhost:3000/profile`.
2. Click **Connect Phantom** and approve.
3. (Optional) enter username and bio.
4. Click **Create / Load Profile**.  
   Expected: JSON response with `profile.id` and `profile.namespace`. No error banner.
5. Click again.  
   Expected: same `profile.id`, `operation: "FOUND"`.

### Test 2 – Feed: create a post

1. Open `http://localhost:3000/feed` and connect Phantom.
2. Type a message and click **Post**.  
   Expected: text clears, feed auto-refreshes, no error banner.

### Test 3 – Feed: verify post appears

1. Click **Load** on the feed page.  
   Expected: cards appear; the post you just created shows its text.
2. Click **Show raw JSON** to verify the `contents` array shape.
3. Click **Show cards** to return.

### Test 4 – Error handling (optional / destructive)

1. Set `TAPESTRY_API_KEY=bad_key` in `.env.local`, restart dev server.
2. Attempt to post.  
   Expected: red banner with `"Tapestry profile error"` or `"Tapestry content error"` and upstream `details` text — no API key visible.
3. Restore real key, restart.

---

## Pass criteria

| Check | Expected |
|-------|----------|
| Profile created | `profile.id` in response, `operation: "CREATED"` |
| Profile idempotent | Same `profile.id`, `operation: "FOUND"` |
| Post created | ContentSchema `{ id, namespace, created_at }` returned, no error |
| Post visible in feed | Card shows the post text under `@username` |
| Raw JSON toggle | Switches between cards and raw JSON |
| Bad key | Error banner with details, no key leak |
