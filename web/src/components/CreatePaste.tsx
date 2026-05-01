import * as React from "react";
import {
  IconAlert,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconEye,
  IconEyeOff,
  IconFile,
  IconFlame,
  IconHash,
  IconKey,
  IconLock,
  IconMaximize,
  IconMessage,
  IconMinimize,
  IconPaperclip,
  IconSettings,
  IconShieldCheck,
  IconUpload,
  IconX,
} from "./icons";
import { MOD, useToast } from "./primitives";
import { EXPIRY_OPTIONS, FORMATS, LANGS } from "../lib/options";
import { SAMPLE_CONTENT } from "../lib/samples";
import { estimateEncryptedSize, formatBytes } from "../lib/format-utils";
import type { PasteSettings } from "./SuccessCard";
import { CodeEditor } from "./CodeEditor";
import { useIsMobile } from "../lib/use-media-query";

function editorLanguage(s: PasteSettings): string | undefined {
  if (s.format === "md") return "markdown";
  if (s.format === "code") return s.language;
  return undefined;
}

// ─── Local primitives ────────────────────────────────────────────────────

function Dropdown({
  trigger,
  children,
  align = "left",
  width = 180,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <span onClick={() => setOpen((v) => !v)} style={{ display: "inline-flex" }}>
        {trigger}
      </span>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            [align]: 0,
            zIndex: 50,
            background: "var(--bg-1)",
            border: "1px solid var(--line-2)",
            borderRadius: "var(--r-md)",
            boxShadow: "var(--shadow-3)",
            minWidth: width,
            padding: 4,
            animation: "cpIn 140ms ease-out",
          }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </span>
  );
}

