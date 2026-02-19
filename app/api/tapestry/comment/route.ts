import { NextResponse } from "next/server";

const BASE = "https://api.usetapestry.dev/api/v1";

export async function POST(req: Request) {
  try {
    const API_KEY = process.env.TAPESTRY_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const body = await req.json();
    const { walletAddress, contentId, text } = body as {
      walletAddress?: string;
      contentId?: string;
      text?: string;
    };

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json({ error: "walletAddress is required" }, { status: 400 });
    }
    if (!contentId || typeof contentId !== "string") {
      return NextResponse.json({ error: "contentId is required" }, { status: 400 });
    }
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    // Resolve profileId from walletAddress
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

    // POST /comments/ — required: profileId, text; contentId links comment to content.
    // Do NOT send commentId: Tapestry treats it as a lookup key and 404s if not found.
    const commentUrl = new URL(`${BASE}/comments/`);
    commentUrl.searchParams.set("apiKey", API_KEY);

    const commentRes = await fetch(commentUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        text: text.trim(),
        contentId,
      }),
    });

    const commentText = await commentRes.text();
    if (!commentRes.ok) {
      return NextResponse.json(
        { error: "Tapestry comment error", status: commentRes.status, details: commentText },
        { status: commentRes.status }
      );
    }

    return NextResponse.json(JSON.parse(commentText));
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
