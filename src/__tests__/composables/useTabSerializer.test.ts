import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import type { Tab } from '../../composables/useTabs';
import { useTabSerializer, type UseTabSerializerOptions } from '../../composables/useTabSerializer';

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
  overrides: Partial<UseTabSerializerOptions> & {
    getActiveMarkdownOverride?: () => string | null;
    getMountedEditorHtml?: () => string | null;
  } = {},
) => {
  const getOverride = overrides.getActiveMarkdownOverride ?? (() => null);
  const getHtml = overrides.getMountedEditorHtml ?? (() => '<h1>Title</h1><p>Body</p>');
  return useTabSerializer({
    activeTabId: ref('tab-1'),
    activePaneId: ref('left'),
    getEditorSource: () => {
      const markdown = getOverride();
      if (markdown !== null) return { tabId: 'tab-1', markdown };
      const html = getHtml();
      return html === null ? null : { tabId: 'tab-1', html };
    },
    isMarkdownFirst: () => false,
    ...overrides,
  });
};

describe('useTabSerializer', () => {
  describe('close-save source ownership', () => {
    it('prefers the pinned document Markdown while another editor is still mounted', () => {
      const { getTabMarkdown } = setup({ getMountedEditorHtml: () => '<p>Other document</p>' });
      const tab = makeTab({ markdown: 'Pinned unsaved work' });
      expect(getTabMarkdown('left', tab)).toBe('Pinned unsaved work');
      expect(tab.markdown).toBe('Pinned unsaved work');
    });

    it('does not accept a stale raw-source override just because the tab became active', () => {
      const { getTabMarkdown } = setup({ getActiveMarkdownOverride: () => 'Other document' });
      expect(getTabMarkdown('left', makeTab({ markdown: 'Pinned unsaved work' }))).toBe('Pinned unsaved work');
    });

    it('rejects a mounted source belonging to a different document when no canonical source is ready', () => {
      const { getTabMarkdown } = setup({ getEditorSource: () => ({ tabId: 'other', html: '<p>Other work</p>' }) });
      expect(getTabMarkdown('left', makeTab())).toBeNull();
    });

    it('honours authoritative empty content even while a stale editor is mounted', () => {
      const { getTabMarkdown } = setup({ getMountedEditorHtml: () => '<p>Stale work</p>' });
      expect(getTabMarkdown('left', makeTab({ markdown: '' }))).toBe('');
    });
  });
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
    it('uses the authoritative source when the inactive lazy cache is delayed', () => {
      const { getTabMarkdown } = setup({ isMarkdownFirst: () => true });
      const tab = makeTab({ id: 'other', content: '', pendingMarkdown: 'Old cache', markdown: 'Current edits' });
      expect(getTabMarkdown('left', tab)).toBe('Current edits');
    });

    it('uses the authoritative source when inactive raw-source edits have stale HTML', () => {
      const { getTabMarkdown } = setup();
      const tab = makeTab({ id: 'other', content: '<p>Old cache</p>', markdown: 'Current edits' });
      expect(getTabMarkdown('right', tab)).toBe('Current edits');
    });
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
