// Pure formatting helpers. No JSX, no React.

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}

const LANG_EXT: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  go: "go",
  rust: "rs",
  shell: "sh",
  json: "json",
  yaml: "yml",
  sql: "sql",
  log: "log",
};

export function langExt(l: string): string {
  return LANG_EXT[l] || "txt";
}

// Estimates the POST body size for a given (text, attachment) pair so the
// UI can warn the user before encrypt + transport blows past the server's
// MaxPasteBytes. Includes the base64 inflation that happens twice
// (attachment is stored as a data URL inside the plaintext, then the whole
// ciphertext is base64-encoded for transport).
export function estimateEncryptedSize(textBytes: number, attachmentBytes: number): number {
  // plaintext JSON: paste text + base64(attachment) + data URL prefix + JSON wrap
  const plaintextBytes = textBytes + Math.ceil((attachmentBytes * 4) / 3) + 110;
  // AES-GCM adds a 16-byte auth tag.
  const ciphertextBytes = plaintextBytes + 16;
  // base64-encoded ciphertext on the wire.
  const ctOnWire = Math.ceil((ciphertextBytes * 4) / 3);
  // Outer JSON envelope (v + adata + meta + structural chars).
  return ctOnWire + 360;
}

// Mirrors the Go server's paste.ResolveExpire mapping (internal/paste/expire.go).
export function expiryToMs(v: string): number {
  return (
    {
      "5min": 5 * 60e3,
      "10min": 10 * 60e3,
      "1hour": 60 * 60e3,
      "1day": 24 * 60 * 60e3,
      "1week": 7 * 24 * 60 * 60e3,
      "1month": 30 * 24 * 60 * 60e3,
      "1year": 365 * 24 * 60 * 60e3,
      never: 100 * 365 * 24 * 60 * 60e3,
    }[v] || 60 * 60e3
  );
}
