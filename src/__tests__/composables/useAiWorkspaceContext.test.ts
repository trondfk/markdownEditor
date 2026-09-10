import { describe, it, expect } from 'vitest';
import {
  withWorkspaceReadAccess,
  withWorkspaceWriteAccess,
  accessMapForSend,
} from '../../composables/useAiWorkspaceContext';
import type { AccessMap } from '../../services/aiCommands';

function makeMap(): AccessMap {
  return {
    readPaths: ['/r/a.md'],
    writePaths: ['/w/a.md'],
    tools: { fileRead: true, fileWrite: true, bash: false, network: false },
  };
}

describe('withWorkspaceReadAccess', () => {
  it('appends workspace root to readPaths', () => {
    const out = withWorkspaceReadAccess(makeMap(), '/work');
    expect(out?.readPaths).toEqual(['/r/a.md', '/work']);
  });

  it('does not modify writePaths', () => {
    const before = makeMap();
    const out = withWorkspaceReadAccess(before, '/work');
    expect(out?.writePaths).toEqual(['/w/a.md']);
  });

  it('returns input unchanged when workspaceRoot is empty', () => {
    const before = makeMap();
    const out = withWorkspaceReadAccess(before, '');
    expect(out).toBe(before);
  });

  it('returns null when accessMap is null', () => {
    expect(withWorkspaceReadAccess(null, '/work')).toBeNull();
  });

  it('does not duplicate when workspace root already in readPaths', () => {
    const m = makeMap();
    m.readPaths = ['/work'];
    const out = withWorkspaceReadAccess(m, '/work');
    expect(out?.readPaths).toEqual(['/work']);
  });

  it('produces a new object (does not mutate input)', () => {
    const before = makeMap();
    const out = withWorkspaceReadAccess(before, '/work');
    expect(out).not.toBe(before);
    expect(before.readPaths).toEqual(['/r/a.md']);
  });
});

describe('withWorkspaceWriteAccess', () => {
  it('appends workspace root to writePaths when enabled', () => {
    const out = withWorkspaceWriteAccess(makeMap(), '/work', true);
    expect(out?.writePaths).toEqual(['/w/a.md', '/work']);
  });

  it('does not append when disabled', () => {
    const before = makeMap();
    expect(withWorkspaceWriteAccess(before, '/work', false)).toBe(before);
  });
});

describe('accessMapForSend', () => {
  it('Ask mode drops write even when workspaceWrite is on', () => {
    const out = accessMapForSend(makeMap(), '/work', 'ask', true);
    expect(out?.tools.fileWrite).toBe(false);
    expect(out?.readPaths).toContain('/work');
    expect(out?.writePaths).not.toContain('/work');
  });

  it('Agent with workspaceWrite adds the root to writePaths', () => {
    const out = accessMapForSend(makeMap(), '/work', 'agent', true);
    expect(out?.tools.fileWrite).toBe(true);
    expect(out?.writePaths).toEqual(['/w/a.md', '/work']);
  });
});
