import * as React from "react";
import "./styles.css";

import { CommandPalette, ShortcutsHelp, type PaletteAction } from "./components/CommandPalette";
import { CreatePaste } from "./components/CreatePaste";
import { Footer, TopNav } from "./components/TopNav";
import {
  IconAlert,
  IconFlame,
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

// ─── Design tokens (locked-in choices) ───────────────────────────────────
const ACCENT_TEAL = { fg: "#14b8a6", text: "#061412" };
const LOGOMARK: LogomarkVariant = "lock";

type Route = { name: "create" } | { name: "success" } | { name: "view" };

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
  | { kind: "view"; id: string; keyB64Url: string; warnFirst: boolean };

// 32-byte key → base64url no-padding = 43 chars. A "warn before reading"
// URL prepends "-" → 44 chars. We can't string-prefix-check for "-"
// because base64url's alphabet *contains* "-", so a key that happens to
// start with "-" would be misclassified. Length disambiguates.
const KEY_FRAGMENT_LEN = 43;

function parseURL(): ParsedURL {
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

function AppInner() {
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  const [route, setRoute] = React.useState<Route>(() =>
    parseURL().kind === "view" ? { name: "view" } : { name: "create" },
  );
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

  // Apply theme + locked design tokens to <html>.
  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", ACCENT_TEAL.fg);
    root.style.setProperty("--accent-fg", ACCENT_TEAL.text);
    root.style.setProperty("--accent-soft", ACCENT_TEAL.fg + "1f");
    root.style.setProperty("--accent-line", ACCENT_TEAL.fg + "3a");
    root.classList.toggle("theme-light", theme === "light");
  }, [theme]);

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
      } else {
        void enterView(p.id, p.keyB64Url, p.warnFirst);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setPasteData({
      id: response.id,
      key: result.keyB64Url,
      url,
      deleteToken: response.delete_token,
      expiresAt: Date.now() + expiryToMs(settings.expiry),
      createdAt: Date.now(),
    });
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
      kbd: ["N"],
      onSelect: goCreate,
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
        version={serverVersion}
      />

      <main className="main">
        {route.name === "create" && (
          <CreatePaste
            onCreated={handleCreate}
            settings={settings}
            setSettings={setSettings}
            content={editorContent}
            setContent={setEditorContent}
            attachedFile={attachedFile}
            setAttachedFile={setAttachedFile}
            maxPasteBytes={maxPasteBytes}
          />
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
