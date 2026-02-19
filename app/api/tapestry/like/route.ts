import { NextResponse } from "next/server";

const BASE = "https://api.usetapestry.dev/api/v1";

export async function POST(req: Request) {
  try {
    const API_KEY = process.env.TAPESTRY_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const body = await req.json();
    const { walletAddress, contentId, action } = body as {
      walletAddress?: string;
      contentId?: string;
      action?: "like" | "unlike";
    };

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json({ error: "walletAddress is required" }, { status: 400 });
    }
    if (!contentId || typeof contentId !== "string") {
      return NextResponse.json({ error: "contentId is required" }, { status: 400 });
    }
    if (action !== "like" && action !== "unlike") {
      return NextResponse.json({ error: 'action must be "like" or "unlike"' }, { status: 400 });
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

    // Call POST or DELETE /likes/{nodeId}
    const likeUrl = new URL(`${BASE}/likes/${encodeURIComponent(contentId)}`);
    likeUrl.searchParams.set("apiKey", API_KEY);

    let likeRes: Response;
    if (action === "like") {
      // POST: body is reliably delivered
      likeRes = await fetch(likeUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startId: profileId }),
      });
    } else {
      // DELETE: Node.js/undici silently drops request bodies on DELETE requests,
      // so pass startId as a query param as well as in the body to cover both
      // server-side reading strategies.
      likeUrl.searchParams.set("startId", profileId);
      likeRes = await fetch(likeUrl.toString(), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startId: profileId }),
      });
    }

    const likeText = await likeRes.text();
    if (!likeRes.ok) {
      return NextResponse.json(
        { error: "Tapestry like error", status: likeRes.status, details: likeText },
        { status: likeRes.status }
      );
    }

    return NextResponse.json(likeText ? JSON.parse(likeText) : { success: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
