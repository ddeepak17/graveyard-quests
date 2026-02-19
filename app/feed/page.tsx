"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useWalletConnection } from "@solana/react-hooks";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number | undefined): string {
  if (!ts) return "";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function extractQuestData(post: any): {
  isQuest: boolean;
  title: string;
  reward: string;
  details: string;
} {
  const content = post?.content ?? post;

  // Primary: properties inflated to top-level fields by Tapestry
  if (content?.type === "quest") {
    return {
      isQuest: true,
      title: content?.title ?? "",
      reward: content?.reward ?? "",
      details: content?.details ?? "",
    };
  }

  // Secondary: properties array present in response
  const props: any[] = Array.isArray(content?.properties) ? content.properties : [];
  if (props.length > 0) {
    const typeEntry = props.find((p: any) => p?.key === "type");
    if (typeEntry?.value === "quest") {
      return {
        isQuest: true,
        title: props.find((p: any) => p?.key === "title")?.value ?? "",
        reward: props.find((p: any) => p?.key === "reward")?.value ?? "",
        details: props.find((p: any) => p?.key === "details")?.value ?? "",
      };
    }
  }

  // Fallback: text starts with "[QUEST]"
  // Stored format: "[QUEST] <title> — Reward: <reward>\n<details>"
  const text: string = content?.text ?? "";
  if (text.trimStart().toUpperCase().startsWith("[QUEST]")) {
    const body = text.replace(/^\[QUEST\]\s*/i, "").trim();
    const newlineIdx = body.indexOf("\n");
    const firstLine = newlineIdx === -1 ? body : body.slice(0, newlineIdx).trim();
    const details = newlineIdx === -1 ? "" : body.slice(newlineIdx + 1).trim();
    const SEP = "— Reward:";
    const sepIdx = firstLine.indexOf(SEP);
    if (sepIdx !== -1) {
      const title = firstLine.slice(0, sepIdx).trim();
      const reward = firstLine.slice(sepIdx + SEP.length).trim();
      return { isQuest: true, title, reward, details };
    }
    // No reward separator — treat whole body as title
    return { isQuest: true, title: body, reward: "", details: "" };
  }

  return { isQuest: false, title: "", reward: "", details: "" };
}

// ─── Onchain proof helper ─────────────────────────────────────────────────────
//
// Builds a Solana Memo transaction on devnet and submits it via any connected
// wallet that supports the wallet-standard. Tries signAndSendTransaction first
// (Phantom, Backpack, etc.), then falls back to signTransaction + manual RPC
// send for wallets that only support signing. All kit v2 modules are
// dynamically imported so they only load on the client (never during SSR).

const DEVNET_RPC = "https://api.devnet.solana.com";

