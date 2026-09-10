// ABOUTME: Turns clipboard HTML from browsers/Word into editor HTML that matches save/reload.
// ABOUTME: Website paste otherwise lives as TipTap HTML that htmlToMarkdown cannot keep.

import { htmlToMarkdown, markdownToHtml } from './markdown-converter';

const START_FRAGMENT = '<!--StartFragment-->';
const END_FRAGMENT = '<!--EndFragment-->';

/**
 * HTML copied from our own editor. Default TipTap paste keeps mermaid, math
 * and tables; running it through htmlToMarkdown would flatten those nodes.
 */
export function isInternalEditorHtml(html: string): boolean {
  return /class="[^"]*editor-(?:link|image|table)/i.test(html)
    || /data-type="mermaid"/i.test(html)
    || /data-safe-html-block=/i.test(html)
    || /data-type="footnote/i.test(html)
    || /class="[^"]*katex/i.test(html);
}

/** Pulls the pasted fragment out of the HTML clipboard wrapper browsers add. */
export function extractClipboardHtmlFragment(raw: string): string {
  const start = raw.indexOf(START_FRAGMENT);
  const end = raw.indexOf(END_FRAGMENT);
  if (start >= 0 && end > start) {
    return raw.slice(start + START_FRAGMENT.length, end);
  }
  if (typeof DOMParser === 'undefined') return raw;
  const parsed = new DOMParser().parseFromString(raw, 'text/html');
  const body = parsed.body?.innerHTML?.trim();
  return body || raw;
}

/**
 * Website/Word copy often bolds via CSS on a span. htmlToMarkdown only sees
 * <strong>/<b>, so promote those spans before the conversion.
 */
export function promoteStyledSpans(html: string): string {
  // Leaf spans only. Nested span soup from Word/Docs is unwrapped by the
  // later htmlToMarkdown span strip; matching across nested tags here would
  // cut at the first </span> and corrupt the fragment.
  return html.replace(/<span([^>]*)>([^<]*)<\/span>/gi, (_full, attrs: string, inner: string) => {
    const style = attrs.match(/style\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style)) return `<strong>${inner}</strong>`;
    if (/font-style\s*:\s*italic/i.test(style)) return `<em>${inner}</em>`;
    return inner;
  });
}

/**
 * Converts external clipboard HTML into the same HTML save/reload would
 * produce, so later visual edits are made on the representation that hits disk.
 */
export function clipboardHtmlToEditorHtml(raw: string): string {
  const fragment = promoteStyledSpans(extractClipboardHtmlFragment(raw));
  const markdown = htmlToMarkdown(fragment);
  if (!markdown.trim()) return '';
  return markdownToHtml(markdown);
}
