// Markdown rendering for the viewer. Three stages now:
//   1. markdown-it converts text → HTML, with raw HTML disabled.
//   2. highlight.js paints fenced code blocks with hljs- token classes
//      (subset registry — we ship parsers for languages the editor
//      already targets, ~25 KB gzipped instead of ~280 KB for the full
//      auto-detect bundle).
//   3. DOMPurify scrubs the HTML against XSS as a defense-in-depth
//      layer, with hljs- token classes added to the allowlist so the
//      colorization survives sanitation.
//
// The decrypted plaintext is, by design, untrusted (any URL recipient
// could have authored it), so we treat it as hostile before injecting
// into the DOM.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";

// Register only what the create page advertises in LANGS plus a few
// near-universal aliases. Each language adds 2–6 KB; the full default
// bundle is ~280 KB, so this matters.
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c++", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("toml", ini); // close enough for TOML highlighting
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("php", php);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("text", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rb", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

const md = MarkdownIt({
  html: false, // disallow raw HTML — markdown-only
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(str, lang) {
    // markdown-it expects pre-escaped HTML back. hljs.highlight returns
    // pre-escaped output (it constructs the spans itself), so we wrap
    // that in <code> ourselves and skip md's default escaping by
    // returning a non-empty string.
    const trimmed = (lang || "").toLowerCase();
    if (trimmed && hljs.getLanguage(trimmed)) {
      try {
        const out = hljs.highlight(str, {
          language: trimmed,
          ignoreIllegals: true,
        }).value;
        return `<pre class="hljs"><code class="hljs language-${trimmed}">${out}</code></pre>`;
      } catch {
        // Highlight failure → fall through to markdown-it's default
        // escaping below.
      }
    }
    return "";
  },
});

// hljs-* class names that the highlighter emits — DOMPurify drops
// classes by default, so we explicitly allow this prefix. The list is
// the union of all token kinds hljs uses.
const HLJS_CLASSES = [
  "hljs",
  "hljs-keyword",
  "hljs-built_in",
  "hljs-type",
  "hljs-literal",
  "hljs-number",
  "hljs-regexp",
  "hljs-string",
  "hljs-subst",
  "hljs-symbol",
  "hljs-class",
  "hljs-function",
  "hljs-title",
  "hljs-params",
  "hljs-comment",
  "hljs-doctag",
  "hljs-meta",
  "hljs-meta-keyword",
  "hljs-meta-string",
  "hljs-section",
  "hljs-tag",
  "hljs-name",
  "hljs-attr",
  "hljs-attribute",
  "hljs-variable",
  "hljs-bullet",
  "hljs-code",
  "hljs-emphasis",
  "hljs-strong",
  "hljs-formula",
  "hljs-link",
  "hljs-quote",
  "hljs-selector-tag",
  "hljs-selector-id",
  "hljs-selector-class",
  "hljs-selector-attr",
  "hljs-selector-pseudo",
  "hljs-template-tag",
  "hljs-template-variable",
  "hljs-addition",
  "hljs-deletion",
  "hljs-property",
  "hljs-operator",
  "hljs-punctuation",
  "hljs-char",
  "hljs-namespace",
  // language-* classes hljs adds to <code>
];

const LANGUAGE_CLASS_RE = /^language-[\w+#.-]+$/;

export function renderMarkdown(source: string): string {
  const html = md.render(source);
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "target", "rel", "class"],
    // Custom hook: when scrubbing class lists, keep only hljs-* and
    // language-* — drop anything else markdown-it might have emitted.
    // This runs as a sanitize-attribute hook; we just preflight the
    // class attribute before DOMPurify decides on it.
  });
}

// Filter class lists to only the highlighter classes we want to allow.
// Done as a DOMPurify hook so it applies to *every* element after parse,
// without needing a custom sanitization pipeline.
DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "class") {
    const classes = (data.attrValue || "").split(/\s+/).filter(Boolean);
    const kept = classes.filter(
      (c) => HLJS_CLASSES.includes(c) || LANGUAGE_CLASS_RE.test(c),
    );
    data.attrValue = kept.join(" ");
    if (!data.attrValue) data.keepAttr = false;
  }
});
