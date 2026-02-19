import { NextResponse } from "next/server";

const BASE = "https://api.usetapestry.dev/api/v1";

// ─── Scoring constants ────────────────────────────────────────────────────────

const PTS = {
  POST: 10,
  QUEST: 20,
  COMPLETION: 30,
  LIKE_RECEIVED: 1,
  COMMENT_RECEIVED: 1,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Server-side mirror of the client-side extractQuestData detection logic. */
function isQuestContent(content: any): boolean {
  if (!content) return false;
  if (content.type === "quest") return true;
  const props: any[] = Array.isArray(content.properties) ? content.properties : [];
  if (props.some((p: any) => p?.key === "type" && p?.value === "quest")) return true;
  const text: string = content?.text ?? "";
  return text.trimStart().toUpperCase().startsWith("[QUEST]");
}

/**
 * A completion comment must contain "✅ Completed:" AND either a Solana tx
 * signature line ("Tx:") or the raw Memo proof prefix (fallback for comment-only
 * completions that lack a tx but were done via the memo path).
 */
function isCompletionComment(text: string): boolean {
  return (
    text.includes("✅ Completed:") &&
    (text.includes("Tx:") || text.includes("GRAVEYARD_QUEST_COMPLETE"))
  );
}

/**
 * Run an array of async tasks with a maximum concurrency cap.
 * Pure JS — no extra dependencies.
 */
async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let qi = 0;
  async function worker(): Promise<void> {
    while (qi < tasks.length) {
      const idx = qi++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/** Normalise any Tapestry array-like response into a plain array. */
function toArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.contents)) return data.contents;
  if (Array.isArray(data?.comments)) return data.comments;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const API_KEY = process.env.TAPESTRY_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const url = new URL(req.url);
    const walletAddress = url.searchParams.get("walletAddress");
    if (
      !walletAddress ||
      typeof walletAddress !== "string" ||
      walletAddress.length < 20 ||
      walletAddress.length > 50 ||
      !/^[A-Za-z0-9]+$/.test(walletAddress)
    ) {
      return NextResponse.json(
        { error: "walletAddress is required and must be a valid Solana address" },
        { status: 400 }
      );
    }

    // ── 1. Resolve profile ───────────────────────────────────────────────────
    const safeUsername = `user_${walletAddress.slice(0, 6)}`;
    const profileRes = await fetch(
      `${BASE}/profiles/findOrCreate?apiKey=${encodeURIComponent(API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          username: safeUsername,
          bio: "",
          blockchain: "SOLANA",
          execution: "FAST_UNCONFIRMED",
        }),
      }
    );
    if (!profileRes.ok) {
      const t = await profileRes.text();
      return NextResponse.json(
        { error: "Tapestry profile error", details: t },
        { status: profileRes.status }
      );
    }
    const profileData = await profileRes.json();
    const profileId: string =
      profileData?.profile?.id ?? profileData?.profile?.username ?? safeUsername;
    const username: string = profileData?.profile?.username ?? safeUsername;

    // ── 2. Fetch feed (up to 50 items) ───────────────────────────────────────
    const feedUrl = new URL(`${BASE}/contents/`);
    feedUrl.searchParams.set("apiKey", API_KEY);
    feedUrl.searchParams.set("profileId", profileId);
    feedUrl.searchParams.set("pageSize", "50");
    feedUrl.searchParams.set("page", "1");

    const feedRes = await fetch(feedUrl.toString());
    if (!feedRes.ok) {
      const t = await feedRes.text();
      return NextResponse.json(
        { error: "Tapestry feed error", details: t },
        { status: feedRes.status }
      );
    }
    const feedData = await feedRes.json();
    const feedItems: any[] = toArray(feedData);

    // ── 3. Fetch comments for every item (max 5 concurrent) ─────────────────
    const commentTasks = feedItems.map((item) => async (): Promise<any[]> => {
      const contentId: string | undefined =
        item?.content?.id ?? item?.id ?? undefined;
      if (!contentId) return [];
      try {
        const cUrl = new URL(`${BASE}/comments/`);
        cUrl.searchParams.set("apiKey", API_KEY);
        cUrl.searchParams.set("contentId", contentId);
        cUrl.searchParams.set("pageSize", "50");
        cUrl.searchParams.set("page", "1");
        const cRes = await fetch(cUrl.toString());
        if (!cRes.ok) return [];
        const cData = await cRes.json();
        return toArray(cData);
      } catch {
        return [];
      }
    });

    const allCommentLists: any[][] = await withConcurrency(commentTasks, 5);

    // ── 4. Score computation ─────────────────────────────────────────────────
    // Points map: username → cumulative points
    const authorPoints: Record<string, number> = {};
    function addPts(author: string, pts: number) {
      if (!author) return;
      authorPoints[author] = (authorPoints[author] ?? 0) + pts;
    }

    // Breakdown counters for the requesting user
    let userPostCount = 0;
    let userQuestCount = 0;
    let userPostPts = 0;
    let userQuestPts = 0;
    let userCompletionCount = 0;
    let userCompletionPts = 0;
    let userLikesReceivedPts = 0;
    let userCommentsReceivedPts = 0;
    let totalCommentsFetched = 0;

    for (let i = 0; i < feedItems.length; i++) {
      const item = feedItems[i];
      const content = item?.content ?? item;
      const itemAuthor: string = item?.authorProfile?.username ?? "";
      const likeCount: number = Number(item?.socialCounts?.likeCount ?? 0);
      const commentCount: number = Number(item?.socialCounts?.commentCount ?? 0);
      const isQuest = isQuestContent(content);

      const contentPts = isQuest ? PTS.QUEST : PTS.POST;
      const engagementPts = likeCount * PTS.LIKE_RECEIVED + commentCount * PTS.COMMENT_RECEIVED;
      addPts(itemAuthor, contentPts + engagementPts);

      // Breakdown for requesting user
      if (itemAuthor === username) {
        if (isQuest) {
          userQuestCount += 1;
          userQuestPts += PTS.QUEST;
        } else {
          userPostCount += 1;
          userPostPts += PTS.POST;
        }
        userLikesReceivedPts += likeCount * PTS.LIKE_RECEIVED;
        userCommentsReceivedPts += commentCount * PTS.COMMENT_RECEIVED;
      }

      // Score completion comments (any author)
      const commentList = allCommentLists[i] ?? [];
      totalCommentsFetched += commentList.length;

      for (const c of commentList) {
        const cObj = c?.comment ?? c;
        const cText: string = cObj?.text ?? "";
        const cAuthor: string =
          c?.author?.username ?? c?.authorProfile?.username ?? "";
        if (isCompletionComment(cText)) {
          addPts(cAuthor, PTS.COMPLETION);
          if (cAuthor === username) {
            userCompletionCount += 1;
            userCompletionPts += PTS.COMPLETION;
          }
        }
      }
    }

    // ── 5. Build leaderboard (top 5) ─────────────────────────────────────────
    const leaderboard = Object.entries(authorPoints)
      .filter(([uname]) => uname.length > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([uname, pts], rank) => ({
        rank: rank + 1,
        username: uname,
        points: pts,
        isYou: uname === username,
      }));

    const totalPoints =
      userPostPts +
      userQuestPts +
      userCompletionPts +
      userLikesReceivedPts +
      userCommentsReceivedPts;

    return NextResponse.json({
      profile: { id: profileId, username },
      totalPoints,
      breakdown: {
        posts: { count: userPostCount, points: userPostPts },
        quests: { count: userQuestCount, points: userQuestPts },
        completions: { count: userCompletionCount, points: userCompletionPts },
        likesReceived: { points: userLikesReceivedPts },
        commentsReceived: { points: userCommentsReceivedPts },
      },
      leaderboard,
      computedFrom: { posts: feedItems.length, comments: totalCommentsFetched },
      computedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[rewards]", err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