function MenuItem({
  icon,
  label,
  kbd,
  onClick,
  active,
}: {
  icon?: React.ReactNode;
  label: string;
  kbd?: string[];
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div className={"cp-item" + (active ? " active" : "")} onClick={onClick}>
      {icon && <span className="cp-item-icon">{icon}</span>}
      <span>{label}</span>
      {kbd && (
        <span className="cp-item-shortcut">
          {kbd.map((k, i) => (
            <span key={i} className="kbd">
              {k}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// ─── CreatePaste ─────────────────────────────────────────────────────────

export type AttachedFile = { name: string; size: number; file: File };

type CreatePasteProps = {
  onCreated: () => Promise<void> | void;
  settings: PasteSettings;
  setSettings: (s: PasteSettings) => void;
  content: string;
  setContent: (c: string) => void;
  attachedFile: AttachedFile | null;
  setAttachedFile: (f: AttachedFile | null) => void;
  /** Server's accepted POST body size limit (bytes). */
  maxPasteBytes: number;
  /** First-time visit + empty editor → show keyboard hint ghost. */
  showOnboarding?: boolean;
};

export function CreatePaste({
  onCreated,
  settings,
  setSettings,
  content,
  setContent,
  attachedFile,
  setAttachedFile,
  maxPasteBytes,
  showOnboarding,
}: CreatePasteProps) {
  const isMobile = useIsMobile();
  // Drawer initial state: open on desktop (it's the right column and
  // expected to be visible), closed on mobile (it's a bottom sheet that
  // should only appear when the user taps the settings button).
  const [drawerOpen, setDrawerOpen] = React.useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia("(max-width: 768px)").matches;
  });
  const [showPwField, setShowPwField] = React.useState(false);
  const [showPw, setShowPw] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [encrypting, setEncrypting] = React.useState(false);
  const [encryptProgress, setEncryptProgress] = React.useState(0);
  const [fullscreen, setFullscreen] = React.useState(false);
  const toast = useToast();

  // When the user crosses the mobile breakpoint (rotate, browser resize),
  // re-align the drawer state to the convention for the new viewport so
  // they don't end up with a stuck-open sheet on a fresh desktop layout.
  React.useEffect(() => {
    setDrawerOpen(!isMobile);
  }, [isMobile]);

  // Esc exits fullscreen. We add a local listener (instead of routing through
  // App's keyboard hook) so the handler is scoped to this component's lifetime.
  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const textBytes = new TextEncoder().encode(content).length;
  const attachmentBytes = attachedFile?.size || 0;
  const estimatedBytes = estimateEncryptedSize(textBytes, attachmentBytes);
  const pct = Math.min(100, (estimatedBytes / maxPasteBytes) * 100);
  const meterClass = pct > 90 ? "danger" : pct > 70 ? "warn" : "";
  const overLimit = estimatedBytes > maxPasteBytes;

  const lineCount = content === "" ? 1 : content.split("\n").length;

  const expiryLabel =
    EXPIRY_OPTIONS.find((o) => o.v === settings.expiry)?.l || settings.expiry;
  const formatDef = FORMATS.find((f) => f.v === settings.format) || FORMATS[0];
  const FormatIcon = formatDef.icon;

  const handleCreate = async () => {
    if (!content.trim() && !attachedFile) {
      toast({ msg: "Nothing to encrypt yet", kind: "warn" });
      return;
    }
    if (overLimit) {
      toast({
        msg: `Encrypted size (~${formatBytes(estimatedBytes)}) exceeds limit (${formatBytes(maxPasteBytes)})`,
        kind: "warn",
      });
      return;
    }
    setEncrypting(true);
    setEncryptProgress(0);
    // Smooth out the progress bar visual while the real encrypt+POST runs.
    let p = 0;
    const tick = setInterval(() => {
      p = Math.min(95, p + Math.random() * 18 + 6);
      setEncryptProgress(p);
    }, 60);
    try {
      await onCreated();
    } finally {
      clearInterval(tick);
      setEncryptProgress(100);
      setEncrypting(false);
    }
  };

  const handleAttach = (f: File) => {
    setAttachedFile({ name: f.name, size: f.size, file: f });
    const projected = estimateEncryptedSize(textBytes, f.size);
    if (projected > maxPasteBytes) {
      toast({
        msg: `Heads up: encrypted ~${formatBytes(projected)} would exceed limit (${formatBytes(maxPasteBytes)})`,
        kind: "warn",
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleAttach(f);
  };

  const insertSample = (k: string) => setContent(SAMPLE_CONTENT[k]);

  return (
    <div
      className={
        "editor-shell" +
        (drawerOpen ? "" : " drawer-collapsed") +
        (fullscreen ? " is-fullscreen" : "")
      }
    >
      <div className="editor-pane">
        {/* Toolbar */}
        <div className="editor-toolbar">
          <Dropdown
            trigger={
              <button className="btn btn-outline btn-sm">
                <FormatIcon size={13} /> {formatDef.l} <IconChevronDown size={12} />
              </button>
            }
          >
            {FORMATS.map((f) => {
              const Icon = f.icon;
              return (
                <MenuItem
                  key={f.v}
                  icon={<Icon size={13} />}
                  label={f.l}
                  active={f.v === settings.format}
                  onClick={() => setSettings({ ...settings, format: f.v })}
                />
              );
            })}
          </Dropdown>

          {settings.format === "code" && (
            <Dropdown
              trigger={
                <button className="btn btn-outline btn-sm">
                  <span className="mono" style={{ fontSize: 12 }}>
                    {settings.language}
                  </span>{" "}
                  <IconChevronDown size={12} />
                </button>
              }
            >
              {LANGS.map((l) => (
                <MenuItem
                  key={l}
                  label={l}
                  active={l === settings.language}
                  onClick={() => setSettings({ ...settings, language: l })}
                />
              ))}
            </Dropdown>
          )}

          <span className="editor-toolbar-divider"></span>

          <Dropdown
            trigger={
              <button className="btn btn-outline btn-sm">
                <IconClock size={13} /> {expiryLabel} <IconChevronDown size={12} />
              </button>
            }
            width={160}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <MenuItem
                key={o.v}
                label={o.l}
                active={o.v === settings.expiry}
                onClick={() => setSettings({ ...settings, expiry: o.v })}
              />
            ))}
          </Dropdown>

          <button
            className={"btn btn-sm " + (settings.burn ? "" : "btn-outline")}
            onClick={() => setSettings({ ...settings, burn: !settings.burn })}
            style={
              settings.burn
                ? {
                    background: "color-mix(in oklab, var(--burn) 14%, transparent)",
                    color: "var(--burn)",
                    borderColor: "color-mix(in oklab, var(--burn) 32%, transparent)",
                    border: "1px solid",
                  }
                : {}
            }
          >
            <IconFlame size={13} /> Burn after read
          </button>

          <button
            className={"btn btn-sm " + (settings.password ? "" : "btn-outline")}
            onClick={() => {
              if (settings.password) {
                setSettings({ ...settings, password: "" });
                setShowPwField(false);
              } else {
                setShowPwField(true);
              }
            }}
            style={
              settings.password
                ? {
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    borderColor: "var(--accent-line)",
                    border: "1px solid",
                  }
                : {}
            }
          >
            <IconKey size={13} /> Password
          </button>

          {showPwField && (
            <div className="inline-expand">
              <IconKey size={12} />
              <input
                className="input-mono"
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--fg-0)",
                  width: 140,
                  fontSize: 12,
                }}
                type={showPw ? "text" : "password"}
                placeholder="Set password…"
                value={settings.password}
                autoFocus
                onChange={(e) => setSettings({ ...settings, password: e.target.value })}
                onBlur={() => {
                  if (!settings.password) setShowPwField(false);
                }}
              />
              <button
                className="btn-icon btn btn-ghost"
                style={{ width: 22, height: 22 }}
                onClick={() => setShowPw((v) => !v)}
              >
                {showPw ? <IconEyeOff size={12} /> : <IconEye size={12} />}
              </button>
            </div>
          )}

          <button
            className={"btn btn-sm " + (settings.discussion ? "" : "btn-outline")}
            onClick={() => setSettings({ ...settings, discussion: !settings.discussion })}
            style={
              settings.discussion
                ? {
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    borderColor: "var(--accent-line)",
                    border: "1px solid",
                  }
                : {}
            }
          >
            <IconMessage size={13} /> Discussion
          </button>

          <span className="nav-spacer"></span>

          <Dropdown
            align="right"
            trigger={
              <button className="btn btn-ghost btn-sm" title="Insert sample">
                <IconHash size={13} /> Sample <IconChevronDown size={12} />
              </button>
            }
          >
            <MenuItem label="Stack trace" onClick={() => insertSample("log")} />
            <MenuItem label="TypeScript snippet" onClick={() => insertSample("ts")} />
            <MenuItem label=".env config" onClick={() => insertSample("env")} />
          </Dropdown>

          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
          </button>
        </div>

        {/* Editor */}
        <div
          className="cm-shell"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <CodeEditor
            className="dropln-cm-host"
            value={content}
            onChange={setContent}
            language={editorLanguage(settings)}
            onSubmit={handleCreate}
          />

          {dragOver && (
            <div className="dropzone">
              <IconUpload size={28} />
              <span>Drop file to attach &amp; encrypt</span>
            </div>
          )}

          {encrypting && (
            <div className="encrypt-overlay">
              <div className="lock-pulse">
                <IconLock size={20} />
              </div>
              <div className="mono" style={{ color: "var(--fg-1)", fontSize: 13 }}>
                Encrypting <span style={{ color: "var(--accent)" }}>AES-256-GCM</span>…
              </div>
              <div className="encrypt-progress">
                <div
                  className="encrypt-progress-fill"
                  style={{ width: `${encryptProgress}%` }}
                ></div>
              </div>
              <div className="mono" style={{ color: "var(--fg-3)", fontSize: 11 }}>
                PBKDF2 · 100,000 iterations
              </div>
            </div>
          )}

          {showOnboarding && !encrypting && !dragOver && (
            <div className="onboarding-ghost" aria-hidden="true">
              <span className="kbd">{MOD}</span>
              <span className="kbd">↵</span>
              <span>to encrypt &amp; share</span>
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="action-bar">
          {/*
            Mobile-only settings button. On desktop the drawer is always
            in view (right column of editor-shell), so this is hidden via
            CSS (.mobile-settings-btn { display: none } until 768px). On
            phones it toggles the same `drawerOpen` state, which the
            stylesheet reinterprets as "slide bottom sheet up / down".
          */}
          <button
            className="mobile-settings-btn"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Open settings"
          >
            <IconSettings size={18} />
          </button>

          <button
            className="btn btn-outline"
            onClick={() => {
              const inp = document.createElement("input");
              inp.type = "file";
              inp.onchange = (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) handleAttach(f);
              };
              inp.click();
            }}
          >
            <IconPaperclip size={13} /> Attach file
          </button>

          {attachedFile && (
            <div className="file-chip">
              <IconFile size={12} />
              <strong>{attachedFile.name}</strong>
              <span className="muted">·</span>
              <span>{formatBytes(attachedFile.size)}</span>
              <button
                className="file-chip-x"
                onClick={() => setAttachedFile(null)}
                aria-label="Remove file"
              >
                <IconX size={11} />
              </button>
            </div>
          )}

          <span style={{ flex: 1 }}></span>

          <span
            className="muted mono"
            style={{
              fontSize: 11,
              color: overLimit ? "var(--burn)" : undefined,
            }}
            title="Estimated encrypted POST body size"
          >
            {attachedFile ? (
              <>
                {formatBytes(textBytes)} + {formatBytes(attachmentBytes)}
                <span style={{ margin: "0 6px", color: "var(--fg-3)" }}>·</span>
                ~{formatBytes(estimatedBytes)} / {formatBytes(maxPasteBytes)}
              </>
            ) : (
              <>
                {formatBytes(textBytes)} / {formatBytes(maxPasteBytes)}
              </>
            )}
          </span>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleCreate}
            disabled={encrypting || overLimit}
          >
            <IconLock size={13} />
            Create encrypted paste
            <span
              className="kbd"
              style={{
                background: "rgba(0,0,0,0.18)",
                borderColor: "rgba(0,0,0,0.25)",
                color: "inherit",
              }}
            >
              {MOD}
            </span>
            <span
              className="kbd"
              style={{
                background: "rgba(0,0,0,0.18)",
                borderColor: "rgba(0,0,0,0.25)",
                color: "inherit",
              }}
            >
              ↵
            </span>
          </button>
        </div>
      </div>

      {/* Mobile sheet backdrop — appears under the bottom sheet to dim
          the editor and capture taps that should close the sheet. CSS
          hides it on desktop. */}
      {isMobile && drawerOpen && (
        <div
          className="mobile-sheet-backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <Drawer
        settings={settings}
        setSettings={setSettings}
        textBytes={textBytes}
        attachmentBytes={attachmentBytes}
        estimatedBytes={estimatedBytes}
        maxBytes={maxPasteBytes}
        pct={pct}
        meterClass={meterClass}
        overLimit={overLimit}
        open={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
        attachedFile={attachedFile}
        setAttachedFile={setAttachedFile}
        onPickFile={() => {
          const inp = document.createElement("input");
          inp.type = "file";
          inp.onchange = (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) handleAttach(f);
          };
          inp.click();
        }}
        lineCount={lineCount}
      />
    </div>
  );
}

function Drawer({
  settings,
  setSettings,
  textBytes,
  attachmentBytes,
  estimatedBytes,
  maxBytes,
  pct,
  meterClass,
  overLimit,
  open,
  onToggle,
  attachedFile,
  setAttachedFile,
  onPickFile,
  lineCount,
}: {
  settings: PasteSettings;
  setSettings: (s: PasteSettings) => void;
  textBytes: number;
  attachmentBytes: number;
  estimatedBytes: number;
  maxBytes: number;
  pct: number;
  meterClass: string;
  overLimit: boolean;
  open: boolean;
  onToggle: () => void;
  attachedFile: AttachedFile | null;
  setAttachedFile: (f: AttachedFile | null) => void;
  onPickFile: () => void;
  lineCount: number;
}) {
  const [showPw, setShowPw] = React.useState(false);
  // "Password is being set" — separate from settings.password so the
  // input row stays visible while the user is mid-typing (and after they
  // delete everything but haven't yet toggled off).
  const [pwInputOpen, setPwInputOpen] = React.useState(
    () => !!settings.password,
  );
  React.useEffect(() => {
    if (settings.password) setPwInputOpen(true);
  }, [settings.password]);

  if (!open) {
    return (
      <div className="drawer">
        <button
          className="drawer-collapse-btn"
          onClick={onToggle}
          title="Expand panel"
        >
          <IconChevronLeft size={14} />
        </button>
        <div className="drawer-rail">
          <div className="drawer-rail-icon" title="Encrypted">
            <IconShieldCheck size={14} />
          </div>
          <div className="drawer-rail-icon" title="Expires">
            <IconClock size={14} />
          </div>
          {settings.burn && (
            <div
              className="drawer-rail-icon"
              style={{ color: "var(--burn)" }}
              title="Burn"
            >
              <IconFlame size={14} />
            </div>
          )}
          {settings.password && (
            <div
              className="drawer-rail-icon"
              style={{ color: "var(--accent)" }}
              title="Password"
            >
              <IconKey size={14} />
            </div>
          )}
        </div>
      </div>
    );
  }
  const expiryLabel = EXPIRY_OPTIONS.find((o) => o.v === settings.expiry)?.l;
  return (
    <div className="drawer">
      <button
        className="drawer-collapse-btn"
        onClick={onToggle}
        title="Collapse panel"
      >
        <IconChevronRight size={14} />
      </button>
      <div className="drawer-content">
        <div className="drawer-section" style={{ paddingTop: 6 }}>
          <h4 className="drawer-section-title">Encryption</h4>
          <div className="drawer-row">
            <span>Cipher</span>
            <strong className="mono" style={{ fontSize: 12 }}>
              AES-256-GCM
            </strong>
          </div>
          <div className="drawer-row">
            <span>Key derivation</span>
            <strong className="mono" style={{ fontSize: 12 }}>
              PBKDF2-100k
            </strong>
          </div>
          <div className="drawer-row">
            <span>Status</span>
            <span className="badge badge-accent">
              <span
                className="dot dot-pulse"
                style={{ background: "var(--accent)" }}
              ></span>{" "}
              Live
            </span>
          </div>
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "var(--bg-inset)",
              border: "1px solid var(--line-1)",
              borderRadius: "var(--r-sm)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--fg-2)",
              lineHeight: 1.5,
            }}
          >
            The decryption key lives in the URL fragment{" "}
            <span style={{ color: "var(--accent)" }}>after #</span> — never sent to the server.
          </div>
        </div>

        <div className="drawer-section">
          <h4 className="drawer-section-title">Settings</h4>

          {/* Format — three pill chips */}
          <div className="drawer-row-edit">
            <div className="drawer-row-edit-head">
              <span>Format</span>
            </div>
            <div className="chip-group">
              {FORMATS.map((f) => {
                const Icon = f.icon;
                const active = settings.format === f.v;
                return (
                  <button
                    key={f.v}
                    type="button"
                    className={"chip" + (active ? " chip-active" : "")}
                    onClick={() => setSettings({ ...settings, format: f.v })}
                    aria-pressed={active}
                  >
                    <Icon size={13} /> {f.l}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Language — mono chip cluster, only when format=code */}
          {settings.format === "code" && (
            <div className="drawer-row-edit">
              <div className="drawer-row-edit-head">
                <span>Language</span>
              </div>
              <div className="chip-group">
                {LANGS.map((l) => {
                  const active = settings.language === l;
                  return (
                    <button
                      key={l}
                      type="button"
                      className={
                        "chip chip-mono" + (active ? " chip-active" : "")
                      }
                      onClick={() => setSettings({ ...settings, language: l })}
                      aria-pressed={active}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Expiry — chips */}
          <div className="drawer-row-edit">
            <div className="drawer-row-edit-head">
              <span>Expires</span>
            </div>
            <div className="chip-group">
              {EXPIRY_OPTIONS.map((o) => {
                const active = settings.expiry === o.v;
                return (
                  <button
                    key={o.v}
                    type="button"
                    className={"chip" + (active ? " chip-active" : "")}
                    onClick={() => setSettings({ ...settings, expiry: o.v })}
                    aria-pressed={active}
                  >
                    {o.l}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Burn — toggle row */}
          <div className="drawer-row-edit">
            <div className="drawer-row-edit-head">
              <span>
                <IconFlame
                  size={12}
                  style={{ verticalAlign: "-2px", marginRight: 6 }}
                />
                Burn after read
              </span>
              <button
                type="button"
                className={
                  "toggle toggle-burn" + (settings.burn ? " toggle-on" : "")
                }
                onClick={() => setSettings({ ...settings, burn: !settings.burn })}
                aria-pressed={settings.burn}
                aria-label="Toggle burn-after-read"
              />
            </div>
          </div>

          {/* Discussion — toggle row */}
          <div className="drawer-row-edit">
            <div className="drawer-row-edit-head">
              <span>
                <IconMessage
                  size={12}
                  style={{ verticalAlign: "-2px", marginRight: 6 }}
                />
                Discussion
              </span>
              <button
                type="button"
                className={"toggle" + (settings.discussion ? " toggle-on" : "")}
                onClick={() =>
                  setSettings({ ...settings, discussion: !settings.discussion })
                }
                aria-pressed={settings.discussion}
                aria-label="Toggle discussion"
              />
            </div>
          </div>

          {/* Password — toggle, with inline input that appears when on */}
          <div className="drawer-row-edit">
            <div className="drawer-row-edit-head">
              <span>
                <IconKey
                  size={12}
                  style={{ verticalAlign: "-2px", marginRight: 6 }}
                />
                Password
              </span>
              <button
                type="button"
                className={"toggle" + (pwInputOpen ? " toggle-on" : "")}
                onClick={() => {
                  if (pwInputOpen) {
                    // Toggling off clears the actual password too —
                    // "off" must mean "no password," not "remembered
                    // but invisible," to avoid surprising the user.
                    setPwInputOpen(false);
                    setSettings({ ...settings, password: "" });
                  } else {
                    setPwInputOpen(true);
                  }
                }}
                aria-pressed={pwInputOpen}
                aria-label="Toggle password protection"
              />
            </div>
            {pwInputOpen && (
              <div className="drawer-pw-input">
                <IconKey size={12} />
                <input
                  type={showPw ? "text" : "password"}
                  placeholder="Enter password…"
                  value={settings.password}
                  autoFocus={!settings.password}
                  onChange={(e) =>
                    setSettings({ ...settings, password: e.target.value })
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Attachment section — primary surface for adding files on phones,
            still useful on desktop as an alternative to drag-drop */}
        <div className="drawer-section">
          <h4 className="drawer-section-title">Attachment</h4>
          {!attachedFile ? (
            <button
              type="button"
              className="drawer-attach-btn"
              onClick={onPickFile}
            >
              <IconPaperclip size={14} /> Attach a file
            </button>
          ) : (
            <div className="drawer-attach-current">
              <IconFile size={14} />
              <strong>{attachedFile.name}</strong>
              <span className="muted mono" style={{ fontSize: 11 }}>
                {formatBytes(attachedFile.size)}
              </span>
              <button
                type="button"
                onClick={() => setAttachedFile(null)}
                aria-label="Remove file"
              >
                <IconX size={11} />
              </button>
            </div>
          )}
        </div>

        <div className="drawer-section">
          <h4 className="drawer-section-title">Size</h4>
          <div className="drawer-row">
            <span>Text</span>
            <strong className="mono" style={{ fontSize: 12 }}>
              {formatBytes(textBytes)}
            </strong>
          </div>
          <div className="drawer-row">
            <span>Lines</span>
            <strong className="mono" style={{ fontSize: 12 }}>
              {lineCount}
            </strong>
          </div>
          {attachedFile && (
            <div className="drawer-row">
              <span>Attachment</span>
              <strong className="mono" style={{ fontSize: 12 }}>
                {formatBytes(attachmentBytes)}
              </strong>
            </div>
          )}
          <div className="drawer-row">
            <span>Encrypted</span>
            <strong
              className="mono"
              style={{
                fontSize: 12,
                color: overLimit ? "var(--burn)" : undefined,
              }}
              title="Estimated POST body size after encryption + base64"
            >
              ~{formatBytes(estimatedBytes)}
            </strong>
          </div>
          <div className="drawer-row">
            <span>Limit</span>
            <strong className="mono" style={{ fontSize: 12 }}>
              {formatBytes(maxBytes)}
            </strong>
          </div>
          <div className="size-meter">
            <div
              className={`size-meter-fill ${meterClass}`}
              style={{ width: `${pct}%` }}
            ></div>
          </div>
          {(pct > 70 || overLimit) && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: overLimit || meterClass === "danger" ? "var(--burn)" : "var(--warn)",
              }}
            >
              <IconAlert size={11} />{" "}
              {overLimit ? "Exceeds size limit" : "Approaching size limit"}
            </div>
          )}
        </div>

        <div className="drawer-section">
          <h4 className="drawer-section-title">Shortcuts</h4>
          <div className="drawer-row">
            <span>Create paste</span>
            <span>
              <span className="kbd">{MOD}</span> <span className="kbd">↵</span>
            </span>
          </div>
          <div className="drawer-row">
            <span>Command palette</span>
            <span>
              <span className="kbd">{MOD}</span> <span className="kbd">K</span>
            </span>
          </div>
          <div className="drawer-row">
            <span>Shortcuts</span>
            <span>
              <span className="kbd">{MOD}</span> <span className="kbd">/</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
