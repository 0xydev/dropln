import {
  IconBook,
  IconGithub,
  IconMoon,
  IconSearch,
  IconSettings,
  IconSun,
} from "./icons";
import { Brand, MOD, type LogomarkVariant } from "./primitives";

type TopNavProps = {
  onOpenPalette: () => void;
  onToggleTheme: () => void;
  theme: "dark" | "light";
  logomark: LogomarkVariant;
  onNavigate: (name: string) => void;
  onOpenTweaks?: () => void;
};

export function TopNav({
  onOpenPalette,
  onToggleTheme,
  theme,
  logomark,
  onNavigate,
  onOpenTweaks,
}: TopNavProps) {
  return (
    <header className="topnav">
      <Brand variant={logomark} onClick={() => onNavigate("create")} />
      <span className="badge badge-mono" style={{ marginLeft: 4 }}>
        <span className="dot" style={{ background: "var(--ok)" }}></span>
        v0.4.2
      </span>

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
        <a
          className="nav-link"
          href="#docs"
          onClick={(e) => e.preventDefault()}
        >
          <IconBook size={13} /> Docs
        </a>
        <a className="nav-link" href="#gh" onClick={(e) => e.preventDefault()}>
          <IconGithub size={13} /> GitHub
        </a>
        <button
          className="btn btn-ghost btn-icon"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
        </button>
        {onOpenTweaks && (
          <button
            className="btn btn-ghost btn-icon"
            onClick={onOpenTweaks}
            aria-label="Open settings"
          >
            <IconSettings size={14} />
          </button>
        )}
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
      <a className="footer-link" href="#" onClick={(e) => e.preventDefault()}>
        Privacy
      </a>
      <a className="footer-link" href="#" onClick={(e) => e.preventDefault()}>
        Security
      </a>
      <a className="footer-link" href="#" onClick={(e) => e.preventDefault()}>
        Source
      </a>
      <span className="muted">AES-256-GCM · PBKDF2 100k</span>
    </footer>
  );
}
