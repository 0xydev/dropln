import * as React from "react";
import "./styles.css";

import { CommandPalette, ShortcutsHelp, type PaletteAction } from "./components/CommandPalette";
import { CreatePaste } from "./components/CreatePaste";
import { Footer, TopNav } from "./components/TopNav";
import {
  IconAlert,
  IconFlame,
  IconHistory,
  IconKey,
  IconKeyboard,
  IconPlus,
  IconSun,
} from "./components/icons";
import { MOD, ToastProvider, useKeyboard, useToast, type LogomarkVariant } from "./components/primitives";
import {
  SuccessCard,
  type PasteData,
  type PasteSettings,
} from "./components/SuccessCard";
import { ViewPaste, type ViewState } from "./components/ViewPaste";
import { SAMPLE_CONTENT } from "./lib/samples";
import { expiryToMs } from "./lib/format-utils";
import { fileToDataURL } from "./lib/file-utils";
import type { AttachedFile } from "./components/CreatePaste";
import {
  decryptPaste,
  encryptPaste,
  type PasteEnvelope,
  type PlainPaste,
} from "./crypto";
import type { Formatter } from "./crypto/format";
import { ApiError, createPaste, getInfo, readPaste } from "./api";
import { addLocalHistory, type LocalHistoryEntry } from "./lib/local-history";
import { HistoryPage } from "./components/HistoryPage";
import { IconUpload } from "./components/icons";

// ─── Design tokens (locked-in choices) ───────────────────────────────────
// Accent / palette live in styles.css now; both themes carry their own
// values so JS doesn't need to push CSS variables anymore.
const LOGOMARK: LogomarkVariant = "lock";

type Route =
  | { name: "create" }
  | { name: "success" }
  | { name: "view" }
  | { name: "history" };

// Settings format ↔ envelope formatter mapping. The UI uses short names; the
// backend (and Format v2) uses the PrivateBin convention.
const SETTING_TO_FORMATTER: Record<PasteSettings["format"], Formatter> = {
  plain: "plaintext",
  code: "syntaxhighlighting",
  md: "markdown",
};
const FORMATTER_TO_SETTING: Record<Formatter, PasteSettings["format"]> = {
  plaintext: "plain",
  syntaxhighlighting: "code",
  markdown: "md",
};

// ─── URL routing helpers ─────────────────────────────────────────────────
// Share URL shape: /p/{id}#{key}
//   - Regular paste:  /p/abc123#KEY
//   - Burn warning:   /p/abc123#-KEY  (PrivateBin convention; show gate before fetching)

type ParsedURL =
  | { kind: "create" }
  | { kind: "history" }
  | { kind: "view"; id: string; keyB64Url: string; warnFirst: boolean };

// 32-byte key → base64url no-padding = 43 chars. A "warn before reading"
// URL prepends "-" → 44 chars. We can't string-prefix-check for "-"
// because base64url's alphabet *contains* "-", so a key that happens to
// start with "-" would be misclassified. Length disambiguates.
const KEY_FRAGMENT_LEN = 43;

function parseURL(): ParsedURL {
  if (window.location.pathname === "/history") return { kind: "history" };
  const m = window.location.pathname.match(/^\/p\/([0-9a-f]{16})\/?$/);
  if (!m) return { kind: "create" };
  const hash = window.location.hash.slice(1);
  if (!hash) return { kind: "create" };

  if (hash.length === KEY_FRAGMENT_LEN) {
    return { kind: "view", id: m[1], keyB64Url: hash, warnFirst: false };
  }
  if (hash.length === KEY_FRAGMENT_LEN + 1 && hash[0] === "-") {
    return { kind: "view", id: m[1], keyB64Url: hash.slice(1), warnFirst: true };
  }
  // Malformed fragment — fall back to create page rather than crash.
  return { kind: "create" };
}

function pushURL(path: string) {
  if (window.location.pathname + window.location.hash === path) return;
  window.history.pushState({}, "", path);
}

// ─── App ─────────────────────────────────────────────────────────────────

// Read the user's persisted preference from localStorage. Falls back to the
// system color-scheme on first visit. SSR-safe-ish: localStorage check is
// guarded for environments without window.
function initialTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("ulakbin.theme");
  if (stored === "dark" || stored === "light") return stored;
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

