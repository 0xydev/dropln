import * as React from "react";
import { IconAlert, IconCheck, IconFlame } from "./icons";

// Truncate utility
export const trunc = (str: string, n: number) =>
  str.length > n ? str.slice(0, n) + "…" : str;

// Detect mac for ⌘ vs Ctrl
export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

// ─── Toast ────────────────────────────────────────────────────────────────

type ToastKind = "ok" | "warn" | "burn";
export type Toast = { msg: string; kind?: ToastKind; duration?: number };
type ToastWithId = Toast & { id: string };

const ToastCtx = React.createContext<((t: Toast) => void) | null>(null);

// Cap simultaneously visible toasts so a burst of errors / "URL copied" /
// "comment posted" doesn't end up filling the screen.
const MAX_VISIBLE_TOASTS = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastWithId[]>([]);
  const show = React.useCallback((toast: Toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { ...toast, id }].slice(-MAX_VISIBLE_TOASTS));
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      toast.duration || 2400,
    );
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              "toast " +
              (t.kind === "burn"
                ? "toast-burn"
                : t.kind === "warn"
                  ? "toast-warn"
                  : "")
            }
          >
            <span className="toast-icon">
              {t.kind === "burn" ? (
                <IconFlame size={14} />
              ) : t.kind === "warn" ? (
                <IconAlert size={14} />
              ) : (
                <IconCheck size={14} />
              )}
            </span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
};

// ─── Brand ────────────────────────────────────────────────────────────────

export type LogomarkVariant = "wordmark" | "lock" | "envelope" | "bracket";

export function BrandGlyph({ variant }: { variant: LogomarkVariant }) {
  if (variant === "lock") {
    return (
      <span className="brand-glyph">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2.5" y="7" width="11" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 7V5a3 3 0 1 1 6 0v2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="10.5" r="1" fill="currentColor" />
        </svg>
      </span>
    );
  }
  if (variant === "envelope") {
    return (
      <span className="brand-glyph">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2 5l6 4 6-4" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="9" r="1.5" fill="var(--bg-1)" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </span>
    );
  }
  if (variant === "bracket") {
    return (
      <span className="brand-glyph">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M5 3L2 8l3 5M11 3l3 5-3 5" stroke="currentColor" strokeWidth="1.5" />
          <rect x="6.5" y="6" width="3" height="4" rx="0.5" fill="currentColor" />
        </svg>
      </span>
    );
  }
  return null;
}

export function Brand({
  variant = "lock",
  onClick,
}: {
  variant?: LogomarkVariant;
  onClick?: () => void;
}) {
  return (
    <a
      className="brand"
      href="/"
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
    >
      {variant !== "wordmark" && <BrandGlyph variant={variant} />}
      <span>
        ulakb<span className="brand-dot">.</span>in
      </span>
    </a>
  );
}

// ─── Identicon ────────────────────────────────────────────────────────────
// Deterministic 5x5 monochrome from a string seed (mirrored).

export function Identicon({ seed = "anon" }: { seed?: string }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const cells: { x: number; y: number; on: boolean }[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const bit = (h >> ((y * 3 + x) % 30)) & 1;
      cells.push({ y, x, on: !!bit });
    }
  }
  const grid = Array.from({ length: 25 }, () => 0);
  cells.forEach(({ x, y, on }) => {
    grid[y * 5 + x] = on ? 1 : 0;
    grid[y * 5 + (4 - x)] = on ? 1 : 0;
  });
  const opacity = 0.3 + ((h >> 4) & 0xff) / 256 * 0.6;
  return (
    <div className="identicon" aria-hidden="true">
      {grid.map((on, i) => (
        <i
          key={i}
          style={{
            background: on ? `rgba(180, 180, 190, ${opacity})` : "transparent",
          }}
        />
      ))}
    </div>
  );
}

// ─── QR code ─────────────────────────────────────────────────────────────
// Real QR via the qrcode lib. Renders into a canvas so a phone camera can
// actually scan and open the paste URL. Error correction level "M" (15%
// recovery) is the comfortable middle for medium-density URLs like ours.

import QR from "qrcode";

export function QRCode({ text, size = 132 }: { text: string; size?: number }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void QR.toCanvas(canvas, text, {
      errorCorrectionLevel: "M",
      width: size,
      margin: 1,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    }).catch((err) => {
      console.error("qrcode render failed", err);
    });
  }, [text, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: "var(--r-sm)" }}
      aria-label="QR code for paste URL"
    />
  );
}

// ─── Keyboard ─────────────────────────────────────────────────────────────

export function useKeyboard(handler: (e: KeyboardEvent) => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => handler(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler]);
}
