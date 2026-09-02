import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import type { Tab } from '../../composables/useTabs';
import { useTabSerializer } from '../../composables/useTabSerializer';

const makeTab = (overrides: Partial<Tab> = {}): Tab => ({
  id: 'tab-1',
  filePath: 'D:/notes/doc.md',
  fileName: 'doc.md',
  content: '<h1>Title</h1><p>Body</p>',
  hasChanges: true,
  scrollTop: 0,
  originalMarkdown: '# Title\n\nBody',
  ...overrides,
});

const setup = (
  overrides: Partial<Parameters<typeof useTabSerializer>[0]> = {},
) =>
  useTabSerializer({
    activeTabId: ref('tab-1'),
    activePaneId: ref('left'),
    getActiveMarkdownOverride: () => null,
    getMountedEditorHtml: () => '<h1>Title</h1><p>Body</p>',
    isMarkdownFirst: () => false,
    ...overrides,
  });

describe('useTabSerializer', () => {
  describe('visual mode (WYSIWYG editor mounted)', () => {
    it('serializes the active tab from the live editor', () => {
      const { getTabMarkdown } = setup({
        getMountedEditorHtml: () => '<h1>Live</h1><p>Fresh text</p>',
      });

      const md = getTabMarkdown('left', makeTab());

      expect(md).toContain('Live');
      expect(md).toContain('Fresh text');
    });

    it('serializes an inactive tab from its cached content', () => {
      const { getTabMarkdown } = setup();

      const md = getTabMarkdown('left', makeTab({ id: 'other', content: '<p>Cached</p>' }));

      expect(md).toContain('Cached');
    });

    it('treats a tab in a different pane as inactive', () => {
      const getMountedEditorHtml = vi.fn(() => '<p>active pane</p>');
      const { getTabMarkdown } = setup({ getMountedEditorHtml });

      const md = getTabMarkdown('right', makeTab({ content: '<p>right pane</p>' }));

      expect(md).toContain('right pane');
      expect(getMountedEditorHtml).not.toHaveBeenCalled();
    });
  });

  describe('WYSIWYG editor unmounted', () => {
    // Regression: getEditorContent() used to return the '<p></p>' placeholder
    // here, which serializes to '' and got written over the user's file.
    it('returns null for the active tab when no override is available', () => {
      const { getTabMarkdown } = setup({
        getMountedEditorHtml: () => null,
        getActiveMarkdownOverride: () => null,
      });

      expect(getTabMarkdown('left', makeTab())).toBeNull();
    });

    it('never returns an empty string in place of real content', () => {
      const { getTabMarkdown } = setup({ getMountedEditorHtml: () => null });

      expect(getTabMarkdown('left', makeTab())).not.toBe('');
    });

    it('uses the code-view source when one is supplied', () => {
      const { getTabMarkdown } = setup({
        getMountedEditorHtml: () => null,
        getActiveMarkdownOverride: () => '# Edited in code view',
      });

      expect(getTabMarkdown('left', makeTab())).toBe('# Edited in code view');
    });

    it('still serializes inactive tabs from cache', () => {
      const { getTabMarkdown } = setup({ getMountedEditorHtml: () => null });

      const md = getTabMarkdown('left', makeTab({ id: 'other', content: '<p>Cached</p>' }));

      expect(md).toContain('Cached');
    });
  });

  describe('markdown-first (large) tabs', () => {
    it('reads pendingMarkdown rather than the empty cached HTML', () => {
      const { getTabMarkdown } = setup({ isMarkdownFirst: () => true });

      const tab = makeTab({ id: 'other', content: '', pendingMarkdown: '# Big document' });

      expect(getTabMarkdown('left', tab)).toBe('# Big document');
    });

    it('prefers the live override for the active large tab', () => {
      const { getTabMarkdown } = setup({
        isMarkdownFirst: () => true,
        getMountedEditorHtml: () => null,
        getActiveMarkdownOverride: () => '# Live large edit',
      });

      const tab = makeTab({ content: '', pendingMarkdown: '# Stale' });

      expect(getTabMarkdown('left', tab)).toBe('# Live large edit');
    });

    it('returns null instead of empty when pendingMarkdown is missing', () => {
      const { getTabMarkdown } = setup({ isMarkdownFirst: () => true });

      const tab = makeTab({ id: 'other', content: '', pendingMarkdown: null });

      expect(getTabMarkdown('left', tab)).toBeNull();
    });
  });

  describe('empty override is honoured', () => {
    it('returns the empty string when the user genuinely cleared the document', () => {
      const { getTabMarkdown } = setup({
        getMountedEditorHtml: () => null,
        getActiveMarkdownOverride: () => '',
      });

      // '' is a real answer here, distinct from null ("cannot determine").
      expect(getTabMarkdown('left', makeTab())).toBe('');
    });
  });
});