async function submitCompletionMemo({
  questId,
  proof,
  walletObj,
  feePayer,
}: {
  questId: string;
  proof: string;
  walletObj: any;
  feePayer: string;
}): Promise<string> {
  const { createSolanaRpc } = await import("@solana/rpc");
  const {
    createTransactionMessage,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    appendTransactionMessageInstruction,
  } = await import("@solana/transaction-messages");
  const { compileTransaction, getTransactionEncoder } = await import("@solana/transactions");
  const { address } = await import("@solana/addresses");
  const { getUtf8Encoder, getBase58Decoder } = await import("@solana/codecs-strings");

  // Always fetch blockhash from devnet — cluster must match the chain we send to
  const rpc = createSolanaRpc(DEVNET_RPC as any);
  const { value: { blockhash, lastValidBlockHeight } } = await rpc.getLatestBlockhash().send();

  // Memo text — keep ≤ 120-char proof to stay well under the 566-byte tx limit
  const memoText = `GRAVEYARD_QUEST_COMPLETE|questId=${questId}|proof=${proof.slice(0, 120)}|ts=${Math.floor(Date.now() / 1000)}`;

  const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

  const txMsg = appendTransactionMessageInstruction(
    { data: getUtf8Encoder().encode(memoText), programAddress: MEMO_PROGRAM },
    setTransactionMessageLifetimeUsingBlockhash(
      { blockhash, lastValidBlockHeight },
      setTransactionMessageFeePayer(address(feePayer), createTransactionMessage({ version: 0 }))
    )
  );

  const compiledTx = compileTransaction(txMsg as any);
  const txBytes = getTransactionEncoder().encode(compiledTx) as Uint8Array;

  // Path A: wallet supports signAndSendTransaction (Phantom, Backpack, …)
  const sendFeature = walletObj?.features?.["solana:signAndSendTransaction"];
  if (sendFeature) {
    const [output] = await sendFeature.signAndSendTransaction({
      transaction: txBytes,
      chain: "solana:devnet",
      account: walletObj.account,
    });
    return getBase58Decoder().decode(output.signature as Uint8Array);
  }

  // Path B: wallet only supports signTransaction → we send it manually via RPC
  const signFeature = walletObj?.features?.["solana:signTransaction"];
  if (signFeature) {
    const [signOutput] = await signFeature.signTransaction({
      transaction: txBytes,
      account: walletObj.account,
    });
    const signedBytes = signOutput.signedTransaction as Uint8Array;
    // base64-encode for the JSON-RPC sendTransaction call
    const base64Tx = btoa(
      Array.from(signedBytes)
        .map((b) => String.fromCharCode(b))
        .join("")
    );
    const sig = await rpc
      .sendTransaction(base64Tx as any, { encoding: "base64" } as any)
      .send();
    return sig as string;
  }

  throw new Error("Connected wallet does not support transaction signing");
}

// ─── Comment text renderer ───────────────────────────────────────────────────
//
// Splits on newlines. Lines matching "Tx: <base58sig>" become clickable
// Devnet Explorer links so judges can verify the onchain Memo tx instantly.

const TX_SIG_RE = /^Tx:\s*([1-9A-HJ-NP-Za-km-z]{32,90})$/;

function renderCommentText(text: string): ReactNode {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const m = line.match(TX_SIG_RE);
        if (m) {
          const sig = m[1];
          return (
            <div key={i} style={{ fontSize: 11, marginTop: 3, opacity: 0.7 }}>
              {"Tx: "}
              <a
                href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#60a5fa", textDecoration: "underline", wordBreak: "break-all" }}
                title="View on Solana Devnet Explorer"
              >
                {sig.slice(0, 8)}…{sig.slice(-6)}
              </a>
            </div>
          );
        }
        return <div key={i}>{line}</div>;
      })}
    </>
  );
}

// ─── Shared micro-styles ─────────────────────────────────────────────────────

const btnBase = {
  padding: "7px 14px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "transparent",
  color: "inherit",
  fontSize: 13,
  cursor: "pointer",
} as const;

function btnStyle(disabled: boolean) {
  return { ...btnBase, opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" };
}

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #2a2a2a",
  background: "#0d0d0d",
  color: "inherit",
  fontSize: 13,
  boxSizing: "border-box",
} as const;

const questInputStyle = { ...inputStyle, border: "1px solid #3a1a00" };

// ─── CommentPanel ─────────────────────────────────────────────────────────────

interface CommentPanelProps {
  connected: boolean;
  comments: any[];
  loading: boolean;
  sending: boolean;
  commentText: string;
  onTextChange: (t: string) => void;
  onSend: () => void;
}

