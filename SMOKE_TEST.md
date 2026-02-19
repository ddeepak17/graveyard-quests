# Smoke Test — Graveyard Quests

> **5-minute Golden Path.** A judge can validate every feature by running these steps in order.

## Setup

```bash
# .env.local must exist with your Tapestry API key
echo "TAPESTRY_API_KEY=your_key_here" > .env.local

npm install
npm run dev        # http://localhost:3000
```

Set your wallet address once (used in all curl commands below):

```bash
WALLET="YOUR_WALLET_ADDRESS"
```

---

## Step 1 — Profile (Tapestry: `POST /profiles/findOrCreate`)

```bash
curl -s -X POST http://localhost:3000/api/tapestry/profile \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\"}" | jq '{id: .profile.id, op: .operation}'
```

**Expected:** `{ "id": "user_XXXXXX", "op": "CREATED" }` (or `"FOUND"` on repeat).

---

## Step 2 — Create a post (Tapestry: `POST /contents/findOrCreate`)

```bash
curl -s -X POST http://localhost:3000/api/tapestry/post \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\",\"text\":\"smoke test post\"}" | jq '{id: .id}'
```

**Expected:** `{ "id": "<uuid>" }` — ContentSchema returned.

---

## Step 3 — Feed shows the post (Tapestry: `GET /contents/`)

```bash
curl -s "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=5&page=1" \
  | jq '{count: (.contents | length), firstText: .contents[0].content.text}'
```

**Expected:** `count ≥ 1`, `firstText` is `"smoke test post"`.

---

## Step 4 — Like + verify count (Tapestry: `POST /likes/{id}`)

```bash
CONTENT_ID=$(curl -s \
  "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=5&page=1" \
  | jq -r '.contents[0].content.id')
echo "CONTENT_ID=${CONTENT_ID}"

# Like
curl -s -X POST http://localhost:3000/api/tapestry/like \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\",\"contentId\":\"${CONTENT_ID}\",\"action\":\"like\"}" | jq .

# Verify likeCount = 1
curl -s "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=5&page=1" \
  | jq ".contents[] | select(.content.id==\"${CONTENT_ID}\") | .socialCounts.likeCount"
```

**Expected:** `1` (or previous count + 1).

---

## Step 5 — Unlike + verify count (Tapestry: `DELETE /likes/{id}`)

```bash
curl -s -X POST http://localhost:3000/api/tapestry/like \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\",\"contentId\":\"${CONTENT_ID}\",\"action\":\"unlike\"}" | jq .

# Verify likeCount decremented
curl -s "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=5&page=1" \
  | jq ".contents[] | select(.content.id==\"${CONTENT_ID}\") | .socialCounts.likeCount"
```

**Expected:** `0` (or previous count - 1).

---

## Step 6 — Comment + verify count (Tapestry: `POST /comments/`)

```bash
curl -s -X POST http://localhost:3000/api/tapestry/comment \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\",\"contentId\":\"${CONTENT_ID}\",\"text\":\"smoke test comment\"}" \
  | jq '{id: .id, text: .text}'

# Verify commentCount = 1
curl -s "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=5&page=1" \
  | jq ".contents[] | select(.content.id==\"${CONTENT_ID}\") | .socialCounts.commentCount"

# List comments
curl -s "http://localhost:3000/api/tapestry/comments?contentId=${CONTENT_ID}&pageSize=10&page=1" \
  | jq '{count: (.comments | length), text: .comments[0].comment.text}'
```

**Expected:** `commentCount = 1`, comment list shows `"smoke test comment"`.

---

## Step 7 — Create a quest (Tapestry: `POST /contents/findOrCreate` with properties)

```bash
curl -s -X POST http://localhost:3000/api/tapestry/quest \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\",\"title\":\"Defeat the Lich King\",\"reward\":\"50 SOL\",\"details\":\"Complete all dungeon levels.\"}" \
  | jq '{id: .id}'

# Verify quest in feed
QUEST_ID=$(curl -s \
  "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=20&page=1" \
  | jq -r '[.contents[] | select(.content.text | startswith("[QUEST]"))][0].content.id')
echo "QUEST_ID=${QUEST_ID}"

curl -s "http://localhost:3000/api/tapestry/feed?walletAddress=${WALLET}&pageSize=20&page=1" \
  | jq ".contents[] | select(.content.id==\"${QUEST_ID}\") | {text: .content.text}"
```

