"use client";

import { useMemo, useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";

export default function FeedPage() {
  const { connectors, connect, disconnect, wallet, status } = useWalletConnection();
  const connected = status === "connected";

  const walletAddress = useMemo(() => {
    if (!connected) return "";
    return wallet?.account.address?.toString?.() ?? String(wallet?.account.address ?? "");
  }, [connected, wallet]);

  const [text, setText] = useState("");
  const [loadingPost, setLoadingPost] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<any>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [likingIds, setLikingIds] = useState<Record<string, boolean>>({});
  // Local optimistic like state – used when requestingProfileSocialInfo.hasLiked is absent
  const [likedIds, setLikedIds] = useState<Record<string, boolean>>({});

  // Per-post comment state
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [postComments, setPostComments] = useState<Record<string, any[]>>({});
  const [loadingComments, setLoadingComments] = useState<Record<string, boolean>>({});
  const [sendingComment, setSendingComment] = useState<Record<string, boolean>>({});

  // Normalise the feed response to an array of post objects
  const posts: any[] = useMemo(() => {
    if (!feed) return [];
    if (Array.isArray(feed)) return feed;
    if (Array.isArray(feed?.contents)) return feed.contents;
    if (Array.isArray(feed?.data)) return feed.data;
    if (Array.isArray(feed?.items)) return feed.items;
    return [];
  }, [feed]);

  async function refreshFeed() {
    setError(null);
    if (!walletAddress) return;

    setLoadingFeed(true);
    try {
      const res = await fetch(
        `/api/tapestry/feed?walletAddress=${encodeURIComponent(walletAddress)}&pageSize=20&page=1`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load feed");
      setFeed(data);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoadingFeed(false);
    }
  }

  async function createPost() {
    setError(null);
    if (!walletAddress) return;
    if (!text.trim()) {
      setError("Type something first.");
      return;
    }

    setLoadingPost(true);
    try {
      const res = await fetch("/api/tapestry/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to create post");

      setText("");
      await refreshFeed();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoadingPost(false);
    }
  }

  async function toggleLike(contentId: string, hasLiked: boolean) {
    if (!walletAddress || likingIds[contentId]) return;
    setLikingIds((prev) => ({ ...prev, [contentId]: true }));
    // Optimistic update so the button flips immediately
    setLikedIds((prev) => ({ ...prev, [contentId]: !hasLiked }));
    try {
      const res = await fetch("/api/tapestry/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          contentId,
          action: hasLiked ? "unlike" : "like",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Roll back optimistic update on failure
        setLikedIds((prev) => ({ ...prev, [contentId]: hasLiked }));
        throw new Error(data?.error ?? "Failed to update like");
      }
      await refreshFeed();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLikingIds((prev) => ({ ...prev, [contentId]: false }));
    }
  }

  async function loadComments(contentId: string) {
    setLoadingComments((prev) => ({ ...prev, [contentId]: true }));
    try {
      const res = await fetch(
        `/api/tapestry/comments?contentId=${encodeURIComponent(contentId)}&pageSize=10&page=1`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load comments");
      // Defensive: accept { comments: [...] } or a bare array
      const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.comments) ? data.comments : [];
      setPostComments((prev) => ({ ...prev, [contentId]: list }));
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoadingComments((prev) => ({ ...prev, [contentId]: false }));
    }
  }

  function toggleComments(contentId: string) {
    const next = !expandedComments[contentId];
    setExpandedComments((prev) => ({ ...prev, [contentId]: next }));
    // Load on first open (or if not yet loaded)
    if (next && !postComments[contentId]) {
      loadComments(contentId);
    }
  }

  async function sendComment(contentId: string) {
    const commentText = (commentTexts[contentId] ?? "").trim();
    if (!walletAddress || !commentText || sendingComment[contentId]) return;
    setSendingComment((prev) => ({ ...prev, [contentId]: true }));
    try {
      const res = await fetch("/api/tapestry/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, contentId, text: commentText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to post comment");
      setCommentTexts((prev) => ({ ...prev, [contentId]: "" }));
      // Reload this post's comments and update feed commentCount
      await Promise.all([loadComments(contentId), refreshFeed()]);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSendingComment((prev) => ({ ...prev, [contentId]: false }));
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Feed</h1>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>
        Post + view your profile feed (Tapestry).
      </p>

      {/* Wallet */}
      <div style={{ marginBottom: 16, padding: 12, border: "1px solid #333", borderRadius: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>Wallet</div>

        {connected ? (
          <>
            <div style={{ fontFamily: "monospace", wordBreak: "break-all", marginBottom: 8 }}>
              {walletAddress}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={disconnect}
                style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #333", cursor: "pointer" }}
              >
                Disconnect
              </button>
              <button
                onClick={refreshFeed}
                disabled={loadingFeed}
                style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #333", cursor: "pointer", opacity: loadingFeed ? 0.7 : 1 }}
              >
                {loadingFeed ? "Refreshing…" : "Refresh feed"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {connectors
                .filter((c) => c.name?.toLowerCase().includes("phantom"))
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={async () => {
                      setError(null);
                      try {
                        await connect(c.id);
                      } catch (e: any) {
                        setError(e?.message ?? "Failed to connect wallet");
                      }
                    }}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #333", cursor: "pointer" }}
                  >
                    Connect {c.name}
                  </button>
                ))}
            </div>
            {status === "connecting" && (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>Connecting…</div>
            )}
          </>
        )}
      </div>

      {/* Composer */}
      <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a post…"
          rows={3}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #333" }}
        />
        <button
          onClick={createPost}
          disabled={!connected || loadingPost}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #333",
            cursor: connected ? "pointer" : "not-allowed",
            opacity: loadingPost ? 0.7 : connected ? 1 : 0.6,
          }}
        >
          {loadingPost ? "Posting…" : "Post"}
        </button>
        {error && (
          <div style={{ padding: 12, borderRadius: 10, border: "1px solid #633" }}>
            ❌ {error}
          </div>
        )}
      </div>

      {/* Feed output */}
      <div style={{ padding: 12, borderRadius: 10, border: "1px solid #333" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Feed</div>
          <div style={{ display: "flex", gap: 8 }}>
            {feed && (
              <button
                onClick={() => setShowRaw((v) => !v)}
                style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #333", cursor: "pointer", fontSize: 12 }}
              >
                {showRaw ? "Show cards" : "Show raw JSON"}
              </button>
            )}
            <button
              onClick={refreshFeed}
              disabled={!connected || loadingFeed}
              style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #333", cursor: "pointer", opacity: !connected ? 0.6 : 1 }}
            >
              {loadingFeed ? "Loading…" : "Load"}
            </button>
          </div>
        </div>

        {!feed && <div style={{ opacity: 0.6, fontSize: 14 }}>No feed loaded yet.</div>}

        {feed && showRaw && (
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 12 }}>
            {JSON.stringify(feed, null, 2)}
          </pre>
        )}

        {feed && !showRaw && (
          posts.length === 0 ? (
            <div style={{ opacity: 0.6, fontSize: 14 }}>No posts yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {posts.map((post: any, i: number) => {
                // API response shape: { content: { id, created_at, text, ... }, authorProfile, socialCounts, requestingProfileSocialInfo }
                const contentObj = post?.content ?? post;
                const textVal: string =
                  contentObj?.text ?? contentObj?.content ?? post?.text ?? "(no content)";
                const author: string = post?.authorProfile?.username ?? "";
                const ts: number | undefined = contentObj?.created_at;
                const contentId: string = contentObj?.id ?? String(i);
                const likeCount: number = post?.socialCounts?.likeCount ?? 0;
                const commentCount: number = post?.socialCounts?.commentCount ?? 0;
                // Prefer authoritative server value when present; fall back to local optimistic state
                const serverHasLiked: boolean | undefined =
                  post?.requestingProfileSocialInfo?.hasLiked;
                const hasLiked: boolean =
                  contentId in likedIds
                    ? likedIds[contentId]
                    : serverHasLiked ?? false;
                const isLiking = !!likingIds[contentId];
                const isExpanded = !!expandedComments[contentId];
                const isLoadingComments = !!loadingComments[contentId];
                const isSending = !!sendingComment[contentId];
                const comments: any[] = postComments[contentId] ?? [];
                return (
                  <div
                    key={contentId}
                    style={{ padding: 12, borderRadius: 8, border: "1px solid #444" }}
                  >
                    {author && (
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                        @{author}
                      </div>
                    )}
                    <div style={{ marginBottom: 6, wordBreak: "break-word" }}>{textVal}</div>

                    {/* Action bar */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                      <button
                        onClick={() => toggleLike(contentId, hasLiked)}
                        disabled={!connected || isLiking}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 8,
                          border: `1px solid ${hasLiked ? "#c084fc" : "#555"}`,
                          cursor: connected ? "pointer" : "not-allowed",
                          opacity: isLiking ? 0.6 : 1,
                          fontSize: 12,
                          background: hasLiked ? "rgba(192,132,252,0.15)" : "transparent",
                        }}
                      >
                        {isLiking ? "…" : hasLiked ? "♥ Liked" : "♡ Like"}
                      </button>
                      <span style={{ fontSize: 12, opacity: 0.6 }}>
                        {likeCount} {likeCount === 1 ? "like" : "likes"}
                      </span>
                      <button
                        onClick={() => toggleComments(contentId)}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 8,
                          border: `1px solid ${isExpanded ? "#60a5fa" : "#555"}`,
                          cursor: "pointer",
                          fontSize: 12,
                          background: isExpanded ? "rgba(96,165,250,0.15)" : "transparent",
                        }}
                      >
                        💬 {commentCount} {commentCount === 1 ? "comment" : "comments"}
                      </button>
                      <span style={{ fontSize: 11, opacity: 0.5, marginLeft: "auto" }}>
                        {ts ? new Date(ts < 1e12 ? ts * 1000 : ts).toLocaleString() : contentId}
                      </span>
                    </div>

                    {/* Expanded comment section */}
                    {isExpanded && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #333" }}>
                        {/* Existing comments */}
                        {isLoadingComments && (
                          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>Loading comments…</div>
                        )}
                        {!isLoadingComments && comments.length === 0 && (
                          <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 8 }}>No comments yet.</div>
                        )}
                        {comments.map((c: any, ci: number) => {
                          const cObj = c?.comment ?? c;
                          const cText: string = cObj?.text ?? "(empty)";
                          const cAuthor: string = c?.author?.username ?? "";
                          const cTs: number | undefined = cObj?.created_at;
                          const cId: string = cObj?.id ?? String(ci);
                          return (
                            <div
                              key={cId}
                              style={{
                                marginBottom: 8,
                                paddingBottom: 8,
                                borderBottom: "1px solid #2a2a2a",
                                fontSize: 13,
                              }}
                            >
                              {cAuthor && (
                                <span style={{ fontWeight: 600, fontSize: 11, marginRight: 6 }}>
                                  @{cAuthor}
                                </span>
                              )}
                              <span style={{ wordBreak: "break-word" }}>{cText}</span>
                              {cTs && (
                                <div style={{ fontSize: 10, opacity: 0.4, marginTop: 2 }}>
                                  {new Date(cTs < 1e12 ? cTs * 1000 : cTs).toLocaleString()}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* New comment input */}
                        {connected && (
                          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                            <input
                              value={commentTexts[contentId] ?? ""}
                              onChange={(e) =>
                                setCommentTexts((prev) => ({ ...prev, [contentId]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  sendComment(contentId);
                                }
                              }}
                              placeholder="Add a comment…"
                              style={{
                                flex: 1,
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid #444",
                                fontSize: 13,
                              }}
                            />
                            <button
                              onClick={() => sendComment(contentId)}
                              disabled={isSending || !(commentTexts[contentId] ?? "").trim()}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 8,
                                border: "1px solid #555",
                                cursor: isSending ? "not-allowed" : "pointer",
                                opacity: isSending ? 0.6 : 1,
                                fontSize: 12,
                              }}
                            >
                              {isSending ? "…" : "Send"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </main>
  );
}
