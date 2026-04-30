// CodeMirror 6 editor wrapped in a tiny React component.
// - Themed via our CSS variables so it matches the rest of the UI exactly.
// - Language packs are lazy-imported per `lang` so they don't bloat the
//   initial bundle.
// - Same component handles both editable (create) and read-only (view) modes.

import * as React from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

// ─── theme ───────────────────────────────────────────────────────────────
// Uses our CSS custom properties so dark/light + accent flips Just Work.

const ulakbinTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--bg-inset)",
      color: "var(--fg-0)",
      fontFamily: "var(--font-mono)",
      fontSize: "13px",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      padding: "12px 0",
      lineHeight: "1.55",
      fontVariantLigatures: "none",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground":
      {
        backgroundColor: "var(--accent-soft)",
      },
    ".cm-gutters": {
      backgroundColor: "var(--bg-inset)",
      color: "var(--fg-3)",
      border: "none",
      borderRight: "1px solid var(--line-1)",
      paddingRight: "4px",
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 10px 0 14px",
      minWidth: "32px",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--bg-3) 40%, transparent)" },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in oklab, var(--bg-3) 40%, transparent)",
      color: "var(--fg-1)",
    },
    ".cm-selectionMatch": { backgroundColor: "var(--accent-soft)" },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "var(--accent-soft)",
      outline: "1px solid var(--accent-line)",
    },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in oklab, var(--warn) 30%, transparent)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "color-mix(in oklab, var(--warn) 60%, transparent)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--bg-1)",
      border: "1px solid var(--line-2)",
      borderRadius: "var(--r-md)",
      color: "var(--fg-0)",
    },
    ".cm-panels": {
      backgroundColor: "var(--bg-1)",
      color: "var(--fg-0)",
      borderTop: "1px solid var(--line-1)",
    },
    ".cm-panel input": {
      backgroundColor: "var(--bg-inset)",
      border: "1px solid var(--line-2)",
      borderRadius: "var(--r-sm)",
      color: "var(--fg-0)",
      padding: "2px 6px",
    },
    ".cm-panel button": {
      backgroundColor: "var(--bg-2)",
      border: "1px solid var(--line-2)",
      borderRadius: "var(--r-sm)",
      color: "var(--fg-0)",
      padding: "2px 8px",
    },
  },
  { dark: true },
);

// Syntax palette is fully token-driven (var(--syntax-*)) so it flips between
// dark and light themes without touching this module — see styles.css.
const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syntax-keyword)" },
  { tag: [t.controlKeyword, t.modifier], color: "var(--syntax-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syntax-string)" },
  { tag: t.number, color: "var(--syntax-number)" },
  { tag: t.bool, color: "var(--syntax-number)" },
  { tag: t.null, color: "var(--syntax-number)" },
  { tag: t.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: t.lineComment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: t.blockComment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "var(--syntax-function)" },
  { tag: t.definition(t.variableName), color: "var(--fg-0)" },
  { tag: t.variableName, color: "var(--fg-0)" },
  { tag: t.propertyName, color: "var(--syntax-property)" },
  { tag: t.className, color: "var(--syntax-type)" },
  { tag: t.typeName, color: "var(--syntax-type)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--syntax-tag)" },
  { tag: t.attributeName, color: "var(--syntax-attribute)" },
  { tag: t.attributeValue, color: "var(--syntax-string)" },
  { tag: [t.regexp, t.escape], color: "var(--syntax-regex)" },
  { tag: t.operator, color: "var(--syntax-operator)" },
  { tag: t.punctuation, color: "var(--syntax-punct)" },
  { tag: t.bracket, color: "var(--syntax-punct)" },
  { tag: [t.heading], color: "var(--syntax-heading)", fontWeight: "600" },
  { tag: [t.url, t.link], color: "var(--accent)", textDecoration: "underline" },
]);

// ─── language loaders ────────────────────────────────────────────────────
// Static map so Vite can split each language into its own chunk.

type LanguageExt = Extension;

const LANG_LOADERS: Record<string, () => Promise<LanguageExt>> = {
  typescript: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true, jsx: true }),
    ),
  javascript: () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  markdown: () =>
    import("@codemirror/lang-markdown").then((m) => m.markdown()),
};

async function loadLanguage(lang?: string): Promise<LanguageExt> {
  if (!lang) return [];
  const loader = LANG_LOADERS[lang];
  if (!loader) return [];
  try {
    return await loader();
  } catch {
    return [];
  }
}

// ─── component ────────────────────────────────────────────────────────────

export type CodeEditorProps = {
  value: string;
  onChange?: (next: string) => void;
  language?: string;
  readOnly?: boolean;
  placeholder?: string;
  /** Forward a focus() handle to the parent. */
  editorRef?: React.MutableRefObject<EditorView | null>;
  /** Cmd/Ctrl + Enter handler — used by Create flow to submit. */
  onSubmit?: () => void;
  className?: string;
};

const baseExtensions: Extension[] = [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  history(),
  bracketMatching(),
  highlightSelectionMatches(),
  syntaxHighlighting(highlightStyle),
  // search() enables the find/replace panel UI. Cmd/Ctrl+F opens it; the
  // panel has a "Replace" toggle that reveals the replace input + Replace /
  // Replace All buttons.
  search({ top: true }),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
  EditorView.lineWrapping,
  ulakbinTheme,
];

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  placeholder,
  editorRef,
  onSubmit,
  className,
}: CodeEditorProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const langCompRef = React.useRef(new Compartment());
  const onChangeRef = React.useRef(onChange);
  const onSubmitRef = React.useRef(onSubmit);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  React.useEffect(() => {
    if (!hostRef.current) return;

    const submitKeymap = keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          onSubmitRef.current?.();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && onChangeRef.current) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        ...baseExtensions,
        submitKeymap,
        updateListener,
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        langCompRef.current.of([]),
        placeholder
          ? EditorView.theme({
              ".cm-placeholder": {
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
                fontStyle: "normal",
              },
            })
          : [],
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    if (editorRef) editorRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      if (editorRef) editorRef.current = null;
    };
    // deliberately only run on mount; subsequent updates handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (e.g. "Insert sample") sync into the editor.
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Language changes hot-swap via a Compartment (no re-init).
  React.useEffect(() => {
    let cancelled = false;
    void loadLanguage(language).then((ext) => {
      if (cancelled) return;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: langCompRef.current.reconfigure(ext),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return <div ref={hostRef} className={className} />;
}
