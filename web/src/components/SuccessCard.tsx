import * as React from "react";
import {
  IconCheck,
  IconClock,
  IconCopy,
  IconExternal,
  IconFlame,
  IconKey,
  IconMessage,
  IconPlus,
  IconQr,
  IconShieldCheck,
} from "./icons";
import { QRCode, useKeyboard, useToast } from "./primitives";
import { formatCountdown } from "../lib/format-utils";

export type PasteData = {
  id: string;
  key: string;
  url: string;
  deleteToken: string;
  expiresAt: number;
  createdAt: number;
};

export type PasteSettings = {
  format: "plain" | "code" | "md";
  language: string;
  expiry: string;
  burn: boolean;
  password: string;
  discussion: boolean;
};

type SuccessCardProps = {
  pasteData: PasteData;
  settings: PasteSettings;
  onCreateAnother: () => void;
  onOpenPaste: () => void;
};

export function SuccessCard({
  pasteData,
  onCreateAnother,
  onOpenPaste,
  settings,
}: SuccessCardProps) {
  const [copied, setCopied] = React.useState(false);
  const [showQR, setShowQR] = React.useState(false);
  const [revealedToken, setRevealedToken] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const toast = useToast();

  React.useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const remainingMs = pasteData.expiresAt - now;
  const countdown = formatCountdown(remainingMs);

  const copy = React.useCallback(() => {
    navigator.clipboard?.writeText(pasteData.url).catch(() => {});
    setCopied(true);
    toast({ msg: "URL copied to clipboard", kind: "ok" });
    setTimeout(() => setCopied(false), 1800);
  }, [pasteData.url, toast]);

  // Cmd+C global on success view (only when no text selected)
  useKeyboard(
    React.useCallback(
      (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
          const sel = window.getSelection()?.toString() || "";
          if (!sel) {
            e.preventDefault();
            copy();
          }
        }
      },
      [copy],
    ),
  );

  return (
    <div className="success-stage">
      <div className="success-card">
        <div className="success-check">
          <IconCheck size={18} />
        </div>
        <h2 className="success-title">Encrypted and ready to share</h2>
        <p className="success-sub">
          Your paste lives encrypted on the server. The decryption key is in
          the URL — copy and share it carefully.
        </p>

        <div className="url-row">
          <input
            className="url-text"
            readOnly
            value={pasteData.url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            className={"url-copy" + (copied ? " copied" : "")}
            onClick={copy}
          >
            {copied ? (
              <>
                <IconCheck size={13} /> Copied
              </>
            ) : (
              <>
                <IconCopy size={13} /> Copy
              </>
            )}
          </button>
        </div>

        <div className="success-meta">
          <span className="badge">
            <IconShieldCheck size={11} /> Encrypted
          </span>
          <span className="badge">
            <IconClock size={11} /> Expires in
            <span className="mono" style={{ marginLeft: 4 }}>
              {countdown}
            </span>
          </span>
          {settings.burn && (
            <span className="badge badge-burn">
              <IconFlame size={11} /> 1-time read
            </span>
          )}
          {settings.password && (
            <span className="badge badge-accent">
              <IconKey size={11} /> Password
            </span>
          )}
          {settings.discussion && (
            <span className="badge">
              <IconMessage size={11} /> Discussion
            </span>
          )}
        </div>

        <div className="success-actions">
          <button className="btn btn-primary" onClick={copy}>
            <IconCopy size={13} /> Copy URL
          </button>
          <button className="btn btn-outline" onClick={onOpenPaste}>
            <IconExternal size={13} /> Open paste
          </button>
          <button className="btn btn-outline" onClick={() => setShowQR((v) => !v)}>
            <IconQr size={13} /> {showQR ? "Hide" : "Show"} QR
          </button>
          <button className="btn btn-ghost" onClick={onCreateAnother}>
            <IconPlus size={13} /> Create another
          </button>
        </div>

        {showQR && (
          <div className="qr-toggle">
            <QRCode text={pasteData.url} size={132} />
            <div
              style={{
                fontSize: 12,
                color: "var(--fg-2)",
                lineHeight: 1.6,
                fontFamily: "var(--font-mono)",
              }}
            >
              Scan to open the paste
              <br />
              with the decryption key
              <br />
              embedded in the fragment.
            </div>
          </div>
        )}

        <div className="delete-token-row">
          <span style={{ marginRight: 6 }}>Need to revoke this paste?</span>
          {!revealedToken ? (
            <a
              className="delete-token-link"
              onClick={(e) => {
                e.preventDefault();
                setRevealedToken(true);
              }}
              href="#"
            >
              Reveal delete token
            </a>
          ) : (
            <div className="delete-token-revealed">
              <span>{pasteData.deleteToken}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(pasteData.deleteToken)
                    .catch(() => {});
                  toast({ msg: "Delete token copied", kind: "ok" });
                }}
              >
                <IconCopy size={11} /> Copy
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
