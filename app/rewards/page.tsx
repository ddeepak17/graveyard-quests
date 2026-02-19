"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useWalletConnection } from "@solana/react-hooks";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BreakdownEntry {
  count?: number;
  points: number;
}

interface LeaderboardRow {
  rank: number;
  username: string;
  points: number;
  isYou: boolean;
}

interface RewardsData {
  profile: { id: string; username: string };
  totalPoints: number;
  breakdown: {
    posts: BreakdownEntry;
    quests: BreakdownEntry;
    completions: BreakdownEntry;
    likesReceived: BreakdownEntry;
    commentsReceived: BreakdownEntry;
  };
  leaderboard: LeaderboardRow[];
  computedFrom: { posts: number; comments: number };
  computedAt?: string;
}

// ─── Micro-styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #1e1e1e",
  background: "#111",
  padding: 16,
};

const label: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.4,
  marginBottom: 6,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RewardsPage() {
  const { connect, connectors, disconnect, wallet, status } = useWalletConnection();
  const connected = status === "connected";

  const walletAddress = useMemo(() => {
    if (!connected) return "";
    return wallet?.account.address?.toString?.() ?? String(wallet?.account.address ?? "");
  }, [connected, wallet]);

  const [data, setData] = useState<RewardsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRewards = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/rewards?walletAddress=${encodeURIComponent(walletAddress)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load rewards");
      setData(json as RewardsData);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress) fetchRewards();
  }, [walletAddress, fetchRewards]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            Rewards
          </h1>
          <span
            style={{
              fontSize: 10,
              background: "rgba(251,191,36,0.15)",
              color: "#fbbf24",
              border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: 4,
              padding: "2px 7px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Torque-style
          </span>
        </div>
        <p style={{ opacity: 0.4, margin: 0, fontSize: 13 }}>
          Loyalty points earned from your activity in Graveyard Quests.
        </p>
        <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
          <a
            href="/feed"
            style={{
              fontSize: 12,
              opacity: 0.5,
              color: "inherit",
              textDecoration: "none",
              borderBottom: "1px solid #333",
              paddingBottom: 1,
            }}
          >
            ← Back to Feed
          </a>
        </div>
      </div>

      {/* Wallet section */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={label}>Wallet</div>
        {connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <code style={{ flex: 1, fontSize: 11, wordBreak: "break-all", opacity: 0.7 }}>
              {walletAddress}
            </code>
            <button
              onClick={() => disconnect()}
              style={{
                padding: "5px 12px", borderRadius: 8, border: "1px solid #333",
                background: "transparent", color: "inherit", fontSize: 12, cursor: "pointer",
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {connectors.map((c) => (
              <button
                key={c.id}
                onClick={() => connect(c.id)}
                style={{
                  padding: "7px 14px", borderRadius: 8, border: "1px solid #333",
                  background: "transparent", color: "inherit", fontSize: 13, cursor: "pointer",
                }}
              >
                {c.name}
              </button>
            ))}
            {connectors.length === 0 && (
              <span style={{ fontSize: 13, opacity: 0.4 }}>No wallets detected — install Phantom or another Solana wallet.</span>
            )}
          </div>
        )}
      </div>

      {/* Not connected */}
      {!connected && (
        <div
          style={{
            ...card,
            textAlign: "center",
            padding: "40px 20px",
            opacity: 0.5,
            fontSize: 14,
          }}
        >
          Connect a Solana wallet to see your rewards.
        </div>
      )}

      {/* Error */}
      {connected && error && (
        <div
          style={{
            ...card,
            border: "1px solid #7f1d1d",
            background: "rgba(127,29,29,0.1)",
            color: "#f87171",
            fontSize: 13,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Failed to load rewards</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>{error}</div>
          </div>
          <button
            onClick={fetchRewards}
            style={{
              padding: "6px 14px", borderRadius: 6, flexShrink: 0,
              border: "1px solid #7f1d1d", background: "transparent",
              color: "#f87171", fontSize: 12, cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {connected && loading && (
        <div style={{ ...card, marginBottom: 16 }}>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              style={{
                height: 18,
                borderRadius: 6,
                background: "#1e1e1e",
                marginBottom: 10,
                width: n === 1 ? "40%" : n === 2 ? "70%" : "55%",
              }}
            />
          ))}
        </div>
      )}

      {/* Loaded */}
      {connected && !loading && data && (
        <>
          {/* Total points */}
          <div
            style={{
              ...card,
              marginBottom: 16,
              background: "rgba(120,53,15,0.07)",
              border: "1px solid #78350f",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div>
              <div style={{ ...label, color: "#fbbf24", opacity: 0.7 }}>Total Points</div>
              <div style={{ fontSize: 48, fontWeight: 800, color: "#fbbf24", lineHeight: 1 }}>
                {data.totalPoints.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, opacity: 0.4, marginTop: 4 }}>
                @{data.profile.username}
              </div>
            </div>
            <button
              onClick={fetchRewards}
              disabled={loading}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "1px solid #78350f",
                background: "transparent", color: "#fbbf24", fontSize: 12,
                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
            >
              ↻ Refresh
            </button>
          </div>

          {/* Breakdown */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={label}>Points Breakdown</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "4px 0", opacity: 0.4, fontWeight: 500, fontSize: 11 }}>Activity</th>
                  <th style={{ textAlign: "right", padding: "4px 0", opacity: 0.4, fontWeight: 500, fontSize: 11 }}>Count</th>
                  <th style={{ textAlign: "right", padding: "4px 0", opacity: 0.4, fontWeight: 500, fontSize: 11 }}>Points</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    { label: "Posts", key: "posts", rate: "+10 each" },
                    { label: "Quests Created", key: "quests", rate: "+20 each" },
                    { label: "Quest Completions", key: "completions", rate: "+30 each" },
                    { label: "Likes Received", key: "likesReceived", rate: "+1 each" },
                    { label: "Comments Received", key: "commentsReceived", rate: "+1 each" },
                  ] as const
                ).map(({ label: lbl, key, rate }) => {
                  const entry = data.breakdown[key];
                  const pts = entry.points;
                  const cnt = (entry as any).count;
                  return (
                    <tr key={key} style={{ borderTop: "1px solid #1a1a1a" }}>
                      <td style={{ padding: "8px 0" }}>
                        <span>{lbl}</span>
                        <span style={{ fontSize: 10, opacity: 0.35, marginLeft: 6 }}>{rate}</span>
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 0", opacity: 0.5 }}>
                        {cnt !== undefined ? cnt : "—"}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          padding: "8px 0",
                          fontWeight: pts > 0 ? 600 : 400,
                          color: pts > 0 ? "#a3e635" : "inherit",
                          opacity: pts > 0 ? 1 : 0.3,
                        }}
                      >
                        {pts > 0 ? `+${pts}` : "0"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1px solid #2a2a2a" }}>
                  <td colSpan={2} style={{ padding: "8px 0", fontWeight: 700, fontSize: 14 }}>
                    Total
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      padding: "8px 0",
                      fontWeight: 700,
                      fontSize: 14,
                      color: "#fbbf24",
                    }}
                  >
                    {data.totalPoints}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Leaderboard */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={label}>Leaderboard</div>
            {data.leaderboard.length === 0 ? (
              <div style={{ fontSize: 13, opacity: 0.35, padding: "8px 0" }}>
                No activity yet. Create posts or quests to earn points.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 0", opacity: 0.4, fontWeight: 500, fontSize: 11, width: 36 }}>#</th>
                    <th style={{ textAlign: "left", padding: "4px 0", opacity: 0.4, fontWeight: 500, fontSize: 11 }}>Username</th>
                    <th style={{ textAlign: "right", padding: "4px 0", opacity: 0.4, fontWeight: 500, fontSize: 11 }}>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaderboard.map((row) => (
                    <tr
                      key={row.username}
                      style={{
                        borderTop: "1px solid #1a1a1a",
                        background: row.isYou ? "rgba(163,230,53,0.04)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "8px 0", opacity: 0.45 }}>
                        {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : row.rank}
                      </td>
                      <td style={{ padding: "8px 0" }}>
                        <span style={{ color: row.isYou ? "#a3e635" : "inherit", fontWeight: row.isYou ? 600 : 400 }}>
                          @{row.username}
                        </span>
                        {row.isYou && (
                          <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.5 }}>(you)</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 0", fontWeight: 600 }}>
                        {row.points.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* How it works */}
          <div style={{ ...card, marginBottom: 16, padding: 14 }}>
            <div style={{ ...label, marginBottom: 8 }}>How scoring works</div>
            <div style={{ fontSize: 12, opacity: 0.45, lineHeight: 1.7 }}>
              Points are computed <strong style={{ opacity: 0.7 }}>live from Tapestry social data</strong> on each request.
              No tokens are minted — this is a Torque-compatible demo layer.
              Swap the scoring backend for production Torque integration.
            </div>
            <div style={{ fontSize: 11, opacity: 0.3, marginTop: 8 }}>
              Posts +10 · Quests +20 · Completions +30 · Likes received +1 · Comments received +1
            </div>
          </div>

          {/* Footer metadata */}
          <div
            style={{
              fontSize: 11,
              opacity: 0.3,
              lineHeight: 1.6,
              padding: "8px 0",
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            <span>
              Computed from {data.computedFrom.posts} feed items, {data.computedFrom.comments} comments.
            </span>
            {data.computedAt && (
              <span>
                Last computed: {new Date(data.computedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </>
      )}
    </main>
  );
}
