import { NextResponse } from "next/server";

const BASE = "https://api.usetapestry.dev/api/v1";

export async function POST(req: Request) {
  try {
    const API_KEY = process.env.TAPESTRY_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const { walletAddress, text, username } = await req.json();

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json({ error: "walletAddress is required" }, { status: 400 });
    }
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const safeUsername =
      typeof username === "string" && username.trim().length > 0
        ? username.trim()
        : `user_${walletAddress.slice(0, 6)}`;

    // Step 1: ensure profile exists; use the real profile.id returned
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
    // Use the actual profile id returned by Tapestry (not a made-up username)
    const profileId: string =
      profileData?.profile?.id ?? profileData?.profile?.username ?? safeUsername;

    // Step 2: create content via POST /contents/findOrCreate
    // id must be unique per content node; text is stored in properties
    const contentId = crypto.randomUUID();

    const postRes = await fetch(
      `${BASE}/contents/findOrCreate?apiKey=${encodeURIComponent(API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: contentId,
          profileId,
          properties: [{ key: "text", value: text.trim() }],
        }),
      }
    );

    const postText = await postRes.text();
    if (!postRes.ok) {
      return NextResponse.json(
        { error: "Tapestry content error", status: postRes.status, details: postText },
        { status: postRes.status }
      );
    }

    return NextResponse.json(JSON.parse(postText));
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
