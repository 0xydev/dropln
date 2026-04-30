import * as React from "react";
import {
  IconCopy,
  IconLock,
  IconMessage,
  IconShieldCheck,
  IconText,
} from "./icons";
import { Identicon, MOD, useToast } from "./primitives";
import { decryptComment, encryptComment } from "../crypto";
import { createComment, listComments } from "../api";

type CommentThreadProps = {
  pasteId: string;
  /** Raw 32-byte paste key (decoded from URL fragment). */
  pasteKey: Uint8Array;
  password?: string;
  /** When true, lock the composer — backend FK would reject anyway once the paste row is purged. */
  isExpired?: boolean;
  onComment?: () => void;
};

type DecryptedComment = {
  id: string;
  parentId: string;
  body: string;
  /** Unix seconds, server-issued. */
  created: number;
  /** Optimistic placeholder before server confirms. */
  pending?: boolean;
};

function relativeTime(unixSec: number): string {
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

function absoluteTime(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function CommentThread({
  pasteId,
  pasteKey,
  password = "",
  isExpired = false,
  onComment,
}: CommentThreadProps) {
  const [comments, setComments] = React.useState<DecryptedComment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [hoverTs, setHoverTs] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const toast = useToast();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const records = await listComments(pasteId);
      const decrypted: DecryptedComment[] = [];
      for (const rec of records) {
        try {
          const plain = await decryptComment(rec, pasteKey, password);
          decrypted.push({
            id: rec.id,
            parentId: rec.parentid,
            body: plain.comment,
            created: rec.created,
          });
        } catch (err) {
          console.error("could not decrypt comment", rec.id, err);
        }
      }
      setComments(decrypted);
    } catch (err) {
      console.error("listComments failed", err);
      toast({ msg: "Failed to load comments", kind: "warn" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteId, password]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    // Optimistic insert: temp id is non-hex on purpose so it can never
    // collide with a server-issued one. Roll back if either encrypt or
    // upload fails — restore the user's draft so they don't lose typing.
    const tempId = "tmp_" + Math.random().toString(36).slice(2, 10);
    const tempComment: DecryptedComment = {
      id: tempId,
      parentId: pasteId,
      body,
      created: Math.floor(Date.now() / 1000),
      pending: true,
    };
    setComments((cs) => [...cs, tempComment]);
    setDraft("");
    setPosting(true);
    try {
      const envelope = await encryptComment({
        body,
        pasteId,
        parentId: pasteId,
        pasteKey,
        password,
      });
      await createComment(pasteId, envelope);
      // Refetch replaces the tmp_ entry with the server-confirmed one.
      await refresh();
      toast({ msg: "Encrypted comment posted", kind: "ok" });
      onComment?.();
    } catch (err) {
      console.error("post comment failed", err);
      setComments((cs) => cs.filter((c) => c.id !== tempId));
      setDraft(body); // restore so user can retry
      toast({ msg: "Failed to post comment", kind: "warn" });
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="thread">
      <div className="thread-head">
        <IconMessage size={14} />
        <h3>Discussion</h3>
        <span className="thread-count">
          {loading
            ? "loading…"
            : `${comments.length} encrypted comment${comments.length === 1 ? "" : "s"}`}
        </span>
        <span style={{ flex: 1 }}></span>
        <span className="badge badge-accent">
          <IconShieldCheck size={11} /> shared key
        </span>
      </div>

      {!loading && comments.length === 0 && (
        <div
          style={{
            padding: "20px 16px",
            color: "var(--fg-2)",
            fontSize: "var(--tx-md)",
            textAlign: "center",
            border: "1px dashed var(--line-1)",
            borderRadius: "var(--r-md)",
            margin: "8px 0",
          }}
        >
          No comments yet. Be the first.
        </div>
      )}

      {comments.map((c) => (
        <div
          key={c.id}
          className={"comment" + (c.pending ? " comment-pending" : "")}
        >
          <Identicon seed={c.id} />
          <div className="comment-main">
            <div className="comment-head">
              {/*
                Comments are anonymous (no auth). The identicon is a stable
                visual hash of the server-issued comment id — distinguishes
                comments at a glance without inventing fake usernames.
              */}
              <span
                className="comment-time"
                onMouseEnter={() => setHoverTs(c.id)}
                onMouseLeave={() => setHoverTs(null)}
                style={{ position: "relative" }}
              >
                {c.pending ? (
                  <>
                    <span className="spinner spinner-sm" /> sending…
                  </>
                ) : (
                  relativeTime(c.created)
                )}
                {!c.pending && hoverTs === c.id && (
                  <span
                    className="tooltip"
                    style={{ top: "calc(100% + 4px)", left: 0 }}
                  >
                    {absoluteTime(c.created)}
                  </span>
                )}
              </span>
            </div>
            <div className="comment-body">{c.body}</div>
            <div className="comment-actions">
              <button
                className="comment-action"
                onClick={() => {
                  navigator.clipboard?.writeText(c.body).catch(() => {});
                  toast({ msg: "Comment copied", kind: "ok" });
                }}
              >
                <IconCopy size={11} /> Copy
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className={"composer" + (isExpired ? " composer-disabled" : "")}>
        <div className="composer-head">
          <IconText size={11} />
          <label>Plain text</label>
          <span style={{ flex: 1 }}></span>
          <span className="composer-reassure">
            <IconShieldCheck size={11} /> Encrypted with the paste's key
          </span>
        </div>
        <textarea
          className="composer-textarea"
          value={draft}
          disabled={isExpired}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            isExpired
              ? "This paste has expired — comments are closed."
              : "Add a comment…"
          }
          onKeyDown={(e) => {
            if (!isExpired && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void post();
            }
          }}
        />
        <div className="composer-foot">
          <span className="muted mono" style={{ fontSize: 11 }}>
            {isExpired ? (
              <>parent paste expired · server-side comments removed</>
            ) : (
              <>
                <span className="kbd">{MOD}</span> <span className="kbd">↵</span> to post
              </>
            )}
          </span>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void post()}
            disabled={isExpired || !draft.trim() || posting}
          >
            {posting ? (
              <>
                <span className="spinner"></span> Encrypting…
              </>
            ) : (
              <>
                <IconLock size={12} /> Post encrypted comment
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
