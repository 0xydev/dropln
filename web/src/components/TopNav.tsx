import { IconGithub, IconHistory, IconMoon, IconSearch, IconSun } from "./icons";
import { Brand, MOD, type LogomarkVariant } from "./primitives";

const REPO_URL = "https://github.com/0xydev/ulakbin";

type TopNavProps = {
  onOpenPalette: () => void;
  onToggleTheme: () => void;
  theme: "dark" | "light";
  logomark: LogomarkVariant;
  onNavigate: (name: string) => void;
  onOpenHistory: () => void;
  /** Server version from /api/v1/info; empty until the request resolves. */
  version?: string;
};

export function TopNav({
  onOpenPalette,
  onToggleTheme,
  theme,
  logomark,
  onNavigate,
  onOpenHistory,
  version,
}: TopNavProps) {
  return (
    <header className="topnav">
      <Brand variant={logomark} onClick={() => onNavigate("create")} />
      {version && (
        <span
          className="badge badge-mono"
          style={{ marginLeft: 4 }}
          title="Server version"
        >
          <span className="dot" style={{ background: "var(--ok)" }}></span>
          {version}
        </span>
      )}

      <span className="nav-spacer"></span>

      <button
        className="kbd-hint"
        onClick={onOpenPalette}
        aria-label="Open command palette"
      >
        <IconSearch size={12} />
        <span>Search or jump…</span>
        <span className="kbd">{MOD}</span>
        <span className="kbd">K</span>
      </button>

      <div className="nav-links">
        <button
          className="nav-link"
          onClick={onOpenHistory}
          title="Your local paste history"
        >
          <IconHistory size={13} /> History
        </button>
        <a
          className="nav-link"
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconGithub size={13} /> GitHub
        </a>
        <button
          className="btn btn-ghost btn-icon"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
        </button>
      </div>
    </header>
  );
}

import { IconShieldCheck } from "./icons";

export function Footer() {
  return (
    <footer className="footer">
      <span className="footer-msg">
        <IconShieldCheck size={12} /> End-to-end encrypted in your browser. The
        server cannot read your data.
      </span>
      <span style={{ flex: 1 }}></span>
      <a
        className="footer-link"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Source
      </a>
      <span className="muted">AES-256-GCM · PBKDF2 100k</span>
    </footer>
  );
}
