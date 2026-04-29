// File / data-URL helpers used by the attachment flow.

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export type DataUrlInfo = {
  mime: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  isPdf: boolean;
  isText: boolean;
  /** Approximate decoded byte size — base64 inflates payloads ~33%. */
  approxBytes: number;
};

const TEXTY_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/x-shellscript",
  "application/sql",
  "application/toml",
]);

export function inspectDataUrl(dataUrl: string): DataUrlInfo {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  const mime = m?.[1] || "application/octet-stream";
  const b64Length = m ? m[2].length : 0;
  const isText = mime.startsWith("text/") || TEXTY_MIMES.has(mime);
  return {
    mime,
    isImage: mime.startsWith("image/") && mime !== "image/svg+xml", // svg in <img> can host scripts; treat as opaque blob
    isVideo: mime.startsWith("video/"),
    isAudio: mime.startsWith("audio/"),
    isPdf: mime === "application/pdf",
    isText,
    approxBytes: Math.floor((b64Length * 3) / 4),
  };
}

/** Decode base64 of a data URL into a UTF-8 string (best-effort). */
export function textFromDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf("base64,");
  if (i < 0) return "";
  try {
    const bin = atob(dataUrl.slice(i + 7));
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

/**
 * Map a filename's extension to a CodeMirror language id, falling back to
 * MIME hints. Returns undefined for "no syntax" (plain mono).
 */
export function languageForAttachment(filename: string, mime: string): string | undefined {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const byExt: Record<string, string> = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", pyi: "python",
    go: "go",
    rs: "rust",
    sql: "sql",
    yaml: "yaml", yml: "yaml",
    json: "json",
    md: "markdown", markdown: "markdown",
  };
  if (byExt[ext]) return byExt[ext];
  if (mime.includes("javascript") || mime.includes("typescript")) return "javascript";
  if (mime.includes("json")) return "json";
  if (mime.includes("yaml")) return "yaml";
  if (mime.includes("markdown")) return "markdown";
  return undefined;
}

/** Programmatic download of a data URL with a filename. */
export function downloadDataUrl(name: string, dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
