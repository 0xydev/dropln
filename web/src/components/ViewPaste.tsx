import * as React from "react";
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFlame,
  IconKey,
  IconLock,
  IconMaximize,
  IconMessage,
  IconMinimize,
  IconMore,
  IconPlus,
  IconShare,
  IconText,
} from "./icons";
import { useKeyboard, useToast } from "./primitives";
import { CommentThread } from "./CommentThread";
import type { PasteData, PasteSettings } from "./SuccessCard";
import { FORMATS } from "../lib/options";
import { formatBytes, formatCountdown, langExt } from "../lib/format-utils";
import { base64UrlToBytes } from "../crypto/cipher";
import { CodeEditor } from "./CodeEditor";
import { IconDownload, IconFile } from "./icons";
import { downloadDataUrl, inspectDataUrl, languageForAttachment, textFromDataUrl } from "../lib/file-utils";
import { renderMarkdown } from "../lib/markdown";

export type DecryptedAttachment = { name: string; dataUrl: string };

function viewerLanguage(s: PasteSettings): string | undefined {
  if (s.format === "md") return "markdown";
  if (s.format === "code") return s.language;
  return undefined;
}

// ─── Expired banner ──────────────────────────────────────────────────────
// Shown above the paste content once expires_at has passed. We deliberately
// do NOT auto-blank the decrypted content: it's already in browser memory,
// hiding it gives a false sense of security. The honest message is "the
// server-side copy is gone, save what you need before refreshing."

function ExpiredBanner() {
  return (
    <div className="expired-banner" role="alert">
      <span className="expired-banner-icon">
        <IconAlert size={14} />
      </span>
      <div className="expired-banner-text">
        <strong>This paste has expired.</strong>
        <span>
          The server-side copy was deleted. You're seeing the cached decryption
          in this tab — refresh and it's gone. Copy anything you still need.
        </span>
      </div>
    </div>
  );
}

// ─── Markdown ────────────────────────────────────────────────────────────
// Renders the decrypted plaintext as HTML when format=markdown.
// Sanitized first; styling lives in styles.css under .markdown-view.

