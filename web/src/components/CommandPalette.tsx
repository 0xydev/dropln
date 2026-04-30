import * as React from "react";
import { IconKeyboard, IconSearch, IconX } from "./icons";
import { MOD } from "./primitives";

export type PaletteAction = {
  id: string;
  group: "actions" | "recent" | "settings";
  icon: React.ReactNode;
  label: string;
  hint?: string;
  kbd?: string[];
  onSelect: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
};

export function CommandPalette({ open, onClose, actions }: Props) {
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const groups = [
    { title: "Quick actions", items: actions.filter((a) => a.group === "actions") },
    { title: "Recent pastes", items: actions.filter((a) => a.group === "recent") },
    { title: "Settings", items: actions.filter((a) => a.group === "settings") },
  ];

  const filtered = groups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          !q ||
          (i.label + " " + (i.hint || "")).toLowerCase().includes(q.toLowerCase()),
      ),
    }))
    .filter((g) => g.items.length > 0);

  const flat = filtered.flatMap((g) => g.items);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[active]?.onSelect();
      onClose();
    }
  };

  if (!open) return null;
  return (
    <div
      className="cp-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cp-card" role="dialog">
        <div className="cp-search">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            value={q}
            placeholder="Type a command or search…"
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={handleKey}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cp-results">
          {filtered.length === 0 && (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--fg-2)",
                fontSize: 13,
              }}
            >
              No matches for <span className="mono">"{q}"</span>
            </div>
          )}
          {filtered.map((g, gi) => (
            <div key={gi}>
              <div className="cp-section">{g.title}</div>
              {g.items.map((it) => {
                const idx = flat.indexOf(it);
                return (
                  <div
                    key={it.id}
                    className={"cp-item" + (idx === active ? " active" : "")}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => {
                      it.onSelect();
                      onClose();
                    }}
                  >
                    <span className="cp-item-icon">{it.icon}</span>
                    <span style={{ flex: 1 }}>
                      {it.label}
                      {it.hint && (
                        <span
                          style={{
                            color: "var(--fg-3)",
                            marginLeft: 8,
                            fontSize: 12,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {it.hint}
                        </span>
                      )}
                    </span>
                    {it.kbd && (
                      <span className="cp-item-shortcut">
                        {it.kbd.map((k, i) => (
                          <span key={i} className="kbd">
                            {k}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cp-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> navigate
          </span>
          <span>
            <span className="kbd">↵</span> select
          </span>
          <span>
            <span className="kbd">esc</span> close
          </span>
          <span style={{ marginLeft: "auto", color: "var(--fg-3)" }}>ulakb.in</span>
        </div>
      </div>
    </div>
  );
}

// Refined shortcut help. Lists only commands that are actually wired
// (no aspirational entries) and groups them by *what surface they act on*
// so users can scan to "I'm in the editor — what can I do here?".

import {
  IconCode,
  IconLock,
  IconSettings,
} from "./icons";

type Shortcut = { label: string; keys: string[]; hint?: string };
type ShortcutGroup = { title: string; icon: React.ReactNode; items: Shortcut[] };

export function ShortcutsHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  const groups: ShortcutGroup[] = [
    {
      title: "Anywhere",
      icon: <IconKeyboard size={13} />,
      items: [
        { label: "Command palette", keys: [MOD, "K"] },
        { label: "Show this dialog", keys: [MOD, "/"] },
        { label: "Toggle theme", keys: [MOD, "Shift", "T"] },
        { label: "Dismiss / close", keys: ["Esc"] },
      ],
    },
    {
      title: "Editor",
      icon: <IconCode size={13} />,
      items: [
        { label: "Create encrypted paste", keys: [MOD, "↵"] },
        { label: "Find / replace", keys: [MOD, "F"] },
        { label: "Comment toggle (per-language)", keys: [MOD, "/"] },
        { label: "Undo / redo", keys: [MOD, "Z"], hint: "+ Shift to redo" },
        { label: "Multi-cursor: select next match", keys: [MOD, "D"] },
      ],
    },
    {
      title: "View",
      icon: <IconLock size={13} />,
      items: [
        { label: "Copy URL", keys: [MOD, "C"], hint: "when no text selected" },
        { label: "Toggle fullscreen", keys: ["Esc"], hint: "to exit" },
      ],
    },
    {
      title: "Comments",
      icon: <IconSettings size={13} />,
      items: [
        { label: "Post comment", keys: [MOD, "↵"], hint: "from composer" },
      ],
    },
  ];

  return (
    <div
      className="cp-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cp-card shortcuts-card" style={{ maxWidth: 560 }}>
        <div className="cp-search shortcuts-head">
          <IconKeyboard size={15} />
          <span>Keyboard shortcuts</span>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={12} />
          </button>
        </div>
        <div className="shortcuts-body">
          {groups.map((g, gi) => (
            <div className="shortcuts-group" key={gi}>
              <div className="shortcuts-group-head">
                <span className="shortcuts-group-icon">{g.icon}</span>
                {g.title}
              </div>
              <div className="shortcuts-list">
                {g.items.map((it, i) => (
                  <div className="shortcuts-row" key={i}>
                    <span className="shortcuts-label">
                      {it.label}
                      {it.hint && <em className="shortcuts-hint">{it.hint}</em>}
                    </span>
                    <span className="shortcuts-keys">
                      {it.keys.map((k, j) => (
                        <span key={j} className="kbd">
                          {k}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="shortcuts-foot">
          Most editor shortcuts are CodeMirror 6 standard — they work the same
          as in VS Code.
        </div>
      </div>
    </div>
  );
}
