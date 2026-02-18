"use client";

import { useMemo, useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";

type ApiResponse = any;

export default function ProfilePage() {
  const { connectors, connect, disconnect, wallet, status } = useWalletConnection();

  const connected = status === "connected";
  const walletAddress = useMemo(() => {
    if (!connected) return "";
    // wallet-standard style address
    return wallet?.account.address?.toString?.() ?? String(wallet?.account.address ?? "");
  }, [connected, wallet]);

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ApiResponse | null>(null);

  async function handleCreateOrLoad() {
    setError(null);
    setProfile(null);

    if (!walletAddress) {
      setError("Connect your wallet first.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/tapestry/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, username, bio }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Request failed");
      setProfile(data);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Profile (Tapestry)
      </h1>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>
        Connect wallet → Create/Load your onchain social profile.
      </p>

      {/* Wallet connect panel */}
      <div style={{ marginBottom: 16, padding: 12, border: "1px solid #333", borderRadius: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>Wallet</div>

        {connected ? (
          <>
            <div style={{ fontFamily: "monospace", wordBreak: "break-all", marginBottom: 8 }}>
              {walletAddress}
            </div>
            <button
              onClick={disconnect}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #333", cursor: "pointer" }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {connectors
            .filter((c) => c.name?.toLowerCase().includes("phantom"))
            .map((c) => (
              <button
                key={c.id}
                onClick={() => connect(c.id)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #333",
                  cursor: "pointer",
                }}
              >
                Connect {c.name}
              </button>
            ))}
          </div>
        )}

        {status === "connecting" && (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>Connecting…</div>
        )}
      </div>

      {/* Profile form */}
      <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Username (optional)</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. darren"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #333" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Bio (optional)</span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Short bio…"
            rows={3}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #333" }}
          />
        </label>

        <button
          onClick={handleCreateOrLoad}
          disabled={loading || !connected}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #333",
            cursor: connected ? "pointer" : "not-allowed",
            opacity: loading ? 0.7 : connected ? 1 : 0.6,
          }}
        >
          {loading ? "Working…" : "Create / Load Profile"}
        </button>

        {error && (
          <div style={{ padding: 12, borderRadius: 10, border: "1px solid #633" }}>
            ❌ {error}
          </div>
        )}
      </div>

      {profile && (
        <div style={{ padding: 12, borderRadius: 10, border: "1px solid #333" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Profile response</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
            {JSON.stringify(profile, null, 2)}
          </pre>
        </div>
      )}
    </main>
  );
}
