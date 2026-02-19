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

## curl smoke-test commands (replace `KEY` and `WALLET` values)

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
  "http://localhost:3000/api/tapestry/feed?walletAddress=<WALLET>&pageSize=5&page=1" \
  | jq '.contents | length, .[0].content.text'
```
Expected: a non-zero count and `"smoke test post"` (or your last posted text) for the first item.

### 4 – Like / Unlike a post (via Next.js route)

Set your values once, then run the like and unlike commands:

```bash
WALLET="<your-wallet-address>"   # e.g. "AbCd...1234"

# Fetch the first content id from the feed
CONTENT_ID=$(curl -s \
  "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=5&page=1" \
  | jq -r '.contents[0].content.id')

echo "CONTENT_ID=${CONTENT_ID}"
```

```bash
# Like
curl -s -X POST http://localhost:3000/api/tapestry/like \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\",\"contentId\":\"${CONTENT_ID}\",\"action\":\"like\"}" \
  | jq .
```
Expected: `{}` or `{ "success": true }` (Tapestry returns an empty 200 body).

```bash
# Unlike
curl -s -X POST http://localhost:3000/api/tapestry/like \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\",\"contentId\":\"${CONTENT_ID}\",\"action\":\"unlike\"}" \
  | jq .
```
Expected: `{}` or `{ "success": true }`.

**Verify like incremented:**
```bash
curl -s \
  "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=5&page=1" \
  | jq ".contents[] | select(.content.id==\"${CONTENT_ID}\") | .socialCounts.likeCount"
```
Expected: count is **1** (or N+1 vs before the like).

**Verify unlike decremented:**
```bash
# Run unlike first (command above), then re-check the count
curl -s \
  "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=5&page=1" \
  | jq ".contents[] | select(.content.id==\"${CONTENT_ID}\") | .socialCounts.likeCount"
```
Expected: count is **0** (or N, back to the value before the like).

### 5 – Create a comment (via Next.js route)

> Uses `WALLET` and `CONTENT_ID` set in step 4.

```bash
# Post a comment
curl -s -X POST http://localhost:3000/api/tapestry/comment \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\",\"contentId\":\"${CONTENT_ID}\",\"text\":\"smoke test comment\"}" \
  | jq .
```
Expected: `{ "id": "<uuid>", "created_at": <timestamp>, "text": "smoke test comment" }` (CommentSchema).

### 6 – List comments for a post (via Next.js route)

```bash
curl -s \
  "http://localhost:3000/api/tapestry/comments?contentId=${CONTENT_ID}&pageSize=10&page=1" \
  | jq '.comments | length, .[0].comment.text, .[0].author.username'
```
Expected: count ≥ 1, `"smoke test comment"` as the text, and the commenter's username.

**Verify commentCount incremented in feed:**
```bash
curl -s \
  "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=5&page=1" \
  | jq ".contents[] | select(.content.id==\"${CONTENT_ID}\") | .socialCounts.commentCount"
```
Expected: count is **1** (or N+1 vs before the comment).

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

### Test 4 – Comments: view and post

1. Load the feed and connect Phantom.
2. Click **💬 N comments** on any post card.  
   Expected: section expands; existing comments render (author + text + timestamp). If none: "No comments yet."
3. Type a comment in the input and click **Send** (or press Enter).  
   Expected: input clears, comment list reloads showing the new comment, commentCount in the button increments.
4. Collapse and re-expand the section.  
   Expected: comments reload from the server and still show the posted comment.
5. Reload the page, load feed, re-expand comments.  
   Expected: comment persists (stored in Tapestry).

### Test 6 – Like / Unlike a post

1. Load the feed and connect Phantom.
2. Click **♡ Like** on any post card.  
   Expected: button changes to **♥ Liked** (purple tint), like count increments after feed refresh.
3. Click **♥ Liked** on the same post.  
   Expected: button reverts to **♡ Like**, like count decrements after refresh.
4. Reload the page and re-load the feed.  
   Expected: likeCount persists (stored in Tapestry); button starts unlocked until you interact again.

### Test 7 – Error handling (optional / destructive)

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
| Like increments | likeCount +1, button shows ♥ Liked (optimistic then confirmed after refresh) |
| Unlike decrements | likeCount -1, button reverts to ♡ Like after refresh |
| Like count persists | After page reload and feed refresh, likeCount reflects server state |
| Comment posted | CommentSchema `{ id, created_at, text }` returned, no error |
| Comments listed | `{ comments: [...], page, pageSize }` — author + text visible in card |
| commentCount increments | Feed shows updated count after posting a comment |
| Comments persist | After page reload, comments still visible via list endpoint |
| Bad key | Error banner with details, no key leak |
