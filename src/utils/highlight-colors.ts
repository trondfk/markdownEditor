/**
 * The text-highlight palette and the colour normaliser that keeps it stable
 * across a save/load round trip.
 *
 * Highlights persist as inline HTML in the Markdown source, so the colour ends
 * up inside a `style` attribute. Everything that reaches that attribute goes
 * through `normalizeHighlightColor` first: it is the single place that decides
 * what counts as a colour, which keeps arbitrary CSS out of the document.
 */

export interface HighlightColor {
  /** Stable id used by the toolbar and by the i18n label lookup. */
  id: string;
  /** Canonical lowercase hex, the form written to the document. */
  hex: string;
}

/**
 * Pale shades on purpose: the mark keeps dark text in every theme (see the
 * `mark` rule in Editor.vue), so a saturated background would kill contrast.
 */
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  { id: 'yellow', hex: '#fff3a3' },
  { id: 'green', hex: '#b9f6ca' },
  { id: 'blue', hex: '#b3e5fc' },
  { id: 'pink', hex: '#f8bbd0' },
  { id: 'orange', hex: '#ffe0b2' },
  { id: 'purple', hex: '#e1bee7' },
];

/** Used when a document carries a bare `<mark>` with no colour of its own. */
export const DEFAULT_HIGHLIGHT_HEX = HIGHLIGHT_COLORS[0].hex;

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// Both the legacy comma form and the CSS Color 4 space form, with optional
// alpha. Alpha is parsed so the value validates, then dropped: the document
// stores an opaque background.
const RGB_RE = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+\s*)?\)$/i;

const toHex = (n: number): string => n.toString(16).padStart(2, '0');

/**
 * Reduce a colour to canonical lowercase `#rrggbb`, or null when the input is
 * anything else.
 *
 * The round trip needs this, not just the sanitising: the browser reports
 * `element.style.backgroundColor` as `rgb(...)`, so a hex written to disk comes
 * back from the DOM in a different notation. Without normalising, every save
 * would rewrite the attribute and churn the file.
 */
export function normalizeHighlightColor(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;

  if (HEX_RE.test(value)) {
    if (value.length === 4) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
    }
    return value;
  }

  const rgb = value.match(RGB_RE);
  if (rgb) {
    const parts = [rgb[1], rgb[2], rgb[3]].map(Number);
    if (parts.some(n => n > 255)) return null;
    return `#${parts.map(toHex).join('')}`;
  }

  return null;
}

/** The exact style attribute written for a highlight, from a trusted hex. */
export function highlightStyle(hex: string): string {
  return `background-color: ${hex}`;
}