function CommentPanel({
  connected,
  comments,
  loading,
  sending,
  commentText,
  onTextChange,
  onSend,
}: CommentPanelProps) {
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #1e1e1e" }}>
      {loading && (
        <div style={{ fontSize: 12, opacity: 0.45, marginBottom: 8 }}>Loading comments…</div>
      )}

      {!loading && comments.length === 0 && (
        <div style={{ fontSize: 12, opacity: 0.35, marginBottom: 8 }}>No comments yet.</div>
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
              marginBottom: 10,
              paddingBottom: 10,
              borderBottom: "1px solid #191919",
            }}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 3 }}>
              {cAuthor && (
                <span style={{ fontWeight: 600, fontSize: 11, color: "#a3e635" }}>@{cAuthor}</span>
              )}
              {cTs && (
                <span style={{ fontSize: 10, opacity: 0.35 }}>{timeAgo(cTs)}</span>
              )}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, wordBreak: "break-word" }}>{renderCommentText(cText)}</div>
          </div>
        );
      })}

      {connected && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input
            value={commentText}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            placeholder="Add a comment…"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={onSend}
            disabled={sending || !commentText.trim()}
            style={btnStyle(sending || !commentText.trim())}
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      )}

      {!connected && (
        <div style={{ fontSize: 11, opacity: 0.35 }}>Connect wallet to comment.</div>
      )}
    </div>
  );
}

// ─── PostCard ─────────────────────────────────────────────────────────────────

interface PostCardProps {
  post: any;
  connected: boolean;
  hasLiked: boolean;
  isLiking: boolean;
  onToggleLike: () => void;
  isExpanded: boolean;
  onToggleComments: () => void;
  commentText: string;
  onCommentTextChange: (t: string) => void;
  comments: any[];
  loadingComments: boolean;
  sendingComment: boolean;
  onSendComment: () => void;
  // Quest completion
  completeText: string;
  onCompleteTextChange: (t: string) => void;
  completing: boolean;
  onMarkComplete: () => void;
}

