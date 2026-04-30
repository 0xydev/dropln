// HTTP client for the dropln Go backend.
// In dev, Vite proxies /api/* to :8080. In prod, the Go binary serves both.

import type { CommentEnvelope, PasteEnvelope } from "../crypto/format";

const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(`${status} ${code}${detail ? `: ${detail}` : ""}`);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const resp = await fetch(API_BASE + path, init);

  if (resp.status === 204) {
    return undefined as T;
  }

  const text = await resp.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // non-JSON body, leave as undefined
    }
  }

  if (!resp.ok) {
    const err = parsed as { error?: string; detail?: string } | undefined;
    throw new ApiError(resp.status, err?.error || resp.statusText, err?.detail);
  }
  return parsed as T;
}

// ─── server info ─────────────────────────────────────────────────────────

export type ServerInfo = {
  version: string;
  max_paste_bytes: number;
  expire_options: string[];
  formatter_options: string[];
};

export const getInfo = (): Promise<ServerInfo> => request("GET", "/info");

// ─── pastes ──────────────────────────────────────────────────────────────

export type CreatePasteResponse = {
  id: string;
  delete_token: string;
};

export const createPaste = (envelope: PasteEnvelope): Promise<CreatePasteResponse> =>
  request("POST", "/paste", envelope);

export type ReadPasteResult = {
  envelope: PasteEnvelope;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds, or null when the paste never expires. */
  expiresAt: number | null;
};

export async function readPaste(id: string): Promise<ReadPasteResult> {
  const resp = await fetch(`${API_BASE}/paste/${encodeURIComponent(id)}`);
  const text = await resp.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // ignored — fall through to error path
    }
  }
  if (!resp.ok) {
    const err = parsed as { error?: string; detail?: string } | undefined;
    throw new ApiError(resp.status, err?.error || resp.statusText, err?.detail);
  }
  const created = parseInt(resp.headers.get("X-Paste-Created-At") || "0", 10);
  const expiresHeader = resp.headers.get("X-Paste-Expires-At");
  return {
    envelope: parsed as PasteEnvelope,
    createdAt: Number.isFinite(created) ? created : 0,
    expiresAt: expiresHeader ? parseInt(expiresHeader, 10) : null,
  };
}

export const deletePaste = (id: string, token: string): Promise<void> =>
  request(
    "DELETE",
    `/paste/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
  );

// ─── comments ────────────────────────────────────────────────────────────

export type CreateCommentResponse = { id: string };

export type CommentRecord = CommentEnvelope & {
  id: string;
  created: number;
};

export const createComment = (
  pasteId: string,
  envelope: CommentEnvelope,
): Promise<CreateCommentResponse> =>
  request("POST", `/paste/${encodeURIComponent(pasteId)}/comment`, envelope);

export const listComments = (pasteId: string): Promise<CommentRecord[]> =>
  request("GET", `/paste/${encodeURIComponent(pasteId)}/comments`);
