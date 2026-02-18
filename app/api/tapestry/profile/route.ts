import { NextResponse } from "next/server";

const BASE = "https://api.usetapestry.dev/api/v1";

export async function POST(req: Request) {
  try {
    const API_KEY = process.env.TAPESTRY_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const { walletAddress, username, bio } = await req.json();

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json({ error: "walletAddress is required" }, { status: 400 });
    }

    const safeUsername =
      typeof username === "string" && username.trim().length > 0
        ? username.trim()
        : `user_${walletAddress.slice(0, 6)}`;

    const res = await fetch(`${BASE}/profiles/findOrCreate?apiKey=${encodeURIComponent(API_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress,
        username: safeUsername,
        bio: typeof bio === "string" ? bio : "",
        blockchain: "SOLANA",
        execution: "FAST_UNCONFIRMED",
      }),
    });

    const details = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "Tapestry profile error", status: res.status, details },
        { status: res.status }
      );
    }

    return NextResponse.json(JSON.parse(details));
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
