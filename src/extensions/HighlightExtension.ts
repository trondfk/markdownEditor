// ABOUTME: Text highlighting mark that persists as inline <mark> HTML.
// ABOUTME: Renders only a validated background colour, leaving text colour to CSS.

import { Highlight } from '@tiptap/extension-highlight';
import { highlightStyle, normalizeHighlightColor } from '../utils/highlight-colors';

/**
 * The stock multicolor attribute renders `background-color: X; color: inherit`.
 * That inline `color` outranks any stylesheet, so in a dark theme the text
 * inside a highlight stays near-white on a pale background and disappears.
 *
 * Emitting only the background hands the text colour back to the `mark` rule in
 * Editor.vue, so a save can never carry editor-only styling into the document.
 *
 * The rendered attribute still comes back out of the DOM in `rgb()` notation
 * rather than the hex given here; the converter normalises it on save.
 */
export const HighlightExtension = Highlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      color: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-color') || element.style.backgroundColor,
        renderHTML: (attributes: Record<string, unknown>) => {
          const color = normalizeHighlightColor(attributes.color as string | null);
          return color ? { style: highlightStyle(color) } : {};
        },
      },
    };
  },
}).configure({ multicolor: true });
