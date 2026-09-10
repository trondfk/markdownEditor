import { describe, it, expect } from 'vitest';
import {
  applyMention,
  atQuery,
  filterMentions,
  flattenMentions,
  type MentionItem,
} from '../../utils/ai-mentions';
import type { WorkspaceNode } from '../../services/workspaceFs';

describe('ai-mentions', () => {
  it('finds an @query at the caret', () => {
    const s = 'look at @no';
    expect(atQuery(s, s.length)).toEqual({ start: 8, query: 'no' });
    expect(atQuery('hello', 5)).toBeNull();
  });

  it('filters by name', () => {
    const items: MentionItem[] = [
      { path: '/r/a.md', name: 'a.md', kind: 'file' },
      { path: '/r/notes.md', name: 'notes.md', kind: 'file' },
    ];
    expect(filterMentions(items, 'note').map(i => i.name)).toEqual(['notes.md']);
  });

  it('flattens files and folders', () => {
    const tree: WorkspaceNode = {
      name: 'root',
      path: '/r',
      kind: 'folder',
      children: [
        { name: 'a.md', path: '/r/a.md', kind: 'file' },
        { name: 'sub', path: '/r/sub', kind: 'folder', children: [] },
      ],
    };
    const names = flattenMentions(tree).map(i => i.name);
    expect(names).toContain('root');
    expect(names).toContain('a.md');
    expect(names).toContain('sub');
  });

  it('removes the @token when applying a mention', () => {
    const src = 'see @no';
    const out = applyMention(src, src.length, { path: '/r/a.md', name: 'notes.md', kind: 'file' });
    expect(out?.text).toBe('see ');
  });
});
