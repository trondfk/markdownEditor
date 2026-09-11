// ABOUTME: Tests for Cursor-style inline diffs built from AI write/edit tool args.
// ABOUTME: Covers old/new strings, apply_patch blobs, and collapsed hunk context.
import { describe, expect, it } from 'vitest';
import { collapseDiffRows, diffFromToolArgs, patchToOldNew, preferFileDiff } from '../../utils/ai-change-diff';

describe('diffFromToolArgs', () => {
  it('diffs old_string against new_string', () => {
    const diff = diffFromToolArgs(JSON.stringify({
      file_path: '/tmp/n.md',
      old_string: 'hello world',
      new_string: 'hello there',
    }));
    expect(diff).not.toBeNull();
    expect(diff!.stats.deletions).toBeGreaterThan(0);
    expect(diff!.stats.additions).toBeGreaterThan(0);
    expect(diff!.lines.some(l => l.type === 'removed' && l.content.includes('hello world'))).toBe(true);
    expect(diff!.lines.some(l => l.type === 'added' && l.content.includes('hello there'))).toBe(true);
  });

  it('parses an apply_patch blob', () => {
    const patch = `*** Begin Patch
*** Update File: notes.md
@@
 hello
-world
+there
*** End Patch`;
    const diff = diffFromToolArgs(JSON.stringify({ input: patch }));
    expect(diff).not.toBeNull();
    expect(diff!.lines.some(l => l.type === 'removed' && l.content === 'world')).toBe(true);
    expect(diff!.lines.some(l => l.type === 'added' && l.content === 'there')).toBe(true);
  });

  it('treats write content as a new-file diff', () => {
    const diff = diffFromToolArgs(JSON.stringify({
      file_path: '/tmp/n.md',
      content: 'line one\nline two',
    }));
    expect(diff?.stats.additions).toBe(2);
    expect(diff?.stats.deletions).toBe(0);
  });
});

describe('patchToOldNew', () => {
  it('rebuilds both sides of a hunk', () => {
    const pair = patchToOldNew('@@\n keep\n-old\n+new\n');
    expect(pair).toEqual({ oldText: 'keep\nold', newText: 'keep\nnew' });
  });
});

describe('preferFileDiff', () => {
  it('keeps args when the file diff is empty', () => {
    const args = diffFromToolArgs(JSON.stringify({ old_string: 'a', new_string: 'b' }))!;
    const empty = { lines: [], stats: { additions: 0, deletions: 0 } };
    expect(preferFileDiff(empty, args)).toBe(args);
  });
});

describe('collapseDiffRows', () => {
  it('hides unchanged lines outside the hunk context', () => {
    const diff = diffFromToolArgs(JSON.stringify({
      old_string: 'a\nb\nc\nchange me\nd\ne\nf',
      new_string: 'a\nb\nc\nchanged\nd\ne\nf',
    }))!;
    const rows = collapseDiffRows(diff.lines, 1);
    const gaps = rows.filter(r => r.kind === 'gap');
    expect(gaps.length).toBeGreaterThan(0);
    expect(rows.some(r => r.kind === 'line' && r.line.content.includes('changed'))).toBe(true);
  });
});
