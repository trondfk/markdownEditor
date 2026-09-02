import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { HighlightExtension } from '../../extensions/HighlightExtension';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdown-converter';
import { sanitizeSafeInlineHtmlTag } from '../../utils/safe-html';
import {
  DEFAULT_HIGHLIGHT_HEX,
  HIGHLIGHT_COLORS,
  normalizeHighlightColor,
} from '../../utils/highlight-colors';

describe('normalizeHighlightColor', () => {
  it('passes canonical hex through unchanged', () => {
    expect(normalizeHighlightColor('#fff3a3')).toBe('#fff3a3');
  });

  it('lowercases and expands shorthand hex', () => {
    expect(normalizeHighlightColor('#FFF3A3')).toBe('#fff3a3');
    expect(normalizeHighlightColor('#FA3')).toBe('#ffaa33');
  });

  it('converts the rgb notation the DOM reports back to hex', () => {
    // The browser rewrites style.backgroundColor, so this is the form that
    // comes back out of the editor for a colour written as hex.
    expect(normalizeHighlightColor('rgb(255, 243, 163)')).toBe('#fff3a3');
    expect(normalizeHighlightColor('rgb(255 243 163)')).toBe('#fff3a3');
    expect(normalizeHighlightColor('rgba(255, 243, 163, 0.5)')).toBe('#fff3a3');
  });

  it('rejects anything that is not a plain colour', () => {
    for (const bad of [
      null,
      undefined,
      '',
      '   ',
      'red',
      'url(javascript:alert(1))',
      'expression(alert(1))',
      '#12345',
      'rgb(300, 0, 0)',
      '#fff3a3; behavior: url(x)',
    ]) {
      expect(normalizeHighlightColor(bad)).toBeNull();
    }
  });

  it('keeps every palette entry canonical', () => {
    for (const c of HIGHLIGHT_COLORS) {
      expect(normalizeHighlightColor(c.hex)).toBe(c.hex);
    }
    expect(normalizeHighlightColor(DEFAULT_HIGHLIGHT_HEX)).toBe(DEFAULT_HIGHLIGHT_HEX);
  });
});

describe('highlight sanitisation', () => {
  it('rebuilds the style from a validated colour', () => {
    expect(sanitizeSafeInlineHtmlTag('<mark style="background-color: #fff3a3">'))
      .toBe('<mark style="background-color: #fff3a3">');
  });

  it('reads the colour TipTap writes as data-color', () => {
    expect(sanitizeSafeInlineHtmlTag('<mark data-color="#b9f6ca" style="background-color: #b9f6ca; color: inherit">'))
      .toBe('<mark style="background-color: #b9f6ca">');
  });

  it('drops a style that is not a plain colour', () => {
    const out = sanitizeSafeInlineHtmlTag('<mark style="background-color: url(javascript:alert(1))">');
    expect(out).toBe('<mark>');
  });

  it('drops every attribute other than the colour', () => {
    const out = sanitizeSafeInlineHtmlTag('<mark onclick="alert(1)" class="x" style="background-color:#fff3a3">');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('class');
    expect(out).toContain('background-color: #fff3a3');
  });

  it('keeps the closing tag', () => {
    expect(sanitizeSafeInlineHtmlTag('</mark>')).toBe('</mark>');
  });
});

describe('highlight markdown round trip', () => {
  it('survives markdown to HTML and back with the colour intact', () => {
    const md = 'Dette er <mark style="background-color: #fff3a3">viktig</mark> tekst.';
    expect(htmlToMarkdown(markdownToHtml(md))).toContain(
      '<mark style="background-color: #fff3a3">viktig</mark>',
    );
  });

  it('is byte-stable over repeated saves', () => {
    const md = 'A <mark style="background-color: #b3e5fc">B</mark> C.';
    const once = htmlToMarkdown(markdownToHtml(md));
    const twice = htmlToMarkdown(markdownToHtml(once));
    expect(twice).toBe(once);
  });

  it('normalises the rgb form the editor emits back to hex', () => {
    const html = '<p>A <mark data-color="rgb(255, 243, 163)" style="background-color: rgb(255, 243, 163); color: inherit">B</mark> C</p>';
    expect(htmlToMarkdown(html)).toContain('<mark style="background-color: #fff3a3">B</mark>');
  });

  it('keeps a bare mark without inventing a colour', () => {
    expect(htmlToMarkdown('<p><mark>B</mark></p>')).toContain('<mark>B</mark>');
  });

  it('keeps nested emphasis inside a highlight', () => {
    const md = 'A <mark style="background-color: #fff3a3">**bold**</mark> C.';
    const out = htmlToMarkdown(markdownToHtml(md));
    expect(out).toContain('<mark style="background-color: #fff3a3">**bold**</mark>');
  });

  it('does not let a hostile style reach the document', () => {
    const md = 'A <mark style="background-color: red; behavior: url(x)">B</mark> C.';
    const out = htmlToMarkdown(markdownToHtml(md));
    expect(out).not.toContain('behavior');
    expect(out).toContain('<mark>B</mark>');
  });
});