**Expected:** `text` starts with `"[QUEST] Defeat the Lich King — Reward: 50 SOL"`.

---

## Step 8 — Mark complete (comment proof)

```bash
curl -s -X POST http://localhost:3000/api/tapestry/comment \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\":\"${WALLET}\",\"contentId\":\"${QUEST_ID}\",\"text\":\"✅ Completed: Cleared all levels\\nTx: (manual test)\"}" \
  | jq '{id: .id, text: .text}'
```

**Expected:** Comment created with `✅ Completed:` prefix and `Tx:` line.

> **Onchain Memo (optional, browser only):** Connect Phantom on devnet with ~0.001 SOL. Open Quests tab, type proof, click ✅ Complete. Phantom prompts for a Memo tx. Approve → comment includes a real Solana tx signature. Verify at `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

---

## Step 9 — Rewards / leaderboard (Torque layer: `GET /api/rewards`)

```bash
curl -s "http://localhost:3000/api/rewards?walletAddress=${WALLET}" \
  | jq '{points: .totalPoints, posts: .breakdown.posts, quests: .breakdown.quests, completions: .breakdown.completions, leaderboard: [.leaderboard[] | {rank, username, points}], computedAt: .computedAt}'
```

**Expected:**
- `totalPoints > 0` (at minimum: 1 post × 10 + 1 quest × 20 + engagement).
- `breakdown` shows non-zero counts for posts and quests.
- `leaderboard` has at least one entry.
- `computedAt` is an ISO timestamp.

---

## Step 10 — Browser walkthrough (2 minutes)

1. Open `http://localhost:3000/feed`, connect Phantom.
2. Click **Demo seed** — creates quest + post + comment + like.
3. Verify **All Posts** tab: both cards visible, like counts, comment counts.
4. Switch to **⚔️ Quests** tab: only quest cards, **⚔️ QUEST** badge, title, reward.
5. Switch to **My Activity** tab: shows only your authored posts and quest completions.
6. Click **💬** on any card: comments expand, type + send a new comment.
7. Click **♡** on any card: toggles to **♥**, count increments.
8. On a quest card, type proof in **Mark Complete**, click **✅ Complete**.
   - If Phantom is on devnet with SOL: approve tx → comment has `Tx: <sig>`.
   - If no SOL or rejected: comment has `Tx: (failed to submit)`.
9. Click **🏆 Rewards** in the header → `/rewards` page.
   - Gold total points counter, breakdown table, leaderboard with your row highlighted.
   - Click **↻ Refresh** — data updates.
10. Disconnect wallet: feed shows placeholder, rewards shows "Connect Phantom" message.

---

## Pass criteria

| Check | Expected |
|---|---|
| Profile create | `profile.id` returned, `operation: "CREATED"` |
| Profile idempotent | Same `profile.id`, `operation: "FOUND"` |
| Post created | `{ id }` returned |
| Post in feed | Card shows text, author, timestamp |
| Like increments | `likeCount` + 1, button shows ♥ |
| Unlike decrements | `likeCount` - 1, button shows ♡ |
| Comment posted | `{ id, text }` returned |
| Comments listed | Author + text visible in expanded panel |
| commentCount increments | Feed count updates after comment |
| Quest created | Text starts with `[QUEST]` |
| Quest badge | ⚔️ QUEST badge, title, reward, details |
| Quest filter | Quests tab: only quests; All Posts: everything |
| My Activity tab | Shows only your posts/quests/completions |
| Mark complete | `✅ Completed:` comment posted, comments expand |
| Onchain proof (connected) | Phantom prompts, `Tx: <base58 sig>` in comment |
| Onchain proof (failed) | `Tx: (failed to submit)`, no crash |
| Demo seed | Creates quest + post + comment + like in one click |
| Rewards page | Total points > 0, breakdown rows, leaderboard |
| Rewards refresh | ↻ Refresh updates data |
| Feed → Rewards nav | 🏆 Rewards link works |
| No key leak | `TAPESTRY_API_KEY` never in browser, never in error messages |
