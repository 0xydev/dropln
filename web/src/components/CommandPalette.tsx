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

export function ShortcutsHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  const groups = [
    {
      title: "Editor",
      items: [
        { l: "Create paste", k: [MOD, "↵"] },
        { l: "Toggle burn-after-read", k: [MOD, "B"] },
        { l: "Toggle password", k: [MOD, "P"] },
        { l: "Insert sample", k: [MOD, "I"] },
      ],
    },
    {
      title: "Navigation",
      items: [
        { l: "Command palette", k: [MOD, "K"] },
        { l: "Shortcuts help", k: [MOD, "/"] },
        { l: "Toggle theme", k: [MOD, "Shift", "T"] },
      ],
    },
    {
      title: "Share view",
      items: [
        { l: "Copy URL", k: [MOD, "C"] },
        { l: "Copy paste content", k: [MOD, "Shift", "C"] },
        { l: "Open paste", k: [MOD, "O"] },
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
      <div className="cp-card" style={{ maxWidth: 520 }}>
        <div className="cp-search" style={{ borderBottom: "1px solid var(--line-1)" }}>
          <IconKeyboard size={16} />
          <span style={{ flex: 1, fontSize: 14 }}>Keyboard shortcuts</span>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onClose}
          >
            <IconX size={12} />
          </button>
        </div>
        <div style={{ padding: "8px 6px 12px" }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              <div className="cp-section">{g.title}</div>
              {g.items.map((it, i) => (
                <div key={i} className="cp-item" style={{ cursor: "default" }}>
                  <span style={{ flex: 1 }}>{it.l}</span>
                  <span className="cp-item-shortcut">
                    {it.k.map((k, j) => (
                      <span key={j} className="kbd">
                        {k}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
