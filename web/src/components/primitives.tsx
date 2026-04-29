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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastWithId[]>([]);
  const show = React.useCallback((toast: Toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { ...toast, id }]);
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
      href="#"
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

// ─── QR placeholder ───────────────────────────────────────────────────────
// The prototype draws a deterministic pseudo-QR from the input — it's not a
// real QR code, just a visual placeholder. Real QR generation comes when we
// wire actual encryption: at that point we'll swap to a small lib.

export function QRCode({ text, size = 116 }: { text: string; size?: number }) {
  const cells = 25;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rng = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967295;
  };
  const grid: number[] = [];
  for (let i = 0; i < cells * cells; i++) grid.push(rng() > 0.5 ? 1 : 0);
  const finder = (cx: number, cy: number) => {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const ix = (cy + y) * cells + (cx + x);
        const inner =
          y === 0 || y === 6 || x === 0 || x === 6
            ? 1
            : y >= 2 && y <= 4 && x >= 2 && x <= 4
              ? 1
              : 0;
        grid[ix] = inner;
      }
  };
  finder(0, 0);
  finder(cells - 7, 0);
  finder(0, cells - 7);
  const cell = size / cells;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ background: "white" }}
    >
      {grid.map((v, i) =>
        v ? (
          <rect
            key={i}
            x={(i % cells) * cell}
            y={Math.floor(i / cells) * cell}
            width={cell}
            height={cell}
            fill="#0a0a0a"
          />
        ) : null,
      )}
    </svg>
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
