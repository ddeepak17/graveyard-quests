import { NextResponse } from "next/server";

const BASE = "https://api.usetapestry.dev/api/v1";

export async function GET(req: Request) {
  try {
    const API_KEY = process.env.TAPESTRY_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const url = new URL(req.url);
    const walletAddress = url.searchParams.get("walletAddress") ?? undefined;
    const profileIdParam = url.searchParams.get("profileId") ?? undefined;
    // Tapestry uses page/pageSize (not limit/offset)
    const pageSize = url.searchParams.get("limit") ?? url.searchParams.get("pageSize") ?? "20";
    const page = url.searchParams.get("page") ?? "1";

    let profileId = profileIdParam;

    if (!profileId) {
      if (!walletAddress) {
        return NextResponse.json(
          { error: "Provide profileId or walletAddress" },
          { status: 400 }
        );
      }

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
      // Use the actual profile.id returned by Tapestry
      profileId =
        profileData?.profile?.id ?? profileData?.profile?.username ?? safeUsername;
    }

    // GET /contents/ with profileId + page-based pagination (spec: page, pageSize)
    const feedUrl = new URL(`${BASE}/contents/`);
    feedUrl.searchParams.set("apiKey", API_KEY);
    feedUrl.searchParams.set("profileId", profileId!);
    feedUrl.searchParams.set("pageSize", pageSize);
    feedUrl.searchParams.set("page", page);

    const feedRes = await fetch(feedUrl.toString());
    const feedText = await feedRes.text();

    if (!feedRes.ok) {
      return NextResponse.json(
        { error: "Tapestry feed error", status: feedRes.status, details: feedText },
        { status: feedRes.status }
      );
    }

    return NextResponse.json(JSON.parse(feedText));
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