function AppInner() {
  const [theme, setTheme] = React.useState<"dark" | "light">(initialTheme);
  const [route, setRoute] = React.useState<Route>(() => {
    const p = parseURL();
    if (p.kind === "view") return { name: "view" };
    if (p.kind === "history") return { name: "history" };
    return { name: "create" };
  });
  const [windowDragging, setWindowDragging] = React.useState(false);
  const [showOnboarding, setShowOnboarding] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return !window.localStorage.getItem("ulakbin.onboarded");
  });
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [editorContent, setEditorContent] = React.useState("");
  const [attachedFile, setAttachedFile] = React.useState<AttachedFile | null>(null);
  const [settings, setSettings] = React.useState<PasteSettings>({
    format: "code",
    language: "log",
    expiry: "1day",
    burn: false,
    password: "",
    discussion: true,
  });
  const [pasteData, setPasteData] = React.useState<PasteData | null>(null);
  const [viewState, setViewState] = React.useState<ViewState>("loading");
  const [viewSettings, setViewSettings] = React.useState<PasteSettings | null>(null);
  const [decryptedContent, setDecryptedContent] = React.useState("");
  const [pendingEnvelope, setPendingEnvelope] = React.useState<PasteEnvelope | null>(null);
  const [passwordError, setPasswordError] = React.useState(false);
  // Hydrated from /api/v1/info so the editor warns against a stale local
  // limit. Falls back to a generous default until the request resolves.
  const [maxPasteBytes, setMaxPasteBytes] = React.useState<number>(16 * 1024 * 1024);
  // Server version, shown as a badge in the topnav.
  const [serverVersion, setServerVersion] = React.useState<string>("");
  const [decryptedAttachment, setDecryptedAttachment] = React.useState<{
    name: string;
    dataUrl: string;
  } | null>(null);
  const toast = useToast();

  // Pull server limits + version on mount.
  React.useEffect(() => {
    void getInfo()
      .then((info) => {
        setMaxPasteBytes(info.max_paste_bytes);
        setServerVersion(info.version || "");
      })
      .catch(() => {
        // ignore; defaults already set
      });
  }, []);

  // Apply theme to <html> and persist the choice. The accent token
  // overrides from the dark prototype are dropped — styles.css now owns
  // the full per-theme palette including accent-soft / accent-line, so
  // light mode can use a darker teal without JS-side string concat.
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("theme-light", theme === "light");
    try {
      window.localStorage.setItem("ulakbin.theme", theme);
    } catch {
      // private browsing / disabled storage — ignore
    }
  }, [theme]);

  // Tab title per route — helps users juggling many tabs.
  React.useEffect(() => {
    const titles: Record<Route["name"], string> = {
      create: "ulakbin — encrypted ephemeral paste",
      success: "Encrypted · ulakbin",
      view: "Viewing paste · ulakbin",
      history: "Your pastes · ulakbin",
    };
    document.title = titles[route.name];
  }, [route.name]);

  // Initial URL handling: if landed on /p/{id}#{key}, kick off the view flow.
  React.useEffect(() => {
    const parsed = parseURL();
    if (parsed.kind === "view") {
      void enterView(parsed.id, parsed.keyB64Url, parsed.warnFirst);
    }
    const onPop = () => {
      const p = parseURL();
      if (p.kind === "create") {
        setRoute({ name: "create" });
      } else if (p.kind === "history") {
        setRoute({ name: "history" });
      } else {
        void enterView(p.id, p.keyB64Url, p.warnFirst);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window-level drag-drop. Tracks enter/leave depth so nested drag events
  // (entering a child element after the document) don't flicker the overlay.
  React.useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types || []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (depth === 1) setWindowDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setWindowDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      setWindowDragging(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (route.name !== "create") return;
      const f = e.dataTransfer?.files[0];
      if (f) setAttachedFile({ name: f.name, size: f.size, file: f });
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [route.name]);

  useKeyboard(
    React.useCallback(
      (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          setPaletteOpen((v) => !v);
        } else if ((e.metaKey || e.ctrlKey) && e.key === "/") {
          e.preventDefault();
          setShortcutsOpen((v) => !v);
        } else if (
          (e.metaKey || e.ctrlKey) &&
          e.shiftKey &&
          e.key.toLowerCase() === "t"
        ) {
          e.preventDefault();
          setTheme((t) => (t === "dark" ? "light" : "dark"));
        } else if (e.key === "Escape") {
          if (paletteOpen) setPaletteOpen(false);
          if (shortcutsOpen) setShortcutsOpen(false);
        }
      },
      [paletteOpen, shortcutsOpen],
    ),
  );

  // ─── enterView ────────────────────────────────────────────────────────
  // Drives the loading/burn-gate/password/success state machine.
  // For burn-after-read pastes, the URL fragment gets a leading "-" so we
  // can warn before fetching (otherwise link previewers would consume the
  // paste before the human reader ever sees it).

  const enterView = async (
    id: string,
    keyB64Url: string,
    warnFirst: boolean,
  ) => {
    setRoute({ name: "view" });
    setPasswordError(false);

    const baseData: PasteData = {
      id,
      key: keyB64Url,
      url: `${window.location.origin}/p/${id}#${warnFirst ? "-" : ""}${keyB64Url}`,
      deleteToken: "",
      expiresAt: Date.now() + 60 * 60e3,
      createdAt: Date.now(),
    };
    setPasteData(baseData);

    if (warnFirst) {
      setViewState("burn-gate");
      // Stash the URL parts; actual fetch fires on user confirm.
      return;
    }

    setViewState("loading");
    await fetchAndDecrypt(id, keyB64Url, "");
  };

  const fetchAndDecrypt = async (
    id: string,
    keyB64Url: string,
    password: string,
  ) => {
    let result;
    try {
      result = await readPaste(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setViewState("not-found");
      } else {
        setViewState("decrypt-fail");
      }
      return;
    }

    setPendingEnvelope(result.envelope);

    // Replace the placeholder timestamps from enterView with the truth from
    // the server so the countdown is accurate rather than always ~1h.
    setPasteData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        createdAt: result.createdAt ? result.createdAt * 1000 : prev.createdAt,
        expiresAt: result.expiresAt
          ? result.expiresAt * 1000
          : Number.MAX_SAFE_INTEGER, // "never"
      };
    });

    await tryDecrypt(result.envelope, keyB64Url, password);
  };

  const tryDecrypt = async (
    envelope: PasteEnvelope,
    keyB64Url: string,
    password: string,
  ) => {
    let plain: PlainPaste;
    try {
      plain = await decryptPaste(envelope, keyB64Url, password);
    } catch {
      // Empty password failed → prompt. Non-empty password failed → show error.
      if (password === "") {
        setViewState("password");
        setPasswordError(false);
      } else {
        setViewState("password");
        setPasswordError(true);
      }
      return;
    }

    const adata = envelope.adata;
    setDecryptedContent(plain.paste);
    if (plain.attachment && plain.attachment_name) {
      setDecryptedAttachment({
        name: plain.attachment_name,
        dataUrl: plain.attachment,
      });
    } else {
      setDecryptedAttachment(null);
    }
    setViewSettings({
      format: FORMATTER_TO_SETTING[adata[1]] || "plain",
      language: "log", // not preserved across encrypt; auto-detect later
      expiry: envelope.meta.expire,
      burn: adata[3] === 1,
      password: password,
      discussion: adata[2] === 1,
    });
    setViewState("success");
    setPasswordError(false);
  };

  // ─── handleCreate ────────────────────────────────────────────────────
  // Real encrypt → POST → set pasteData, navigate to success. The browser
  // URL stays at "/" so the user can copy the share URL from the success
  // card without affecting browser history.

  const handleCreate = async () => {
    const plaintext: PlainPaste = { paste: editorContent };
    if (attachedFile) {
      try {
        plaintext.attachment = await fileToDataURL(attachedFile.file);
        plaintext.attachment_name = attachedFile.name;
      } catch (err) {
        console.error("read attachment", err);
        toast({ msg: "Could not read attachment", kind: "warn" });
        return;
      }
    }

    let result;
    try {
      result = await encryptPaste({
        plaintext,
        password: settings.password || undefined,
        expire: settings.expiry,
        formatter: SETTING_TO_FORMATTER[settings.format],
        burnAfterRead: settings.burn,
        openDiscussion: settings.discussion,
      });
    } catch (err) {
      console.error("encrypt failed", err);
      toast({ msg: "Encryption failed locally — try again", kind: "warn" });
      return;
    }

    let response;
    try {
      response = await createPaste(result.envelope);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          toast({ msg: "Rate limited — try again shortly", kind: "warn" });
        } else if (err.status === 413) {
          toast({ msg: "Paste exceeds size limit", kind: "warn" });
        } else if (err.status === 422) {
          toast({ msg: `Validation: ${err.detail}`, kind: "warn" });
        } else {
          toast({ msg: `Server error: ${err.code}`, kind: "warn" });
        }
      } else {
        toast({ msg: "Network error — check connection", kind: "warn" });
      }
      console.error("create failed", err);
      return;
    }

    const fragment = settings.burn ? "-" + result.keyB64Url : result.keyB64Url;
    const url = `${window.location.origin}/p/${response.id}#${fragment}`;
    const expiresAtMs = Date.now() + expiryToMs(settings.expiry);
    setPasteData({
      id: response.id,
      key: result.keyB64Url,
      url,
      deleteToken: response.delete_token,
      expiresAt: expiresAtMs,
      createdAt: Date.now(),
    });
    // Persist to localStorage so /history can show + revoke later.
    const localEntry: LocalHistoryEntry = {
      id: response.id,
      key: result.keyB64Url,
      url,
      deleteToken: response.delete_token,
      server: window.location.origin,
      expiresAt: settings.expiry === "never"
        ? null
        : Math.floor(expiresAtMs / 1000),
      createdAt: Math.floor(Date.now() / 1000),
      burn: settings.burn,
    };
    addLocalHistory(localEntry);

    // Mark onboarding complete on first successful create.
    if (showOnboarding) {
      setShowOnboarding(false);
      try { window.localStorage.setItem("ulakbin.onboarded", "1"); } catch {}
    }

    setRoute({ name: "success" });
  };

  const openCreatedPaste = () => {
    if (!pasteData) return;
    const fragment = settings.burn ? "-" + pasteData.key : pasteData.key;
    pushURL(`/p/${pasteData.id}#${fragment}`);
    // The paste content is already in memory; skip re-fetching (which would
    // double-burn the paste). Show success view directly.
    setDecryptedContent(editorContent);
    setViewSettings(settings);
    setRoute({ name: "view" });
    setViewState("success");
    setPasswordError(false);
  };

  const goCreate = () => {
    pushURL("/");
    setRoute({ name: "create" });
    setEditorContent("");
    setAttachedFile(null);
    setPasteData(null);
    setPendingEnvelope(null);
    setDecryptedContent("");
    setDecryptedAttachment(null);
    setViewSettings(null);
  };

  const goHistory = () => {
    pushURL("/history");
    setRoute({ name: "history" });
  };

  const openHistoryEntry = (e: LocalHistoryEntry) => {
    // Strip the origin if it matches our own; otherwise navigate fully.
    if (e.server && e.server !== window.location.origin) {
      window.location.href = e.url;
      return;
    }
    const fragment = e.burn ? "-" + e.key : e.key;
    pushURL(`/p/${e.id}#${fragment}`);
    void enterView(e.id, e.key, e.burn);
  };

  const onUnlock = (password: string) => {
    if (!pasteData) return;
    if (pendingEnvelope) {
      void tryDecrypt(pendingEnvelope, pasteData.key, password);
    }
  };

  const onProceedBurn = async () => {
    if (!pasteData) return;
    setViewState("loading");
    await fetchAndDecrypt(pasteData.id, pasteData.key, "");
  };

  // ─── command palette ─────────────────────────────────────────────────

  // Palette: real actions only. Demo-state items live behind import.meta.env.DEV
  // so they're stripped in production builds.
  const cpActions: PaletteAction[] = [
    {
      id: "new",
      group: "actions",
      icon: <IconPlus size={14} />,
      label: "New paste",
      onSelect: goCreate,
    },
    {
      id: "history",
      group: "actions",
      icon: <IconHistory size={14} />,
      label: "Your pastes (local history)",
      onSelect: goHistory,
    },
    {
      id: "theme",
      group: "settings",
      icon: <IconSun size={14} />,
      label: "Toggle theme",
      kbd: [MOD, "⇧", "T"],
      onSelect: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    },
    {
      id: "kbd",
      group: "settings",
      icon: <IconKeyboard size={14} />,
      label: "Keyboard shortcuts",
      kbd: [MOD, "/"],
      onSelect: () => setShortcutsOpen(true),
    },
  ];

  if (import.meta.env.DEV) {
    cpActions.push(
      {
        id: "demo-burn",
        group: "actions",
        icon: <IconFlame size={14} />,
        label: "Demo: burn-after-read gate",
        onSelect: () => {
          setPasteData({
            id: "demo01234567890a",
            key: "demo",
            url: "demo",
            deleteToken: "demo",
            expiresAt: Date.now() + 3600e3,
            createdAt: Date.now(),
          });
          setSettings((s) => ({ ...s, burn: true }));
          setViewState("burn-gate");
          setRoute({ name: "view" });
        },
      },
      {
        id: "demo-pw",
        group: "actions",
        icon: <IconKey size={14} />,
        label: "Demo: password gate",
        onSelect: () => {
          setPasteData({
            id: "demo01234567890b",
            key: "demo",
            url: "demo",
            deleteToken: "demo",
            expiresAt: Date.now() + 3600e3,
            createdAt: Date.now(),
          });
          setSettings((s) => ({ ...s, password: "secret", burn: false }));
          setViewState("password");
          setRoute({ name: "view" });
        },
      },
      {
        id: "demo-404",
        group: "actions",
        icon: <IconAlert size={14} />,
        label: "Demo: not-found state",
        onSelect: () => {
          setRoute({ name: "view" });
          setViewState("not-found");
        },
      },
      {
        id: "demo-fail",
        group: "actions",
        icon: <IconAlert size={14} />,
        label: "Demo: decryption failed",
        onSelect: () => {
          setRoute({ name: "view" });
          setViewState("decrypt-fail");
        },
      },
    );
  }

  // ─── render ──────────────────────────────────────────────────────────

  return (
    <div className="app">
      <TopNav
        onOpenPalette={() => setPaletteOpen(true)}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        theme={theme}
        logomark={LOGOMARK}
        onNavigate={() => goCreate()}
        onOpenHistory={goHistory}
        version={serverVersion}
      />

      <main className="main">
        {route.name === "create" && (
          <>
            <CreatePaste
              onCreated={handleCreate}
              settings={settings}
              setSettings={setSettings}
              content={editorContent}
              setContent={setEditorContent}
              attachedFile={attachedFile}
              setAttachedFile={setAttachedFile}
              maxPasteBytes={maxPasteBytes}
              showOnboarding={showOnboarding && !editorContent && !attachedFile}
            />
          </>
        )}

        {route.name === "history" && (
          <HistoryPage onCreate={goCreate} onOpen={openHistoryEntry} />
        )}

        {route.name === "success" && pasteData && (
          <SuccessCard
            pasteData={pasteData}
            settings={settings}
            onCreateAnother={goCreate}
            onOpenPaste={openCreatedPaste}
          />
        )}

        {route.name === "view" && pasteData && (
          <ViewPaste
            state={viewState}
            pasteData={pasteData}
            settings={viewSettings || settings}
            content={decryptedContent || editorContent}
            attachment={decryptedAttachment}
            passwordError={passwordError}
            onBack={goCreate}
            onProceedBurn={onProceedBurn}
            onUnlock={onUnlock}
          />
        )}
      </main>

      <Footer />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={cpActions}
      />

      {windowDragging && route.name === "create" && (
        <div className="window-drop-overlay" aria-hidden="true">
          <div className="window-drop-overlay-card">
            <IconUpload size={28} />
            <strong>Drop to encrypt &amp; attach</strong>
            <span>Files are encrypted in your browser before upload.</span>
          </div>
        </div>
      )}
      <ShortcutsHelp
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