function PostCard({
  post,
  connected,
  hasLiked,
  isLiking,
  onToggleLike,
  isExpanded,
  onToggleComments,
  commentText,
  onCommentTextChange,
  comments,
  loadingComments,
  sendingComment,
  onSendComment,
  completeText,
  onCompleteTextChange,
  completing,
  onMarkComplete,
}: PostCardProps) {
  const contentObj = post?.content ?? post;
  const rawText: string = contentObj?.text ?? contentObj?.content ?? post?.text ?? "(no content)";
  const author: string = post?.authorProfile?.username ?? "";
  const ts: number | undefined = contentObj?.created_at;
  const likeCount: number = post?.socialCounts?.likeCount ?? 0;
  const commentCount: number = post?.socialCounts?.commentCount ?? 0;
  const externalLink: string | undefined = contentObj?.externalLinkURL;
  const { isQuest, title, reward, details } = extractQuestData(post);

  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${isQuest ? "#78350f" : "#1e1e1e"}`,
        background: isQuest ? "rgba(120,53,15,0.07)" : "#111",
        padding: 16,
      }}
    >
      {/* Quest badge */}
      {isQuest && (
        <div
          style={{
            display: "inline-block",
            background: "#78350f",
            color: "#fbbf24",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            padding: "2px 8px",
            borderRadius: 4,
            marginBottom: 10,
          }}
        >
          ⚔️ QUEST
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: isQuest ? "#fbbf24" : "#a3e635" }}>
          {author ? `@${author}` : ""}
        </span>
        <span style={{ fontSize: 11, opacity: 0.35 }}>{timeAgo(ts)}</span>
      </div>

      {/* Body */}
      {isQuest ? (
        <div style={{ display: "grid", gap: 6 }}>
          {title && (
            <div style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.4 }}>{title}</div>
          )}
          {reward && (
            <div style={{ fontSize: 13, color: "#fbbf24" }}>
              🏆 <strong>Reward:</strong> {reward}
            </div>
          )}
          {details && (
            <div style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {details}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 15, lineHeight: 1.65, wordBreak: "break-word" }}>{rawText}</div>
      )}

      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
        {/* Like */}
        <button
          onClick={onToggleLike}
          disabled={!connected || isLiking}
          title={!connected ? "Connect wallet to like" : undefined}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 12px", borderRadius: 20,
            border: `1px solid ${hasLiked ? "#c084fc" : "#2a2a2a"}`,
            background: hasLiked ? "rgba(192,132,252,0.1)" : "transparent",
            color: hasLiked ? "#c084fc" : "inherit",
            cursor: !connected || isLiking ? "not-allowed" : "pointer",
            opacity: isLiking ? 0.55 : !connected ? 0.45 : 1,
            fontSize: 12,
          }}
        >
          <span>{hasLiked ? "♥" : "♡"}</span>
          <span>{likeCount}</span>
        </button>

        {/* Comments */}
        <button
          onClick={onToggleComments}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 12px", borderRadius: 20,
            border: `1px solid ${isExpanded ? "#60a5fa" : "#2a2a2a"}`,
            background: isExpanded ? "rgba(96,165,250,0.1)" : "transparent",
            color: isExpanded ? "#60a5fa" : "inherit",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <span>💬</span>
          <span>{commentCount}</span>
        </button>

        {/* External link */}
        {externalLink && (
          <a
            href={externalLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 20,
              border: "1px solid #2a2a2a",
              color: "inherit", textDecoration: "none",
              fontSize: 12, opacity: 0.65,
            }}
          >
            🔗 Link
          </a>
        )}

        {!connected && (
          <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.35 }}>
            Connect wallet to interact
          </span>
        )}
      </div>

      {/* Quest completion */}
      {isQuest && connected && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #3a1a00" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <div
              style={{
                fontSize: 10,
                color: "#fbbf24",
                opacity: 0.6,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
              }}
            >
              Mark Complete
            </div>
            <div style={{ fontSize: 10, opacity: 0.35, color: "#d97706" }}>
              Writes a Solana Memo tx (devnet) + posts proof as a comment.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={completeText}
              onChange={(e) => onCompleteTextChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onMarkComplete(); } }}
              placeholder="Proof of completion…"
              style={{ ...inputStyle, flex: 1, border: "1px solid #3a1a00", fontSize: 12, padding: "6px 10px" }}
            />
            <button
              onClick={onMarkComplete}
              disabled={completing || !completeText.trim()}
              style={{
                ...btnStyle(completing || !completeText.trim()),
                borderColor: "#78350f",
                color: "#fbbf24",
                fontSize: 12,
                padding: "6px 12px",
              }}
            >
              {completing ? "…" : "✅ Complete"}
            </button>
          </div>
        </div>
      )}

      {/* Comment panel */}
      {isExpanded && (
        <CommentPanel
          connected={connected}
          comments={comments}
          loading={loadingComments}
          sending={sendingComment}
          commentText={commentText}
          onTextChange={onCommentTextChange}
          onSend={onSendComment}
        />
      )}
    </div>
  );
}

// ─── FeedPage ─────────────────────────────────────────────────────────────────

export default function FeedPage() {
  const { connectors, connect, disconnect, wallet, status } = useWalletConnection();
  const connected = status === "connected";

  const walletAddress = useMemo(() => {
    if (!connected) return "";
    return wallet?.account.address?.toString?.() ?? String(wallet?.account.address ?? "");
  }, [connected, wallet]);

  // Post composer
  const [text, setText] = useState("");
  const [loadingPost, setLoadingPost] = useState(false);

  // Quest composer
  const [questTitle, setQuestTitle] = useState("");
  const [questReward, setQuestReward] = useState("");
  const [questDetails, setQuestDetails] = useState("");
  const [loadingQuest, setLoadingQuest] = useState(false);

  // Feed / UI
  const [activeTab, setActiveTab] = useState<"all" | "quests" | "mine">("all");
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<any>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Like state
  const [likingIds, setLikingIds] = useState<Record<string, boolean>>({});
  const [likedIds, setLikedIds] = useState<Record<string, boolean>>({});

  // Per-post comment state
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [postComments, setPostComments] = useState<Record<string, any[]>>({});
  const [loadingComments, setLoadingComments] = useState<Record<string, boolean>>({});
  const [sendingComment, setSendingComment] = useState<Record<string, boolean>>({});

  // Per-quest completion state
  const [completeProofs, setCompleteProofs] = useState<Record<string, string>>({});
  const [completingIds, setCompletingIds] = useState<Record<string, boolean>>({});

  // Demo seed — persisted per wallet so the button stays disabled after first run
  const [seedStatus, setSeedStatus] = useState<"idle" | "running" | "done">("idle");

  // Restore "done" state from localStorage when wallet connects
  useEffect(() => {
    if (!walletAddress) return;
    if (typeof window !== "undefined" && localStorage.getItem(`gq:seeded:${walletAddress}`)) {
      setSeedStatus("done");
    }
  }, [walletAddress]);

  const allPosts: any[] = useMemo(() => {
    if (!feed) return [];
    if (Array.isArray(feed)) return feed;
    if (Array.isArray(feed?.contents)) return feed.contents;
    if (Array.isArray(feed?.data)) return feed.data;
    if (Array.isArray(feed?.items)) return feed.items;
    return [];
  }, [feed]);

  // Tapestry stores profile id as "user_<first6>" — same value for both
  // authorProfile.id and authorProfile.username in practice, but we check both
  // to be safe against any future shape differences.
  const myAuthorId = useMemo(
    () => walletAddress ? `user_${walletAddress.slice(0, 6)}` : "",
    [walletAddress]
  );

  const posts: any[] = useMemo(() => {
    if (activeTab === "quests") return allPosts.filter((p) => extractQuestData(p).isQuest);
    if (activeTab === "mine") {
      return allPosts.filter((p) => {
        const ap = p?.authorProfile;
        const byId = ap?.id && ap.id === myAuthorId;
        const byUsername = ap?.username && ap.username === myAuthorId;
        return byId || byUsername;
      });
    }
    return allPosts;
  }, [allPosts, activeTab, myAuthorId]);

  // ── Handlers ──────────────────────────────────────────────────────────────

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
    if (!text.trim()) { setError("Type something first."); return; }
    if (!walletAddress) return;
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

  async function createQuest() {
    setError(null);
    if (!questTitle.trim() || !questReward.trim()) {
      setError("Title and Reward are required.");
      return;
    }
    if (!walletAddress) return;
    setLoadingQuest(true);
    try {
      const res = await fetch("/api/tapestry/quest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          title: questTitle,
          reward: questReward,
          details: questDetails,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to create quest");
      setQuestTitle("");
      setQuestReward("");
      setQuestDetails("");
      await refreshFeed();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoadingQuest(false);
    }
  }

  async function toggleLike(contentId: string, hasLiked: boolean) {
    if (!walletAddress || likingIds[contentId]) return;
    setLikingIds((prev) => ({ ...prev, [contentId]: true }));
    setLikedIds((prev) => ({ ...prev, [contentId]: !hasLiked }));
    try {
      const res = await fetch("/api/tapestry/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, contentId, action: hasLiked ? "unlike" : "like" }),
      });
      const data = await res.json();
      if (!res.ok) {
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
      const list: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.comments)
        ? data.comments
        : [];
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
    if (next && !postComments[contentId]) loadComments(contentId);
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
      await Promise.all([loadComments(contentId), refreshFeed()]);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSendingComment((prev) => ({ ...prev, [contentId]: false }));
    }
  }

  async function markComplete(contentId: string) {
    const proof = (completeProofs[contentId] ?? "").trim();
    if (!walletAddress || !proof || completingIds[contentId]) return;
    setCompletingIds((prev) => ({ ...prev, [contentId]: true }));
    try {
      // Build the comment text. If wallet is connected, try to anchor the proof
      // onchain first and include the tx signature; fall back gracefully on error.
      let commentText = `✅ Completed: ${proof}`;
      if (connected && wallet) {
        try {
          const sig = await submitCompletionMemo({
            questId: contentId,
            proof,
            walletObj: wallet,
            feePayer: walletAddress,
          });
          commentText = `✅ Completed: ${proof}\nTx: ${sig}`;
        } catch (txErr: any) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[graveyard-quests] Memo tx failed:", txErr?.message ?? txErr);
          }
          commentText = `✅ Completed: ${proof}\nTx: (failed to submit)`;
        }
      }

      const res = await fetch("/api/tapestry/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, contentId, text: commentText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to mark complete");
      setCompleteProofs((prev) => ({ ...prev, [contentId]: "" }));
      // Expand comments so the completion entry is immediately visible
      setExpandedComments((prev) => ({ ...prev, [contentId]: true }));
      await Promise.all([loadComments(contentId), refreshFeed()]);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setCompletingIds((prev) => ({ ...prev, [contentId]: false }));
    }
  }

  async function seedDemo() {
    if (!walletAddress || seedStatus === "running" || seedStatus === "done") return;
    setError(null);
    setSeedStatus("running");
    try {
      // 1 — demo quest; capture returned id directly
      const qRes = await fetch("/api/tapestry/quest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          title: "Demo Quest: Explore the Graveyard",
          reward: "10 SOL",
          details: "Find all hidden tombs before midnight. Screenshot required.",
        }),
      });
      const qData = await qRes.json();
      if (!qRes.ok) throw new Error(qData?.error ?? "Quest creation failed");
      const questId: string | undefined = qData?.id;

      // 2 — demo post; capture returned id as fallback
      const pRes = await fetch("/api/tapestry/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, text: "Just joined Graveyard Quests! 🪦 Ready to explore." }),
      });
      const pData = await pRes.json();
      if (!pRes.ok) throw new Error(pData?.error ?? "Post creation failed");
      const postId: string | undefined = pData?.id;

      // Prefer the quest id; fall back to post id. No feed fetch needed.
      const targetId: string | undefined = questId ?? postId;

      if (targetId) {
        // 3 — comment on the quest
        await fetch("/api/tapestry/comment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress, contentId: targetId, text: "Seeded via demo 🎉 — welcome to Graveyard Quests!" }),
        });
        // 4 — like the quest
        await fetch("/api/tapestry/like", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress, contentId: targetId, action: "like" }),
        });
      }

      await refreshFeed();
      setActiveTab("all");
      setSeedStatus("done");
      if (typeof window !== "undefined") {
        localStorage.setItem(`gq:seeded:${walletAddress}`, "1");
      }
    } catch (e: any) {
      setError(e?.message ?? "Seed failed");
      setSeedStatus("idle");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            Graveyard Quests
          </h1>
          <a
            href="/rewards"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 20,
              border: "1px solid rgba(251,191,36,0.35)",
              background: "rgba(251,191,36,0.06)",
              color: "#fbbf24",
              fontSize: 12, fontWeight: 600,
              textDecoration: "none",
              letterSpacing: "0.02em",
            }}
          >
            🏆 Rewards
          </a>
        </div>
        <p style={{ opacity: 0.4, margin: "4px 0 0", fontSize: 13 }}>
          Post, quest, like, and comment — powered by Tapestry.
        </p>
      </div>

      {/* Wallet */}
      <div
        style={{
          marginBottom: 16,
          padding: 14,
          border: "1px solid #1e1e1e",
          borderRadius: 12,
          background: "#111",
        }}
      >
        <div
          style={{
            fontSize: 10,
            opacity: 0.4,
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Wallet
        </div>

        {connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <code style={{ flex: 1, fontSize: 11, wordBreak: "break-all", opacity: 0.7 }}>
              {walletAddress}
            </code>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button
                onClick={refreshFeed}
                disabled={loadingFeed}
                style={btnStyle(loadingFeed)}
              >
                {loadingFeed ? "Refreshing…" : "Refresh"}
              </button>
              <button
                onClick={seedDemo}
                disabled={seedStatus === "running"}
                title="Create a demo quest, post, comment, and like in one click"
                style={{
                  ...btnStyle(seedStatus === "running"),
                  borderColor: seedStatus === "done" ? "#22c55e" : "#444",
                  color: seedStatus === "done" ? "#22c55e" : "inherit",
                }}
              >
                {seedStatus === "running" ? "Seeding…" : seedStatus === "done" ? "Seeded ✅" : "Demo seed"}
              </button>
              <button onClick={disconnect} style={btnStyle(false)}>
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.4, marginBottom: 8 }}>
                Connect a Solana wallet to get started.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {connectors.map((c) => (
                  <button
                    key={c.id}
                    onClick={async () => {
                      setError(null);
                      try { await connect(c.id); }
                      catch (e: any) { setError(e?.message ?? "Failed to connect wallet"); }
                    }}
                    style={btnStyle(false)}
                  >
                    {c.name}
                  </button>
                ))}
                {connectors.length === 0 && (
                  <span style={{ fontSize: 13, opacity: 0.4 }}>
                    No wallets detected — install Phantom or another Solana wallet.
                  </span>
                )}
              </div>
              {status === "connecting" && (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.45 }}>Connecting…</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #7f1d1d",
            background: "rgba(127,29,29,0.12)",
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>❌ {error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              opacity: 0.5,
              color: "inherit",
              fontSize: 14,
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Tab switcher */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          background: "#111",
          padding: 4,
          borderRadius: 10,
          border: "1px solid #1e1e1e",
        }}
      >
        {(["all", "quests", "mine"] as const).map((tab) => {
          const isActive = activeTab === tab;
          const tabLabel = tab === "all" ? "All Posts" : tab === "quests" ? "⚔️ Quests" : "My Activity";
          const activeBg = tab === "quests" ? "#78350f" : tab === "mine" ? "#1e3a5f" : "#1a1a1a";
          const activeColor = tab === "quests" ? "#fbbf24" : tab === "mine" ? "#60a5fa" : "inherit";
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: isActive ? 700 : 400,
                background: isActive ? activeBg : "transparent",
                color: isActive ? activeColor : "inherit",
                opacity: isActive ? 1 : 0.5,
              }}
            >
              {tabLabel}
            </button>
          );
        })}
      </div>

      {/* Post composer (All tab) */}
      {connected && activeTab === "all" && (
        <div
          style={{
            marginBottom: 16,
            padding: 14,
            border: "1px solid #1e1e1e",
            borderRadius: 12,
            background: "#111",
          }}
        >
          <div
            style={{
              fontSize: 10,
              opacity: 0.4,
              marginBottom: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            New Post
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's happening?"
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button
              onClick={createPost}
              disabled={!text.trim() || loadingPost}
              style={{
                ...btnStyle(!text.trim() || loadingPost),
                background: !text.trim() || loadingPost ? "transparent" : "#1d4ed8",
                borderColor: "#1d4ed8",
                color: "#fff",
                padding: "8px 22px",
                fontWeight: 600,
              }}
            >
              {loadingPost ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      )}

      {/* Quest composer (Quests tab) */}
      {connected && activeTab === "quests" && (
        <div
          style={{
            marginBottom: 16,
            padding: 14,
            border: "1px solid #78350f",
            borderRadius: 12,
            background: "rgba(120,53,15,0.07)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#fbbf24",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            ⚔️ Publish Quest
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              value={questTitle}
              onChange={(e) => setQuestTitle(e.target.value)}
              placeholder="Quest title *"
              style={questInputStyle}
            />
            <input
              value={questReward}
              onChange={(e) => setQuestReward(e.target.value)}
              placeholder="Reward (e.g. 50 SOL, NFT drop) *"
              style={questInputStyle}
            />
            <textarea
              value={questDetails}
              onChange={(e) => setQuestDetails(e.target.value)}
              placeholder="Details / requirements (optional)"
              rows={3}
              style={{ ...questInputStyle, resize: "vertical" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button
              onClick={createQuest}
              disabled={!questTitle.trim() || !questReward.trim() || loadingQuest}
              style={{
                ...btnStyle(!questTitle.trim() || !questReward.trim() || loadingQuest),
                background:
                  !questTitle.trim() || !questReward.trim() || loadingQuest
                    ? "transparent"
                    : "#78350f",
                borderColor: "#78350f",
                color: "#fbbf24",
                padding: "8px 22px",
                fontWeight: 600,
              }}
            >
              {loadingQuest ? "Publishing…" : "Publish Quest"}
            </button>
          </div>
        </div>
      )}

      {/* Feed panel */}
      <div
        style={{
          border: "1px solid #1e1e1e",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {/* Feed header bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 14px",
            borderBottom: "1px solid #1a1a1a",
            background: "#111",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {activeTab === "quests" ? "⚔️ Quests" : activeTab === "mine" ? "My Activity" : "Feed"}
            {feed && (
              <span style={{ fontWeight: 400, opacity: 0.35, marginLeft: 8, fontSize: 12 }}>
                {posts.length} {posts.length === 1 ? "post" : "posts"}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {feed && (
              <button
                onClick={() => setShowRaw((v) => !v)}
                style={{ ...btnStyle(false), fontSize: 11, padding: "5px 10px" }}
              >
                {showRaw ? "Cards" : "Raw JSON"}
              </button>
            )}
            <button
              onClick={refreshFeed}
              disabled={!connected || loadingFeed}
              style={{ ...btnStyle(!connected || loadingFeed), fontSize: 11, padding: "5px 10px" }}
            >
              {loadingFeed ? "Loading…" : "Load"}
            </button>
          </div>
        </div>

        {/* Feed body */}
        <div style={{ padding: 14, background: "#0a0a0a" }}>
          {/* Not connected + no feed */}
          {!connected && !feed && (
            <div style={{ textAlign: "center", padding: "36px 0", opacity: 0.35, fontSize: 14 }}>
              Connect a Solana wallet to load the feed.
            </div>
          )}

          {/* Loading skeleton */}
          {loadingFeed && (
            <div style={{ display: "grid", gap: 10 }}>
              {[80, 110, 70].map((h, n) => (
                <div
                  key={n}
                  style={{
                    height: h,
                    borderRadius: 12,
                    border: "1px solid #1a1a1a",
                    background: "#111",
                    opacity: 0.5,
                  }}
                />
              ))}
            </div>
          )}

          {/* Raw JSON view */}
          {feed && showRaw && !loadingFeed && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
                fontSize: 11,
                opacity: 0.75,
                lineHeight: 1.5,
              }}
            >
              {JSON.stringify(feed, null, 2)}
            </pre>
          )}

          {/* Card list */}
          {feed && !showRaw && !loadingFeed && (
            posts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 0", opacity: 0.35, fontSize: 14 }}>
                {activeTab === "quests"
                  ? "No quests yet — publish the first one above."
                  : activeTab === "mine"
                  ? "No activity yet — create a post or complete a quest."
                  : "No posts yet — create one above."}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {posts.map((post: any, i: number) => {
                  const contentObj = post?.content ?? post;
                  const contentId: string = contentObj?.id ?? String(i);
                  const serverHasLiked: boolean | undefined =
                    post?.requestingProfileSocialInfo?.hasLiked;
                  const hasLiked: boolean =
                    contentId in likedIds ? likedIds[contentId] : serverHasLiked ?? false;
                  return (
                    <PostCard
                      key={contentId}
                      post={post}
                      connected={connected}
                      hasLiked={hasLiked}
                      isLiking={!!likingIds[contentId]}
                      onToggleLike={() => toggleLike(contentId, hasLiked)}
                      isExpanded={!!expandedComments[contentId]}
                      onToggleComments={() => toggleComments(contentId)}
                      commentText={commentTexts[contentId] ?? ""}
                      onCommentTextChange={(t) =>
                        setCommentTexts((prev) => ({ ...prev, [contentId]: t }))
                      }
                      comments={postComments[contentId] ?? []}
                      loadingComments={!!loadingComments[contentId]}
                      sendingComment={!!sendingComment[contentId]}
                      onSendComment={() => sendComment(contentId)}
                      completeText={completeProofs[contentId] ?? ""}
                      onCompleteTextChange={(t) =>
                        setCompleteProofs((prev) => ({ ...prev, [contentId]: t }))
                      }
                      completing={!!completingIds[contentId]}
                      onMarkComplete={() => markComplete(contentId)}
                    />
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </main>
  );
}
