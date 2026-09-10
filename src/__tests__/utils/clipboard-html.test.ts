// ABOUTME: Characterizes clipboard HTML → editor HTML so website paste survives save.
// ABOUTME: External HTML must round-trip through markdown before the user edits it.

import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdown-converter';
import {
  clipboardHtmlToEditorHtml,
  extractClipboardHtmlFragment,
  isInternalEditorHtml,
  promoteStyledSpans,
} from '../../utils/clipboard-html';

const WEBSITE_CLIPBOARD = `<html><body>
<!--StartFragment-->
<p><span style="font-size: 16px">Første avsnitt frå nettsida.</span></p>
<p><span>Andre avsnitt med </span><span style="font-weight:700">utheving</span>.</p>
<!--EndFragment-->
</body></html>`;

describe('clipboard HTML paste', () => {
  it('extracts the StartFragment body browsers wrap around a copy', () => {
    const fragment = extractClipboardHtmlFragment(WEBSITE_CLIPBOARD);
    expect(fragment).toContain('Første avsnitt');
    expect(fragment).not.toContain('StartFragment');
  });

  it('promotes CSS-bold leaf spans to strong before markdown conversion', () => {
    expect(promoteStyledSpans('<span style="font-weight:700">utheving</span>'))
      .toBe('<strong>utheving</strong>');
  });

  it('does not treat TipTap HTML as an external website paste', () => {
    expect(isInternalEditorHtml('<p><a class="editor-link" href="https://x">a</a></p>')).toBe(true);
    expect(isInternalEditorHtml('<div data-type="mermaid"></div>')).toBe(true);
    expect(isInternalEditorHtml(WEBSITE_CLIPBOARD)).toBe(false);
  });

  it('turns website clipboard HTML into the same HTML save/reload would produce', () => {
    const editorHtml = clipboardHtmlToEditorHtml(WEBSITE_CLIPBOARD);
    const saved = htmlToMarkdown(editorHtml);
    expect(saved).toContain('Første avsnitt frå nettsida.');
    expect(saved).toContain('**utheving**');
    expect(htmlToMarkdown(markdownToHtml(saved))).toBe(saved);
  });

  it('keeps formatting the user applies after the paste through a save/reload', () => {
    const afterPaste = clipboardHtmlToEditorHtml(WEBSITE_CLIPBOARD);
    // Same shape as pressing Enter in a paragraph and wrapping a new ingress in bold.
    const afterEdits = afterPaste
      .replace('<p>', '<p><strong>Ingress.</strong></p><p>')
      .replace('Første avsnitt frå nettsida.', 'Første avsnitt</p><p>frå nettsida.');
    const saved = htmlToMarkdown(afterEdits);
    expect(saved).toContain('**Ingress.**');
    expect(saved).toContain('Første avsnitt');
    expect(saved).toContain('frå nettsida.');
    const reopened = htmlToMarkdown(markdownToHtml(saved));
    expect(reopened).toContain('**Ingress.**');
    expect(reopened.split('Første avsnitt')[0]).toContain('**Ingress.**');
    expect(reopened).toMatch(/Første avsnitt\s*\n+frå nettsida/);
  });
});
