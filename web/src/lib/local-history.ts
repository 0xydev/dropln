// Browser-side counterpart of the CLI's $XDG_CONFIG_HOME/dropln/history.json.
// Tracks pastes the user created from THIS browser so we can offer a
// "Your pastes" page (and command palette recents) without a server-side
// account.
//
// Stored in localStorage under "dropln.history". Contains delete tokens,
// so it sits alongside other browser secrets (autofill, session cookies).
// Anyone with access to the browser can see + revoke past pastes.

const STORAGE_KEY = "dropln.history";

export type LocalHistoryEntry = {
  id: string;
  /** base64-url key, no leading "-" */
  key: string;
  /** Full share URL — origin + /p/id#-?key */
  url: string;
  deleteToken: string;
  /** Server origin the paste was created on. */
  server: string;
  /** Unix seconds. null when "never" expires. */
  expiresAt: number | null;
  /** Unix seconds. */
  createdAt: number;
  burn: boolean;
  note?: string;
};

function readRaw(): LocalHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeRaw(entries: LocalHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // private browsing / quota — silently ignore; we never block the UI on
    // history persistence
  }
}

function pruneExpired(entries: LocalHistoryEntry[]): LocalHistoryEntry[] {
  const now = Math.floor(Date.now() / 1000);
  return entries.filter((e) => e.expiresAt == null || e.expiresAt > now);
}

export function listLocalHistory(): LocalHistoryEntry[] {
  const kept = pruneExpired(readRaw());
  // Persist the prune so the file doesn't grow forever.
  if (kept.length !== readRaw().length) writeRaw(kept);
  // Newest first.
  return kept.sort((a, b) => b.createdAt - a.createdAt);
}

export function addLocalHistory(entry: LocalHistoryEntry) {
  const list = pruneExpired(readRaw());
  list.push(entry);
  writeRaw(list);
}

export function removeLocalHistory(id: string) {
  const list = readRaw().filter((e) => e.id !== id);
  writeRaw(list);
}

export function findLocalHistory(id: string): LocalHistoryEntry | undefined {
  return readRaw().find((e) => e.id === id);
}

export function clearLocalHistory() {
  writeRaw([]);
}
