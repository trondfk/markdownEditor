// ABOUTME: Builds a Cursor-style inline diff from AI write/edit tool arguments.
// ABOUTME: Chat change cards render hunks here; the full overlay still uses generateDiff.

import { generateDiff, type DiffLine, type DiffStats } from '../composables/useDiffPreview';
import { coerceToolArgs } from './ai-tool-kind';

export interface ChangeDiff {
  lines: DiffLine[];
  stats: DiffStats;
}

export type CardDiffRow =
  | { kind: 'line'; line: DiffLine }
  | { kind: 'gap'; hidden: number };

const PATCH_MARK = /\*\*\* (?:Begin Patch|End Patch|Add File:|Update File:|Delete File:)/;
const UNIFIED_HUNK = /^@@ /m;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function looksLikePatch(text: string): boolean {
  return PATCH_MARK.test(text) || UNIFIED_HUNK.test(text);
}

/** Reconstruct old/new text from an apply_patch or unified-diff blob. */
export function patchToOldNew(patch: string): { oldText: string; newText: string } | null {
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (
      line.startsWith('*** Begin Patch')
      || line.startsWith('*** End Patch')
      || line.startsWith('*** End of File')
      || /^\*\*\* (Add|Update|Delete) File:/.test(line)
      || line.startsWith('*** Move to:')
      || line.startsWith('diff ')
      || line.startsWith('index ')
      || line.startsWith('--- ')
      || line.startsWith('+++ ')
    ) {
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (line.startsWith('+')) {
      inHunk = true;
      newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith('-')) {
      inHunk = true;
      oldLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(' ')) {
      inHunk = true;
      const body = line.slice(1);
      oldLines.push(body);
      newLines.push(body);
      continue;
    }
    if (!inHunk || line.length === 0) continue;
    oldLines.push(line);
    newLines.push(line);
  }

  if (oldLines.length === 0 && newLines.length === 0) return null;
  return { oldText: oldLines.join('\n'), newText: newLines.join('\n') };
}

function diffFromPatchText(patch: string): ChangeDiff | null {
  const pair = patchToOldNew(patch);
  if (!pair) return null;
  return generateDiff(pair.oldText, pair.newText);
}

function firstPatchFromChanges(changes: unknown): string | null {
  if (Array.isArray(changes)) {
    for (const item of changes) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const patch = asString(rec.diff) ?? asString(rec.patch) ?? asString(rec.input);
      if (patch && looksLikePatch(patch)) return patch;
    }
    return null;
  }
  if (changes && typeof changes === 'object') {
    for (const value of Object.values(changes as Record<string, unknown>)) {
      if (typeof value === 'string' && looksLikePatch(value)) return value;
      if (value && typeof value === 'object') {
        const rec = value as Record<string, unknown>;
        const patch = asString(rec.diff) ?? asString(rec.patch);
        if (patch && looksLikePatch(patch)) return patch;
      }
    }
  }
  return null;
}

/** Diff from the tool-args payload the agent streamed (available before disk reload). */
export function diffFromToolArgs(argsText: string): ChangeDiff | null {
  const coerced = coerceToolArgs(argsText);
  if (coerced == null) return null;

  if (typeof coerced === 'string') {
    return looksLikePatch(coerced) ? diffFromPatchText(coerced) : null;
  }

  const oldS = asString(coerced.old_string) ?? asString(coerced.oldString) ?? asString(coerced.old_str);
  const newS = asString(coerced.new_string) ?? asString(coerced.newString) ?? asString(coerced.new_str);
  if (oldS != null && newS != null) return generateDiff(oldS, newS);

  const patch = asString(coerced.input)
    ?? asString(coerced.patch)
    ?? asString(coerced.diff)
    ?? (typeof coerced.changes === 'string' ? coerced.changes : firstPatchFromChanges(coerced.changes));
  if (patch && looksLikePatch(patch)) return diffFromPatchText(patch);

  const content = asString(coerced.content) ?? asString(coerced.contents) ?? asString(coerced.new_content);
  if (content != null) return generateDiff('', content);

  return null;
}

/**
 * Snapshot-vs-file is the real document when it actually differs. Args hunks
 * win when the snapshot was taken after the write (identical files, empty diff).
 */
export function preferFileDiff(file: ChangeDiff | null, args: ChangeDiff | null): ChangeDiff | null {
  if (file && file.stats.additions + file.stats.deletions > 0) return file;
  return args ?? file;
}

/** Keep changed lines plus a little context; hide the rest behind gap rows. */
export function collapseDiffRows(lines: DiffLine[], context = 2): CardDiffRow[] {
  if (lines.length === 0) return [];
  const keep = new Uint8Array(lines.length);
  let anyChange = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'unchanged') continue;
    anyChange = true;
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    keep.fill(1, from, to + 1);
  }
  if (!anyChange) return [];

  const rows: CardDiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!keep[i]) {
      let j = i;
      while (j < lines.length && !keep[j]) j += 1;
      rows.push({ kind: 'gap', hidden: j - i });
      i = j;
      continue;
    }
    rows.push({ kind: 'line', line: lines[i] });
    i += 1;
  }
  return rows;
}
