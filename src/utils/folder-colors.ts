// ABOUTME: The palette for workspace folder colours, plus the rules that keep stored colours valid.
// ABOUTME: Colours are keyed by absolute folder path, so renaming a folder has to carry them along.

export interface FolderColor {
  /** Stable id used by the picker and by the i18n label lookup. */
  id: string;
  /** Canonical lowercase hex. */
  hex: string;
}

/**
 * Mid-tone shades on purpose. The folder icon is a stroked outline that takes
 * its colour from the row, and the sidebar has a light and a dark theme, so
 * each colour has to stay legible against both backgrounds. Pale tints wash
 * out on white and near-black ones vanish in dark mode.
 */
export const FOLDER_COLORS: readonly FolderColor[] = [
  { id: 'red', hex: '#e05561' },
  { id: 'orange', hex: '#e0842b' },
  { id: 'yellow', hex: '#c8a020' },
  { id: 'green', hex: '#3fa65a' },
  { id: 'teal', hex: '#22a2a2' },
  { id: 'blue', hex: '#3d8bfd' },
  { id: 'purple', hex: '#9061f9' },
  { id: 'pink', hex: '#e0507a' },
];

const BY_HEX = new Map(FOLDER_COLORS.map(c => [c.hex, c]));

/**
 * Accepts a colour only when it is one of ours, otherwise null.
 *
 * Settings live in localStorage as plain JSON that anyone can edit, and this
 * value ends up in an inline style, so the palette doubles as an allow-list.
 * It also keeps the stored data and the swatches in the picker from drifting
 * apart: a colour that cannot be shown cannot be stored either.
 */
export function normalizeFolderColor(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  return BY_HEX.has(value) ? value : null;
}

/** Drops anything unrecognised, so one bad entry cannot poison the whole map. */
export function sanitizeFolderColors(
  raw: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [path, color] of Object.entries(raw)) {
    const hex = normalizeFolderColor(color);
    if (hex) out[path] = hex;
  }
  return out;
}

const normalizeSeparators = (path: string): string => path.replace(/\\/g, '/');

/**
 * Rewrites the keys of a colour map after a folder was renamed or moved.
 *
 * Colours are keyed by absolute path, so without this a rename silently drops
 * the colour of the folder and of every coloured folder beneath it. Returns the
 * original object when nothing matched, which lets the caller skip a pointless
 * settings write.
 */
export function remapFolderColors(
  colors: Record<string, string>,
  from: string,
  to: string,
): Record<string, string> {
  const fromKey = normalizeSeparators(from);
  const out: Record<string, string> = {};
  let changed = false;

  for (const [path, color] of Object.entries(colors)) {
    const key = normalizeSeparators(path);
    if (key === fromKey) {
      out[to] = color;
      changed = true;
    } else if (key.startsWith(`${fromKey}/`)) {
      // Keep the tail exactly as stored, separators and all, and only swap the
      // renamed prefix. Both spellings have the same length, so the offset holds.
      out[`${to}${path.slice(from.length)}`] = color;
      changed = true;
    } else {
      out[path] = color;
    }
  }

  return changed ? out : colors;
}