function MarkdownView({ source }: { source: string }) {
  const html = React.useMemo(() => renderMarkdown(source), [source]);
  return (
    <div
      className="markdown-view"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Attachment ──────────────────────────────────────────────────────────
// Renders the decrypted attachment with a MIME-aware preview + download.
// Server never sees this — it's part of the encrypted plaintext envelope.

function AttachmentBlock({ attachment }: { attachment: DecryptedAttachment }) {
  const info = inspectDataUrl(attachment.dataUrl);
  const [lightbox, setLightbox] = React.useState(false);

  // Esc closes the image lightbox.
  React.useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // For text attachments, decode once and reuse — base64 → utf-8 isn't free.
  const textContent = React.useMemo(
    () => (info.isText ? textFromDataUrl(attachment.dataUrl) : ""),
    [info.isText, attachment.dataUrl],
  );

  return (
    <div className="attachment-block">
      <div className="attachment-head">
        <IconFile size={13} />
        <span className="attachment-name mono">{attachment.name}</span>
        <span className="muted mono attachment-meta">
          {info.mime} · {formatBytes(info.approxBytes)}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn btn-outline btn-sm"
          onClick={() => downloadDataUrl(attachment.name, attachment.dataUrl)}
        >
          <IconDownload size={12} /> Download
        </button>
      </div>
      <div className="attachment-preview">
        {info.isImage && (
          <img
            src={attachment.dataUrl}
            alt={attachment.name}
            style={{ cursor: "zoom-in" }}
            onClick={() => setLightbox(true)}
          />
        )}
        {info.isVideo && (
          <video src={attachment.dataUrl} controls preload="metadata" />
        )}
        {info.isAudio && (
          <audio src={attachment.dataUrl} controls preload="metadata" />
        )}
        {info.isPdf && (
          <iframe
            src={attachment.dataUrl}
            title={attachment.name}
            className="attachment-pdf"
          />
        )}
        {info.isText && (
          <div className="attachment-text">
            <CodeEditor
              className="ulak-cm-host"
              value={textContent}
              language={languageForAttachment(attachment.name, info.mime)}
              readOnly
            />
          </div>
        )}
        {!info.isImage && !info.isVideo && !info.isAudio && !info.isPdf && !info.isText && (
          <div className="attachment-blob">
            <IconFile size={20} />
            <span className="muted mono">Encrypted file · click Download to save</span>
          </div>
        )}
      </div>

      {lightbox && info.isImage && (
        <div
          className="lightbox"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-label="Image preview"
        >
          <img src={attachment.dataUrl} alt={attachment.name} />
        </div>
      )}
    </div>
  );
}

export type ViewState =
  | "loading"
  | "success"
  | "burn-gate"
  | "password"
  | "not-found"
  | "decrypt-fail";

type ViewPasteProps = {
  state: ViewState;
  pasteData: PasteData;
  settings: PasteSettings;
  content: string;
  attachment?: DecryptedAttachment | null;
  passwordError?: boolean;
  onBack: () => void;
  onProceedBurn: () => void;
  onUnlock: (password: string) => void;
  onComment?: () => void;
};

export function ViewPaste({
  state,
  onBack,
  pasteData,
  settings,
  content,
  attachment,
  passwordError,
  onProceedBurn,
  onUnlock,
  onComment,
}: ViewPasteProps) {
  if (state === "loading") return <ViewLoading />;
  if (state === "burn-gate")
    return <BurnGate onProceed={onProceedBurn} onCancel={onBack} pasteData={pasteData} />;
  if (state === "password")
    return <PasswordGate onUnlock={onUnlock} onCancel={onBack} externalError={passwordError} />;
  if (state === "not-found")
    return (
      <ErrorView
        code="404"
        title="This paste no longer exists"
        sub="It may have expired or been deleted by its author."
        onBack={onBack}
      />
    );
  if (state === "decrypt-fail")
    return (
      <ErrorView
        code="DEC"
        title="Couldn't decrypt this paste"
        sub="The link may be corrupted, the key was modified, or the password is wrong."
        onBack={onBack}
      />
    );

  return (
    <ViewSuccess
      pasteData={pasteData}
      settings={settings}
      content={content}
      attachment={attachment}
      onComment={onComment}
    />
  );
}

function ViewLoading() {
  return (
    <div className="loading-stage">
      <div className="lock-pulse">
        <IconLock size={20} />
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--fg-1)",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span className="spinner"></span>
        Decrypting in your browser…
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--fg-3)",
          fontSize: 11,
        }}
      >
        Fetching ciphertext · deriving key · AES-256-GCM
      </div>
    </div>
  );
}

