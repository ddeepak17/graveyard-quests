import { NextResponse } from "next/server";

const BASE = "https://api.usetapestry.dev/api/v1";

export async function POST(req: Request) {
  try {
    const API_KEY = process.env.TAPESTRY_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const { walletAddress, title, reward, details } = (await req.json()) as {
      walletAddress?: string;
      title?: string;
      reward?: string;
      details?: string;
    };

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json({ error: "walletAddress is required" }, { status: 400 });
    }
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!reward || typeof reward !== "string" || reward.trim().length === 0) {
      return NextResponse.json({ error: "reward is required" }, { status: 400 });
    }

    // Resolve profileId via findOrCreate
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

    const profileText = await profileRes.text();
    if (!profileRes.ok) {
      return NextResponse.json(
        { error: "Tapestry profile error", status: profileRes.status, details: profileText },
        { status: profileRes.status }
      );
    }

    const profileData = JSON.parse(profileText);
    const profileId: string =
      profileData?.profile?.id ?? profileData?.profile?.username ?? safeUsername;

    // Create quest as content node.
    // text property = "[QUEST] title" for backward-compat fallback detection in the feed.
    // Additional properties (type, title, reward, details) get inflated to content.* in
    // the feed response, enabling first-class quest detection without text parsing.
    const contentId = crypto.randomUUID();

    const questRes = await fetch(
      `${BASE}/contents/findOrCreate?apiKey=${encodeURIComponent(API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: contentId,
          profileId,
          properties: [
            {
              key: "text",
              value: (() => {
                const base = `[QUEST] ${title.trim()} — Reward: ${reward.trim()}`;
                const d = (details ?? "").trim();
                return d ? `${base}\n${d}` : base;
              })(),
            },
            { key: "type", value: "quest" },
            { key: "title", value: title.trim() },
            { key: "reward", value: reward.trim() },
            { key: "details", value: (details ?? "").trim() },
          ],
        }),
      }
    );

    const questText = await questRes.text();
    if (!questRes.ok) {
      return NextResponse.json(
        { error: "Tapestry quest error", status: questRes.status, details: questText },
        { status: questRes.status }
      );
    }

    return NextResponse.json(JSON.parse(questText));
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
