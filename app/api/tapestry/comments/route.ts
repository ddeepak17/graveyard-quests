import { NextResponse } from "next/server";

const BASE = "https://api.usetapestry.dev/api/v1";

export async function GET(req: Request) {
  try {
    const API_KEY = process.env.TAPESTRY_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const url = new URL(req.url);
    const contentId = url.searchParams.get("contentId");
    const profileId = url.searchParams.get("profileId") ?? undefined;
    const pageSize = url.searchParams.get("pageSize") ?? "20";
    const page = url.searchParams.get("page") ?? "1";

    // GET /comments/ requires at least one of: contentId, profileId, targetProfileId
    if (!contentId && !profileId) {
      return NextResponse.json(
        { error: "contentId or profileId is required" },
        { status: 400 }
      );
    }

    const commentsUrl = new URL(`${BASE}/comments/`);
    commentsUrl.searchParams.set("apiKey", API_KEY);
    if (contentId) commentsUrl.searchParams.set("contentId", contentId);
    if (profileId) commentsUrl.searchParams.set("profileId", profileId);
    commentsUrl.searchParams.set("pageSize", pageSize);
    commentsUrl.searchParams.set("page", page);

    const commentsRes = await fetch(commentsUrl.toString());
    const commentsText = await commentsRes.text();

    if (!commentsRes.ok) {
      return NextResponse.json(
        { error: "Tapestry comments error", status: commentsRes.status, details: commentsText },
        { status: commentsRes.status }
      );
    }

    return NextResponse.json(JSON.parse(commentsText));
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
