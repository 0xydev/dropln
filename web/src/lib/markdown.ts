// Markdown rendering for the viewer. Two-stage:
//   1. markdown-it converts text → HTML, with raw HTML disabled.
//   2. DOMPurify scrubs the HTML against XSS as a defense-in-depth layer.
//
// The decrypted plaintext is, by design, untrusted (any URL recipient could
// have authored it), so we treat it as hostile before injecting into the DOM.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = MarkdownIt({
  html: false, // disallow raw HTML — markdown-only
  linkify: true,
  typographer: true,
  breaks: false,
});

export function renderMarkdown(source: string): string {
  const html = md.render(source);
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
  });
}
