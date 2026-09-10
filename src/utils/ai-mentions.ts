// ABOUTME: Parses @mentions in the AI composer and flattens the workspace tree.
// ABOUTME: Keeps picker logic out of the Vue component so it can be unit-tested.

import type { WorkspaceNode } from '../services/workspaceFs';

export interface MentionItem {
  path: string;
  name: string;
  kind: 'file' | 'folder';
}

export const ATTACHED_EXCERPT_MAX = 8 * 1024;

export function flattenMentions(node: WorkspaceNode | null): MentionItem[] {
  if (!node) return [];
  const out: MentionItem[] = [];
  const walk = (n: WorkspaceNode) => {
    out.push({ path: n.path, name: n.name, kind: n.kind });
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  return out;
}

/** Token starting with @ just before `caret`. Null when the user is not mentioning. */
export function atQuery(input: string, caret: number): { start: number; query: string } | null {
  const i = Math.max(0, Math.min(caret, input.length));
  let start = i;
  while (start > 0) {
    const ch = input[start - 1];
    if (/\s/.test(ch)) break;
    start -= 1;
  }
  if (input[start] !== '@') return null;
  return { start, query: input.slice(start + 1, i) };
}

export function filterMentions(items: MentionItem[], query: string): MentionItem[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((it) => it.name.toLowerCase().includes(q) || it.path.toLowerCase().includes(q))
    : items;
  return filtered.slice(0, 30);
}

export function applyMention(
  input: string,
  caret: number,
  _item: MentionItem,
): { text: string; caret: number } | null {
  const hit = atQuery(input, caret);
  if (!hit) return null;
  const before = input.slice(0, hit.start);
  const after = input.slice(caret);
  const insert = '';
  return { text: before + insert + after, caret: before.length };
}
