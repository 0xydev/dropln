import * as React from "react";
import {
  IconAlert,
  IconClock,
  IconCopy,
  IconExternal,
  IconFlame,
  IconHash,
  IconPlus,
  IconShieldCheck,
  IconTrash,
} from "./icons";
import { useToast } from "./primitives";
import { ApiError, deletePaste } from "../api";
import {
  clearLocalHistory,
  listLocalHistory,
  removeLocalHistory,
  type LocalHistoryEntry,
} from "../lib/local-history";

function relativeAge(unixSec: number): string {
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function expiryLabel(unixSec: number | null): string {
  if (unixSec == null) return "never";
  const ms = unixSec * 1000 - Date.now();
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

type Props = {
  onCreate: () => void;
  onOpen: (entry: LocalHistoryEntry) => void;
};

export function HistoryPage({ onCreate, onOpen }: Props) {
  const [entries, setEntries] = React.useState<LocalHistoryEntry[]>(() =>
    listLocalHistory(),
  );
  const [, setTick] = React.useState(0);
  const toast = useToast();

  // Re-tick every 30s so "expires in 2m" decays without a full reload.
  React.useEffect(() => {
    const i = setInterval(() => {
      setEntries(listLocalHistory());
      setTick((t) => t + 1);
    }, 30 * 1000);
    return () => clearInterval(i);
  }, []);

  const onDelete = async (e: LocalHistoryEntry) => {
    if (!window.confirm(`Delete paste ${e.id}? This cannot be undone.`)) return;
    try {
      // Use the entry's stored server (which may differ from current origin).
      // deletePaste talks to API_BASE = "/api/v1" relative to current origin,
      // so for a pure-local-history page on the same server this just works.
      // Cross-origin entries fall back to a manual notice.
      if (e.server && e.server !== window.location.origin) {
        toast({
          msg: "Cross-origin paste — open the original site to delete",
          kind: "warn",
        });
        return;
      }
      await deletePaste(e.id, e.deleteToken);
      removeLocalHistory(e.id);
      setEntries(listLocalHistory());
      toast({ msg: "Paste deleted", kind: "ok" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // already gone — drop from local history anyway
        removeLocalHistory(e.id);
        setEntries(listLocalHistory());
        toast({ msg: "Paste already deleted on the server", kind: "warn" });
      } else {
        toast({ msg: "Couldn't delete paste", kind: "warn" });
      }
    }
  };

  const onClear = () => {
    if (!window.confirm("Clear all local history? This won't delete pastes from the server.")) return;
    clearLocalHistory();
    setEntries([]);
  };

  const onCopy = (url: string) => {
    navigator.clipboard?.writeText(url).catch(() => {});
    toast({ msg: "URL copied", kind: "ok" });
  };

  return (
    <div className="history-stage">
      <div className="history-card">
        <div className="history-head">
          <div>
            <h2>Your pastes</h2>
            <p>
              <IconShieldCheck size={11} /> Stored only in this browser. Delete
              tokens live alongside your other browser secrets.
            </p>
          </div>
          <div className="history-head-actions">
            <button className="btn btn-outline" onClick={onCreate}>
              <IconPlus size={13} /> New paste
            </button>
            {entries.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={onClear}>
                Clear all
              </button>
            )}
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="history-empty">
            <IconHash size={20} />
            <strong>No pastes yet from this browser.</strong>
            <span>Create one — it'll show up here so you can re-share or revoke later.</span>
            <button className="btn btn-primary" onClick={onCreate} style={{ marginTop: 14 }}>
              <IconPlus size={13} /> Create paste
            </button>
          </div>
        ) : (
          <div className="history-table">
            <div className="history-row history-row-head">
              <span>ID</span>
              <span>Created</span>
              <span>Expires</span>
              <span>Flags</span>
              <span style={{ textAlign: "right" }}>Actions</span>
            </div>
            {entries.map((e) => {
              const expiresIn = expiryLabel(e.expiresAt);
              const isExpired = expiresIn === "expired";
              return (
                <div
                  key={e.id}
                  className={"history-row" + (isExpired ? " history-row-expired" : "")}
                >
                  <span className="mono history-id" title={e.id}>
                    {e.id}
                    {e.note && <em className="history-note">{e.note}</em>}
                  </span>
                  <span className="muted mono">{relativeAge(e.createdAt)}</span>
                  <span
                    className="mono"
                    style={{
                      color: isExpired ? "var(--burn)" : undefined,
                      fontWeight: isExpired ? 600 : undefined,
                    }}
                  >
                    <IconClock size={11} /> {expiresIn}
                  </span>
                  <span className="history-flags">
                    {e.burn && (
                      <span className="badge badge-burn" title="Burn after read">
                        <IconFlame size={10} /> burn
                      </span>
                    )}
                  </span>
                  <span className="history-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => onCopy(e.url)}
                      title="Copy URL"
                    >
                      <IconCopy size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => onOpen(e)}
                      title="Open paste"
                      disabled={isExpired}
                    >
                      <IconExternal size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => onDelete(e)}
                      title="Delete"
                      disabled={isExpired}
                    >
                      <IconTrash size={12} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="history-foot">
          <IconAlert size={11} />
          <span>
            Anyone with access to this browser profile can see paste IDs and
            revoke them. Use a separate browser profile or private window for
            sensitive sharing.
          </span>
        </div>
      </div>
    </div>
  );
}
