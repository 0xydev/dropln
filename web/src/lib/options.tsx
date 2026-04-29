// Editor option lists. FORMATS uses icons → .tsx file.

import { IconText, IconCode, IconMd } from "../components/icons";

// `v` matches the backend's accepted `meta.expire` values, so we can pass
// the user's selection straight through to the envelope without mapping.
export const EXPIRY_OPTIONS = [
  { v: "5min", l: "5 minutes" },
  { v: "10min", l: "10 minutes" },
  { v: "1hour", l: "1 hour" },
  { v: "1day", l: "1 day" },
  { v: "1week", l: "1 week" },
  { v: "1month", l: "1 month" },
  { v: "1year", l: "1 year" },
  { v: "never", l: "Never (forever)" },
] as const;

export const FORMATS = [
  { v: "plain", l: "Plain text", icon: IconText },
  { v: "code", l: "Code", icon: IconCode },
  { v: "md", l: "Markdown", icon: IconMd },
] as const;

export const LANGS = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "shell",
  "json",
  "yaml",
  "sql",
  "log",
] as const;