/** The converter tests above bypass ProseMirror; these go through the real
 *  schema, which is where a mark that the editor refuses to parse would show
 *  up as silently dropped formatting. */
describe('highlight through the TipTap schema', () => {
  const withEditor = (content: string, fn: (editor: Editor) => void) => {
    const editor = new Editor({
      extensions: [StarterKit, HighlightExtension],
      content,
    });
    try {
      fn(editor);
    } finally {
      editor.destroy();
    }
  };

  it('parses a highlight out of the document and writes it back unchanged', () => {
    const md = 'A <mark style="background-color: #b9f6ca">B</mark> C.';
    withEditor(markdownToHtml(md), (editor) => {
      expect(editor.getHTML()).toContain('<mark');
      expect(htmlToMarkdown(editor.getHTML()).trim()).toBe(md);
    });
  });

  it('saves a highlight applied through the editor command', () => {
    withEditor('<p>one two three</p>', (editor) => {
      editor.commands.setTextSelection({ from: 5, to: 8 });
      editor.commands.setHighlight({ color: '#fff3a3' });
      expect(htmlToMarkdown(editor.getHTML()).trim())
        .toBe('one <mark style="background-color: #fff3a3">two</mark> three');
    });
  });

  it('leaves nothing behind once the highlight is removed', () => {
    const md = 'A <mark style="background-color: #fff3a3">B</mark> C.';
    withEditor(markdownToHtml(md), (editor) => {
      editor.commands.selectAll();
      editor.commands.unsetHighlight();
      expect(htmlToMarkdown(editor.getHTML()).trim()).toBe('A B C.');
    });
  });

  it('never renders an inline text colour', () => {
    // The stock extension emits `color: inherit`, which outranks the
    // stylesheet and leaves near-white text on a pale highlight in dark
    // themes, the bug this extension exists to avoid. The background is
    // asserted through a colour comparison because the DOM rewrites the hex
    // in the style attribute to its rgb form.
    withEditor('<p>one two three</p>', (editor) => {
      editor.commands.selectAll();
      editor.commands.setHighlight({ color: '#fff3a3' });
      const style = editor.getHTML().match(/<mark style="([^"]*)"/)?.[1] ?? '';
      const declarations = style.split(';').map(s => s.trim()).filter(Boolean);

      expect(declarations).toHaveLength(1);
      const [property, value] = declarations[0].split(/:(.*)/);
      expect(property.trim()).toBe('background-color');
      expect(normalizeHighlightColor(value)).toBe('#fff3a3');
    });
  });

  it('renders no style at all for a colour it cannot validate', () => {
    withEditor('<p>one</p>', (editor) => {
      editor.commands.selectAll();
      editor.commands.setHighlight({ color: 'url(javascript:alert(1))' });
      expect(editor.getHTML()).toContain('<mark>');
    });
  });

  it('reports the active colour in the canonical hex the picker compares against', () => {
    const md = 'A <mark style="background-color: #b3e5fc">B</mark> C.';
    withEditor(markdownToHtml(md), (editor) => {
      editor.commands.setTextSelection({ from: 3, to: 4 });
      expect(editor.isActive('highlight')).toBe(true);
      expect(normalizeHighlightColor(editor.getAttributes('highlight').color)).toBe('#b3e5fc');
    });
  });
});