function BurnGate({
  onProceed,
  onCancel,
  pasteData,
}: {
  onProceed: () => void;
  onCancel: () => void;
  pasteData: PasteData;
}) {
  return (
    <div className="gate-stage">
      <div className="gate-card">
        <div className="gate-banner"></div>
        <div className="gate-card-body">
          <div className="gate-icon">
            <IconFlame size={20} />
          </div>
          <h2 className="gate-title">
            This paste will be destroyed once you read it
          </h2>
          <p className="gate-sub">
            The author marked this paste{" "}
            <strong style={{ color: "var(--burn)" }}>burn-after-read</strong>.
            Opening it deletes the ciphertext from the server and no one —
            including you — will be able to access it again.
          </p>
          <div
            style={{
              padding: "10px 12px",
              marginBottom: 18,
              background: "var(--bg-inset)",
              border: "1px solid var(--line-1)",
              borderRadius: "var(--r-sm)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--fg-2)",
              lineHeight: 1.6,
            }}
          >
            <div>
              paste_id&nbsp;&nbsp;
              <span style={{ color: "var(--fg-0)" }}>{pasteData.id}</span>
            </div>
            <div>
              created&nbsp;&nbsp;&nbsp;
              <span style={{ color: "var(--fg-0)" }}>3 minutes ago</span>
            </div>
            <div>
              once_read&nbsp;
              <span style={{ color: "var(--burn)" }}>destroy()</span>
            </div>
          </div>
          <div className="gate-actions">
            <button
              className="btn btn-primary"
              style={{
                background: "var(--burn)",
                color: "#fff",
                borderColor: "var(--burn)",
              }}
              onClick={onProceed}
            >
              <IconFlame size={13} /> Continue and burn
            </button>
            <button className="btn btn-outline" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordGate({
  onUnlock,
  onCancel,
  externalError,
}: {
  onUnlock: (password: string) => void;
  onCancel: () => void;
  externalError?: boolean;
}) {
  const [pw, setPw] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [trying, setTrying] = React.useState(false);
  const err = externalError;

  // Reset trying state when externalError changes (parent rejected the password).
  React.useEffect(() => {
    if (externalError) setTrying(false);
  }, [externalError]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!pw) return;
    setTrying(true);
    onUnlock(pw);
  };

  return (
    <div className="pw-stage">
      <form className="pw-card" onSubmit={submit}>
        <div className="pw-icon">
          <IconKey size={16} />
        </div>
        <h2
          style={{
            fontSize: "var(--tx-xl)",
            fontWeight: 600,
            margin: "0 0 6px",
            letterSpacing: "-0.015em",
          }}
        >
          This paste needs a password
        </h2>
        <p
          style={{
            color: "var(--fg-1)",
            fontSize: "var(--tx-md)",
            margin: "0 0 18px",
          }}
        >
          The password is combined with the URL key to derive the decryption
          key. It never leaves your browser.
        </p>
        <label className="input" style={{ marginBottom: 12 }}>
          <input
            className="input-mono"
            type={showPw ? "text" : "password"}
            placeholder="Password"
            value={pw}
            autoFocus
            onChange={(e) => {
              setPw(e.target.value);
            }}
            style={{
              background: "transparent",
              border: "none",
              flex: 1,
              outline: "none",
            }}
          />
          <button
            type="button"
            className="btn-icon btn btn-ghost"
            style={{ width: 22, height: 22 }}
            onClick={() => setShowPw((v) => !v)}
          >
            {showPw ? <IconEyeOff size={12} /> : <IconEye size={12} />}
          </button>
        </label>
        {err && (
          <div
            style={{
              fontSize: 12,
              color: "var(--burn)",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <IconAlert size={12} /> Wrong password — try again.
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!pw || trying}
            style={{ flex: 1 }}
          >
            {trying ? (
              <>
                <span className="spinner"></span> Decrypting…
              </>
            ) : (
              <>
                <IconLock size={13} /> Decrypt
              </>
            )}
          </button>
          <button type="button" className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function ErrorView({
  code,
  title,
  sub,
  onBack,
}: {
  code: string;
  title: string;
  sub: string;
  onBack: () => void;
}) {
  return (
    <div className="err-stage">
      <div className="err-card">
        <div className="err-code mono">{code}</div>
        <h2 className="err-title">{title}</h2>
        <p className="err-sub">{sub}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="btn btn-primary" onClick={onBack}>
            <IconPlus size={13} /> Create new paste
          </button>
          <a
            className="btn btn-outline"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onBack();
            }}
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

function ViewSuccess({
  pasteData,
  settings,
  content,
  attachment,
  onComment,
}: {
  pasteData: PasteData;
  settings: PasteSettings;
  content: string;
  attachment?: DecryptedAttachment | null;
  onComment?: () => void;
}) {
  const [now, setNow] = React.useState(Date.now());
  const [copied, setCopied] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const toast = useToast();
  React.useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const remaining = pasteData.expiresAt - now;
  const countdown = formatCountdown(remaining);
  // "never" pastes get Number.MAX_SAFE_INTEGER, so remaining stays huge.
  const isExpired = remaining <= 0;

  const copyContent = () => {
    navigator.clipboard?.writeText(content).catch(() => {});
    setCopied(true);
    toast({ msg: "Paste copied", kind: "ok" });
    setTimeout(() => setCopied(false), 1800);
  };

  const formatDef = FORMATS.find((f) => f.v === settings.format) || FORMATS[0];
  const FormatIcon = formatDef.icon;
  const lines = content.split("\n");

  const pasteKey = React.useMemo(
    () => base64UrlToBytes(pasteData.key),
    [pasteData.key],
  );

  return (
    <div className="view-shell">
      <div className="view-bar">
        <span className="view-id">
          paste/<strong>{pasteData.id}</strong>
        </span>
        <span className="badge">
          <FormatIcon size={11} /> {formatDef.l}
          {settings.format === "code" ? ` · ${settings.language}` : ""}
        </span>
        <span className="badge badge-accent">
          <span
            className="dot dot-pulse"
            style={{ background: "var(--accent)" }}
          ></span>{" "}
          Decrypted in browser
        </span>
        <span className={"countdown" + (isExpired ? " countdown-expired" : "")}>
          <IconClock size={12} />
          <span className="countdown-num">{countdown}</span>
        </span>
        {settings.burn && (
          <span className="badge badge-burn">
            <IconFlame size={11} /> 1-time read · destroyed
          </span>
        )}
        {settings.discussion && (
          <span className="badge">
            <IconMessage size={11} /> Discussion on
          </span>
        )}

        <span style={{ flex: 1 }}></span>

        <button className="btn btn-outline btn-sm" onClick={copyContent}>
          {copied ? (
            <>
              <IconCheck size={12} /> Copied
            </>
          ) : (
            <>
              <IconCopy size={12} /> Copy paste
            </>
          )}
        </button>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(pasteData.url).catch(() => {});
            toast({ msg: "URL copied", kind: "ok" });
          }}
        >
          <IconShare size={12} /> Share URL
        </button>
        <button className="btn btn-ghost btn-sm">
          <IconAlert size={12} /> Report
        </button>
      </div>

      <div className="view-content-wrap">
        {isExpired && <ExpiredBanner />}

        <div className={"viewer-card" + (fullscreen ? " is-fullscreen" : "")}>
          <div className="viewer-head">
            <span
              className="mono"
              style={{ fontSize: 12, color: "var(--fg-2)" }}
            >
              {settings.format === "code"
                ? `untitled.${langExt(settings.language)}`
                : "paste.txt"}
            </span>
            <span
              className="muted mono"
              style={{ fontSize: 11 }}
            >
              · {lines.length} lines ·{" "}
              {new TextEncoder().encode(content).length.toLocaleString()} bytes
            </span>
            <div className="viewer-head-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setFullscreen((v) => !v)}
                title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {fullscreen ? <IconMinimize size={12} /> : <IconMaximize size={12} />}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={copyContent}
                title="Copy"
              >
                <IconCopy size={12} />
              </button>
              <button className="btn btn-ghost btn-sm" title="More">
                <IconMore size={12} />
              </button>
            </div>
          </div>
          {attachment && <AttachmentBlock attachment={attachment} />}

          {(content || !attachment) && (
            settings.format === "md" ? (
              <MarkdownView source={content} />
            ) : (
              <div className="viewer-body">
                <CodeEditor
                  className="ulak-cm-host"
                  value={content}
                  language={viewerLanguage(settings)}
                  readOnly
                />
              </div>
            )
          )}
        </div>

        {settings.discussion && (
          <CommentThread
            pasteId={pasteData.id}
            pasteKey={pasteKey}
            password={settings.password}
            isExpired={isExpired}
            onComment={onComment}
          />
        )}
      </div>
    </div>
  );
}

