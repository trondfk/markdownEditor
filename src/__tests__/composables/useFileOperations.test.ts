import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed } from 'vue';
import type { Tab } from '../../composables/useTabs';
import type { WriteFileOptions } from '@tauri-apps/plugin-fs';
import { setDocumentMarkdown } from '../../utils/save-state';
import * as atomicWrite from '../../utils/atomic-write';

// ============================================================
// Mocks — must be hoisted above imports
// ============================================================

const mockReadTextFile = vi.fn();
const mockWriteTextFile = vi.fn();
const mockRename = vi.fn();
const mockRemove = vi.fn();
const mockFiles = new Map<string, string>();

const writeMockFile = (files: Map<string, string>, path: string, content: string, options?: WriteFileOptions) => {
  if (options?.createNew && files.has(path)) throw new Error(`EEXIST: ${path}`);
  if (!options?.createNew && options?.create === false && !files.has(path)) throw new Error(`ENOENT: ${path}`);
  files.set(path, content);
};
const mockOpenDialog = vi.fn();
const mockSaveDialog = vi.fn();
const mockOpenShell = vi.fn();
const mockGetCurrentWindow = vi.fn(() => ({
  isMaximized: vi.fn(async () => false),
  maximize: vi.fn(async () => {}),
  unmaximize: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => mockOpenDialog(...args),
  save: (...args: unknown[]) => mockSaveDialog(...args),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: (...args: unknown[]) => mockOpenShell(...args),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mockGetCurrentWindow(),
}));

// Spread the real module so `generateSlug` stays the genuine implementation —
// the anchor fallback compares against it, and a hand-copied stub would keep
// passing after the real slug rules change.
vi.mock('../../utils/markdown-converter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/markdown-converter')>()),
  htmlToMarkdown: vi.fn((html: string) => `md:${html}`),
  markdownToHtml: vi.fn((md: string) => `<p>${md}</p>`),
  detectLineEnding: vi.fn(() => '\n'),
  applyLineEnding: vi.fn((content: string) => content),
}));

vi.mock('../../constants', () => ({
  EMPTY_TAB_CONTENT: '<p></p>',
  DEFAULT_FILE_NAME: 'dokument.md',
  DOM_SELECTORS: {
    EDITOR_CONTAINER: '.editor-container',
    ACTIVE_EDITOR_CONTAINER: '.editor-pane.active .editor-container',
  },
  TIMING: { MAXIMIZE_ANIMATION_DELAY: 0 },
  LARGE_FILE_CHAR_THRESHOLD: 1_000_000,
}));

import { useFileOperations } from '../../composables/useFileOperations';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdown-converter';

// ============================================================
// Helpers
// ============================================================

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const makeTab = (overrides: Partial<Tab> = {}): Tab => ({
  id: 'tab-1',
  filePath: '/test/file.md',
  fileName: 'file.md',
  content: '<p>hello</p>',
  hasChanges: true,
  scrollTop: 0,
  originalMarkdown: '# hello',
  ...overrides,
});

const makeOptions = (tabOverrides: Partial<Tab> = {}, extraOptions: Record<string, unknown> = {}) => {
  const tab = makeTab(tabOverrides);
  const tabs = ref<Tab[]>([tab]);
  const activeTabId = ref(tab.id);
  const activeTab = computed(() => tabs.value[0]);
  const getEditorHtml = vi.fn(() => tab.content);
  const setEditorContent = vi.fn();
  const createNewTab = vi.fn(() => 'new-tab-id');
  const switchToTab = vi.fn(async () => {});
  const findTabByFilePath = vi.fn(() => undefined);

  return {
    options: {
      reserveSaveTarget: vi.fn(async (_state: unknown, filePath: string) => ({ filePath, created: false, finish: vi.fn(async () => true) })),
      tabs,
      activeTabId,
      activeTab,
      findTabByFilePath,
      createNewTab,
      switchToTab,
      getEditorHtml,
      setEditorContent,
      ...extraOptions,
    },
    tabs,
    tab,
    getEditorHtml,
    setEditorContent,
    createNewTab,
    switchToTab,
    findTabByFilePath,
  };
};

// ============================================================
// Tests
// ============================================================

describe('useFileOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.clear();
    mockFiles.set('/test/file.md', '# hello');
    mockWriteTextFile.mockImplementation(async (path, content, options) => writeMockFile(mockFiles, path, content, options));
    mockRename.mockImplementation(async (from, to) => {
      if (!mockFiles.has(from)) throw new Error(`ENOENT rename: ${from}`);
      mockFiles.set(to, mockFiles.get(from)!); mockFiles.delete(from);
    });
    mockRemove.mockImplementation(async path => {
      if (!mockFiles.has(path)) throw new Error(`ENOENT remove: ${path}`);
      mockFiles.delete(path);
    });
    mockReadTextFile.mockResolvedValue('# hello');
  });

  // ----------------------------------------------------------
  // atomicWriteFile (via saveFile)
  // ----------------------------------------------------------

  describe('atomicWriteFile', () => {
    it('writes to .tmp file first, then renames to final path', async () => {
      // readTextFile is called twice: once for .tmp verification, once for pre-save conflict check
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return '# hello'; // disk content matches originalMarkdown → no conflict
      });

      const { options } = makeOptions();
      const { saveFile } = useFileOperations(options);

      await saveFile();

      const tmpPath = mockWriteTextFile.mock.calls[0][0];
      expect(tmpPath).toMatch(/^\/test\/mermark-[0-9a-f-]{36}\.tmp$/);
      expect(mockWriteTextFile).toHaveBeenCalledWith(tmpPath, '', { createNew: true });
      expect(mockWriteTextFile).toHaveBeenCalledWith(tmpPath, 'md:<p>hello</p>', { create: false });
      expect(mockRename).toHaveBeenCalledWith(tmpPath, '/test/file.md');
    });

    it('removes .tmp file when rename succeeds (no leftover temp)', async () => {
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return '# hello';
      });

      const { options } = makeOptions();
      const { saveFile } = useFileOperations(options);

      await saveFile();

      // remove should NOT be called on success path
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('removes .tmp file and rethrows when writeTextFile fails', async () => {
      mockWriteTextFile.mockImplementation(async (path, content, options) => {
        writeMockFile(mockFiles, path, '', options);
        if (content) throw new Error('disk full');
      });
      const markSaveEnd = vi.fn();

      const { options, tabs } = makeOptions();
      const { saveFile } = useFileOperations({ ...options, markSaveEnd });

      // saveFile swallows errors internally (console.error) — verify .tmp cleanup
      await saveFile();

      expect(mockRemove).toHaveBeenCalledWith(mockWriteTextFile.mock.calls[0][0]);
      expect([...mockFiles.keys()]).toEqual(['/test/file.md']);
      // tab should remain unchanged (hasChanges still true)
      expect(tabs.value[0].hasChanges).toBe(true);
    });

    it('removes .tmp and throws when verification fails (written !== content)', async () => {
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'CORRUPTED_CONTENT';
        return '# hello';
      });

      const { options, tabs } = makeOptions();
      const { saveFile } = useFileOperations(options);

      await saveFile();

      // .tmp should be cleaned up on verification failure
      expect(mockRemove).toHaveBeenCalledWith(mockWriteTextFile.mock.calls[0][0]);
      // tab should remain unsaved
      expect(tabs.value[0].hasChanges).toBe(true);
    });

    it('calls markSaveStart before write and markSaveEnd after rename', async () => {
      const calls: string[] = [];
      const markSaveStart = vi.fn(() => calls.push('start'));
      const markSaveEnd = vi.fn(() => calls.push('end'));

      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return '# hello';
      });

      const { options } = makeOptions();
      const { saveFile } = useFileOperations({ ...options, markSaveStart, markSaveEnd });

      await saveFile();

      expect(calls).toEqual(['start', 'end']);
      expect(markSaveStart).toHaveBeenCalledWith('/test/file.md');
      expect(markSaveEnd).toHaveBeenCalledWith('/test/file.md', expect.any(String));
    });
  });

  // ----------------------------------------------------------
  // Code view fix — getMarkdownOverride
  // ----------------------------------------------------------

  describe('getMarkdownOverride (code view save)', () => {
    it('uses raw markdown from override instead of converting editor HTML', async () => {
      const rawMarkdown = '# Raw from code editor\n\nNo conversion needed.';
      const getMarkdownOverride = vi.fn(() => rawMarkdown);

      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return rawMarkdown;
        return '# hello'; // disk matches → no conflict
      });

      const { options } = makeOptions();
      const { saveFile } = useFileOperations({ ...options, getMarkdownOverride });

      await saveFile();

      // Should write the raw override content, NOT the HTML→markdown conversion
      expect(mockWriteTextFile).toHaveBeenCalledWith(expect.stringMatching(/^\/test\/mermark-[0-9a-f-]{36}\.tmp$/), rawMarkdown, { create: false });
      expect(htmlToMarkdown).not.toHaveBeenCalled();
    });

    it('falls back to HTML→markdown when override returns null (visual mode)', async () => {
      const getMarkdownOverride = vi.fn(() => null);

      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return '# hello';
      });

      const { options } = makeOptions();
      const { saveFile } = useFileOperations({ ...options, getMarkdownOverride });

      await saveFile();

      expect(htmlToMarkdown).toHaveBeenCalledWith('<p>hello</p>');
    });

    it('updates tab.originalMarkdown with override content after save', async () => {
      const rawMarkdown = '# Saved from code view';
      const getMarkdownOverride = vi.fn(() => rawMarkdown);

      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return rawMarkdown;
        return '# hello';
      });

      const { options, tabs } = makeOptions();
      const { saveFile } = useFileOperations({ ...options, getMarkdownOverride });

      await saveFile();

      expect(tabs.value[0].originalMarkdown).toBe(rawMarkdown);
      expect(tabs.value[0].hasChanges).toBe(false);
    });

    it('does NOT update tab.content when saving from code view (html is null)', async () => {
      const rawMarkdown = '# code view content';
      const getMarkdownOverride = vi.fn(() => rawMarkdown);
      const originalContent = '<p>hello</p>';

      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return rawMarkdown;
        return '# hello';
      });

      const { options, tabs } = makeOptions({ content: originalContent });
      const { saveFile } = useFileOperations({ ...options, getMarkdownOverride });

      await saveFile();

      // content (cached HTML) should remain unchanged — code view doesn't produce fresh HTML
      expect(tabs.value[0].content).toBe(originalContent);
    });
  });

  // Ctrl+S is exempt from the truncation guard on purpose, because emptying a
  // file by hand is a real edit. It must still refuse to write when nothing can
  // say what the document contains, instead of falling through to the WYSIWYG
  // editor and serializing its '<p></p>' placeholder into an empty file.
  describe('getSaveMarkdown (explicit save floor)', () => {
    it('writes what the serializer resolved rather than converting editor HTML', async () => {
      const resolved = '# From the serializer';
      const getSaveMarkdown = vi.fn(() => resolved);

      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return resolved;
        return '# hello';
      });

      const { options } = makeOptions();
      const { saveFile } = useFileOperations({ ...options, getSaveMarkdown });

      await saveFile();

      expect(mockWriteTextFile).toHaveBeenCalledWith(expect.stringMatching(/^\/test\/mermark-[0-9a-f-]{36}\.tmp$/), resolved, { create: false });
    });

    it('abandons the save when no editor can supply the content', async () => {
      const onSaveFailed = vi.fn();
      const { options } = makeOptions();
      const { saveFile } = useFileOperations({
        ...options,
        getSaveMarkdown: () => null,
        onSaveFailed,
      });

      await saveFile();

      expect(mockWriteTextFile).not.toHaveBeenCalled();
      expect(mockRename).not.toHaveBeenCalled();
      expect(onSaveFailed).toHaveBeenCalled();
    });

    it('leaves the tab dirty when the save was abandoned', async () => {
      const { options, tabs } = makeOptions({ hasChanges: true });
      const { saveFile } = useFileOperations({ ...options, getSaveMarkdown: () => null });

      await saveFile();

      expect(tabs.value[0].hasChanges).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // Pre-save conflict detection
  // ----------------------------------------------------------

  describe('checkPreSaveConflict', () => {
    it('skips save when conflict detected and user cancels', async () => {
      // Disk content differs from originalMarkdown → conflict
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return '# DIFFERENT disk content'; // conflict!
      });

      const onPreSaveConflict = vi.fn(async () => 'cancel' as const);
      const { options, tabs } = makeOptions();
      const { saveFile } = useFileOperations({ ...options, onPreSaveConflict });

      await saveFile();

      expect(onPreSaveConflict).toHaveBeenCalledWith('/test/file.md', '# DIFFERENT disk content', 'md:<p>hello</p>');
      // File should NOT be written since user cancelled
      expect(mockWriteTextFile).not.toHaveBeenCalled();
      expect(tabs.value[0].hasChanges).toBe(true);
    });

    it('proceeds with save when conflict detected but user confirms', async () => {
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return '# DIFFERENT disk content'; // conflict
      });

      const onPreSaveConflict = vi.fn(async () => 'save' as const);
      const { options, tabs } = makeOptions();
      const { saveFile } = useFileOperations({ ...options, onPreSaveConflict });

      await saveFile();

      expect(onPreSaveConflict).toHaveBeenCalled();
      expect(mockWriteTextFile).toHaveBeenCalled();
      expect(tabs.value[0].hasChanges).toBe(false);
    });

    it('does not call onPreSaveConflict when disk matches originalMarkdown', async () => {
      // Disk content matches originalMarkdown → no conflict
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return '# hello'; // matches originalMarkdown
      });

      const onPreSaveConflict = vi.fn(async () => 'save' as const);
      const { options } = makeOptions({ originalMarkdown: '# hello' });
      const { saveFile } = useFileOperations({ ...options, onPreSaveConflict });

      await saveFile();

      expect(onPreSaveConflict).not.toHaveBeenCalled();
    });

    it('does not call onPreSaveConflict when tab has no originalMarkdown (new file)', async () => {
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return 'some disk content';
      });

      const onPreSaveConflict = vi.fn(async () => 'cancel' as const);
      const { options } = makeOptions({ originalMarkdown: null });
      const { saveFile } = useFileOperations({ ...options, onPreSaveConflict });

      await saveFile();

      expect(onPreSaveConflict).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // saveFile — basic flow
  // ----------------------------------------------------------

  describe('saveFile', () => {
    it('skips save when file exists and has no changes', async () => {
      const { options } = makeOptions({ hasChanges: false });
      const { saveFile } = useFileOperations(options);

      await saveFile();

      expect(mockWriteTextFile).not.toHaveBeenCalled();
    });

    it('shows save dialog when file has no path yet', async () => {
      mockSaveDialog.mockResolvedValue('/new/path/file.md');
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return ''; // no disk conflict
      });

      const { options } = makeOptions({ filePath: null });
      const { saveFile } = useFileOperations(options);

      await saveFile();

      expect(mockSaveDialog).toHaveBeenCalled();
      expect(mockWriteTextFile).toHaveBeenCalledWith(expect.stringMatching(/^\/new\/path\/mermark-[0-9a-f-]{36}\.tmp$/), 'md:<p>hello</p>', { create: false });
    });

    it('updates tab state after successful save', async () => {
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (path.endsWith('.tmp')) return 'md:<p>hello</p>';
        return '# hello';
      });

      const { options, tabs } = makeOptions();
      const { saveFile } = useFileOperations(options);

      await saveFile();

      expect(tabs.value[0].hasChanges).toBe(false);
      expect(tabs.value[0].filePath).toBe('/test/file.md');
    });
  });

  describe('edits and tab changes during save', () => {
    it('saves an explicit close target even when a different document is active', async () => {
      const { options, tabs } = makeOptions({ markdown: 'Pinned A' });
      const target = tabs.value[0];
      const other = makeTab({ id: 'other', filePath: '/test/other.md', markdown: 'Unsaved B' });
      tabs.value.push(other);
      options.activeTabId.value = other.id;
      const files = new Map<string, string>();
      mockWriteTextFile.mockImplementation(async (path, content, options) => writeMockFile(files, path, content, options));
      mockReadTextFile.mockImplementation(async path => {
        if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
        return files.get(path)!;
      });
      mockRename.mockImplementation(async (from, to) => {
        if (!files.has(from)) throw new Error(`ENOENT rename: ${from}`);
        files.set(to, files.get(from)!); files.delete(from);
      });
      mockRemove.mockImplementation(async path => {
        if (!files.has(path)) throw new Error(`ENOENT remove: ${path}`);
        files.delete(path);
      });
      const operations = useFileOperations({ ...options, getSaveMarkdown: () => 'Unsaved B' });
      await operations.saveFile({ tab: target, markdown: target.markdown! });
      expect(files.get('/test/file.md')).toBe('Pinned A');
      expect(files.has('/test/other.md')).toBe(false);
      expect(target.hasChanges).toBe(false);
      expect(tabs.value[1].hasChanges).toBe(true);
    });

    it.each([false, true])('does not mutate or report an explicit unavailable target saved (dirty=%s)', async hasChanges => {
      const { options, tabs } = makeOptions({ hasChanges, markdown: 'Pinned work' });
      const target = tabs.value[0];
      const before = { ...target };
      const saved = await useFileOperations(options).saveFile({ tab: target, markdown: null });
      expect(saved).toBe(false);
      expect(mockWriteTextFile).not.toHaveBeenCalled();
      expect(mockSaveDialog).not.toHaveBeenCalled();
      expect(target).toEqual(before);
    });

    it('retains the explicit document and baseline when its path dialog is cancelled', async () => {
      const { options, tabs } = makeOptions({ filePath: null, originalMarkdown: null, markdown: 'Pinned work' });
      const target = tabs.value[0];
      mockSaveDialog.mockResolvedValueOnce(null);
      const saved = await useFileOperations(options).saveFile({ tab: target, markdown: target.markdown! });
      expect(saved).toBe(false);
      expect(mockWriteTextFile).not.toHaveBeenCalled();
      expect(target.filePath).toBeNull();
      expect(target.originalMarkdown).toBeNull();
      expect(target.markdown).toBe('Pinned work');
      expect(target.hasChanges).toBe(true);
    });

    it('retains the explicit document and baseline when its write fails', async () => {
      const { options, tabs } = makeOptions({ markdown: 'Pinned work' });
      const target = tabs.value[0];
      mockWriteTextFile.mockRejectedValueOnce(new Error('disk full'));
      const saved = await useFileOperations(options).saveFile({ tab: target, markdown: target.markdown! });
      expect(saved).toBe(false);
      expect(target.originalMarkdown).toBe('# hello');
      expect(target.markdown).toBe('Pinned work');
      expect(target.hasChanges).toBe(true);
    });

    const pauseRename = () => {
      const files = new Map<string, string>([['/test/file.md', '# hello']]);
      let release!: () => void;
      let started!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { started = resolve; });
      mockWriteTextFile.mockImplementation(async (path: string, content: string, options?: WriteFileOptions) => {
        writeMockFile(files, path, content, options);
      });
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
        return files.get(path)!;
      });
      mockRename.mockImplementation(async (from: string, to: string) => {
        started();
        await pending;
        if (!files.has(from)) throw new Error(`ENOENT rename: ${from}`);
        files.set(to, files.get(from)!);
        files.delete(from);
      });
      mockRemove.mockImplementation(async (path: string) => {
        if (!files.has(path)) throw new Error(`ENOENT remove: ${path}`);
        files.delete(path);
      });
      return { files, entered, release };
    };

    it('marks the merged document clean when the merge itself is successfully written', async () => {
      const { options, tabs } = makeOptions();
      const paused = pauseRename();
      paused.files.set('/test/file.md', 'External content');
      const saving = useFileOperations({
        ...options,
        getEditorHtml: () => tabs.value[0].content,
        onPreSaveConflict: async () => {
          tabs.value[0].content = '<p>Merged</p>';
          return 'md:<p>Merged</p>';
        },
      }).saveFile();
      await paused.entered;
      paused.release();
      await saving;
      expect(paused.files.get('/test/file.md')).toBe('md:<p>Merged</p>');
      expect(tabs.value[0].content).toBe('<p>Merged</p>');
      expect(tabs.value[0].hasChanges).toBe(false);
      expect(tabs.value[0].originalMarkdown).toBe('md:<p>Merged</p>');
    });

    it('keeps newer visual edits in memory and dirty after the older snapshot is saved', async () => {
      const { options, tabs } = makeOptions();
      options.getEditorHtml.mockImplementation(() => tabs.value[0].content);
      const paused = pauseRename();
      const saving = useFileOperations(options).saveFile();
      await paused.entered;

      tabs.value[0].content = '<p>hello plus recent work</p>';
      setDocumentMarkdown(tabs.value[0], 'md:<p>hello plus recent work</p>');
      paused.release();
      await saving;

      expect(paused.files.get('/test/file.md')).toBe('md:<p>hello</p>');
      expect.soft(tabs.value[0].content).toBe('<p>hello plus recent work</p>');
      expect.soft(tabs.value[0].hasChanges).toBe(true);
      expect(tabs.value[0].originalMarkdown).toBe('md:<p>hello</p>');
    });

    it('keeps the newer baseline and protects edits when an older save acknowledgement arrives last', async () => {
      const { options, tabs } = makeOptions({ content: '<p>A</p>', markdown: 'md:<p>A</p>' });
      const target = tabs.value[0];
      const path = target.filePath!;
      options.getEditorHtml.mockImplementation(() => target.content);
      mockReadTextFile.mockImplementation(async (filePath: string) => {
        if (!mockFiles.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
        return mockFiles.get(filePath)!;
      });
      const writeAtomically = atomicWrite.atomicWriteTextFile;
      let acknowledge!: () => void;
      let committed!: () => void;
      const acknowledgement = new Promise<void>(resolve => { acknowledge = resolve; });
      const firstCommitted = new Promise<void>(resolve => { committed = resolve; });
      // Delay only the frontend acknowledgement, after the real FIFO write finishes.
      const delayedWrite = vi.spyOn(atomicWrite, 'atomicWriteTextFile').mockImplementationOnce(async (...args) => {
        await writeAtomically(...args);
        committed();
        await acknowledgement;
      });

      const operations = useFileOperations(options);
      const first = operations.saveFile();
      try {
        await firstCommitted;
        expect(mockFiles.get(path)).toBe('md:<p>A</p>');

        target.content = '<p>B</p>';
        setDocumentMarkdown(target, 'md:<p>B</p>');
        expect(await operations.saveFile()).toBe(true);
        expect(mockFiles.get(path)).toBe('md:<p>B</p>');
        expect(target.originalMarkdown).toBe('md:<p>B</p>');
        expect(target.hasChanges).toBe(false);

        target.content = '<p>A</p>';
        setDocumentMarkdown(target, 'md:<p>A</p>');
        expect(target.hasChanges).toBe(true);
        const revision = target.editRevision;

        acknowledge();
        const saved = await first;

        expect(mockFiles.get(path)).toBe('md:<p>B</p>');
        expect(target.content).toBe('<p>A</p>');
        expect(target.markdown).toBe('md:<p>A</p>');
        expect(target.editRevision).toBe(revision);
        expect.soft(target.originalMarkdown).toBe('md:<p>B</p>');
        expect.soft(target.hasChanges).toBe(true);
        expect.soft(saved).toBe(false);
      } finally {
        acknowledge();
        await first;
        delayedWrite.mockRestore();
      }
    });

    it.each([
      ['write failure', 'A'], ['write failure', 'B'],
      ['cancelled Save As', 'A'], ['cancelled Save As', 'B'],
    ])('accepts the older disk write after a newer %s while the editor contains %s', async (outcome, currentText) => {
      const { options, tabs } = makeOptions({ content: '<p>A</p>', markdown: 'md:<p>A</p>' });
      const target = tabs.value[0];
      const path = target.filePath!;
      const previousBaseline = target.originalMarkdown;
      options.getEditorHtml.mockImplementation(() => target.content);
      mockReadTextFile.mockImplementation(async (filePath: string) => {
        if (!mockFiles.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
        return mockFiles.get(filePath)!;
      });
      const writeAtomically = atomicWrite.atomicWriteTextFile;
      let acknowledge!: () => void;
      let committed!: () => void;
      const acknowledgement = new Promise<void>(resolve => { acknowledge = resolve; });
      const firstCommitted = new Promise<void>(resolve => { committed = resolve; });
      const delayedWrite = vi.spyOn(atomicWrite, 'atomicWriteTextFile').mockImplementationOnce(async (...args) => {
        await writeAtomically(...args);
        committed();
        await acknowledgement;
      });
      const operations = useFileOperations(options);
      const first = operations.saveFile();
      try {
        await firstCommitted;
        target.content = '<p>B</p>';
        setDocumentMarkdown(target, 'md:<p>B</p>');
        if (outcome === 'write failure') {
          mockRename.mockRejectedValueOnce(new Error('Newer write failed'));
          expect(await operations.saveFile()).toBe(false);
        } else {
          mockSaveDialog.mockResolvedValueOnce(null);
          await operations.saveFileAs();
        }
        expect(mockFiles.get(path)).toBe('md:<p>A</p>');
        expect(target.originalMarkdown).toBe(previousBaseline);
        expect(target.hasChanges).toBe(true);
        expect([...mockFiles.keys()]).toEqual([path]);

        target.content = `<p>${currentText}</p>`;
        setDocumentMarkdown(target, `md:<p>${currentText}</p>`);
        const revision = target.editRevision;
        acknowledge();
        expect(await first).toBe(currentText === 'A');
        expect(target.originalMarkdown).toBe('md:<p>A</p>');
        expect(target.hasChanges).toBe(currentText !== 'A');
        expect(target.content).toBe(`<p>${currentText}</p>`);
        expect(target.markdown).toBe(`md:<p>${currentText}</p>`);
        expect(target.editRevision).toBe(revision);
        expect(mockFiles.get(path)).toBe('md:<p>A</p>');
      } finally {
        acknowledge();
        await first;
        delayedWrite.mockRestore();
      }
    });

    it('does not restore a previous path when the document changes path during saving', async () => {
      const { options, tabs } = makeOptions();
      const paused = pauseRename();
      const saving = useFileOperations(options).saveFile();
      await paused.entered;
      tabs.value[0].filePath = '/test/new-location.md';
      tabs.value[0].fileName = 'new-location.md';
      tabs.value[0].hasChanges = true;
      paused.release();
      await saving;

      expect(paused.files.get('/test/file.md')).toBe('md:<p>hello</p>');
      expect(tabs.value[0].filePath).toBe('/test/new-location.md');
      expect(tabs.value[0].originalMarkdown).toBe('# hello');
      expect(tabs.value[0].hasChanges).toBe(true);
    });

    it('leaves a newer successful Save As clean when the old save completes last', async () => {
      const { options, tabs } = makeOptions();
      options.getEditorHtml.mockImplementation(() => tabs.value[0].content);
      const paused = pauseRename();
      // Only the old path is held; the new path may finish independently.
      const rename = mockRename.getMockImplementation()!;
      mockRename.mockImplementation(async (from: string, to: string) => {
        if (to === '/test/file.md') return rename(from, to);
        if (!paused.files.has(from)) throw new Error(`ENOENT rename: ${from}`);
        paused.files.set(to, paused.files.get(from)!);
        paused.files.delete(from);
      });
      const operations = useFileOperations(options);
      const oldSave = operations.saveFile();
      await paused.entered;
      tabs.value[0].content = '<p>New version</p>';
      setDocumentMarkdown(tabs.value[0], 'md:<p>New version</p>');
      mockSaveDialog.mockResolvedValue('/test/new.md');
      await operations.saveFileAs();
      expect(tabs.value[0].hasChanges).toBe(false);
      expect(paused.files.get('/test/new.md')).toBe('md:<p>New version</p>');
      const saved = { ...tabs.value[0] };
      paused.release();
      await oldSave;
      expect(paused.files.get('/test/file.md')).toBe('md:<p>hello</p>');
      expect({ ...tabs.value[0] }).toEqual(saved);
    });

    it('keeps edits made after the merge dirty when the merged snapshot finishes writing', async () => {
      const { options, tabs } = makeOptions();
      const paused = pauseRename();
      paused.files.set('/test/file.md', 'External');
      const saving = useFileOperations({ ...options, onPreSaveConflict: async () => 'Merged' }).saveFile();
      await paused.entered;
      setDocumentMarkdown(tabs.value[0], 'Newer than merge');
      paused.release();
      await saving;
      expect(paused.files.get('/test/file.md')).toBe('Merged');
      expect(tabs.value[0].originalMarkdown).toBe('Merged');
      expect(tabs.value[0].markdown).toBe('Newer than merge');
      expect(tabs.value[0].hasChanges).toBe(true);
    });

    it('does not rebind an older conflict save to a newer successful Save As', async () => {
      const { options, tabs } = makeOptions();
      const paused = pauseRename();
      paused.files.set('/test/file.md', 'External');
      const rename = mockRename.getMockImplementation()!;
      mockRename.mockImplementation(async (from: string, to: string) => {
        if (to === '/test/file.md') return rename(from, to);
        if (!paused.files.has(from)) throw new Error(`ENOENT rename: ${from}`);
        paused.files.set(to, paused.files.get(from)!);
        paused.files.delete(from);
      });
      let merge!: (source: string) => void;
      let started!: () => void;
      const waiting = new Promise<void>(resolve => { started = resolve; });
      const operations = useFileOperations({ ...options, onPreSaveConflict: async () => {
        started();
        return new Promise<string>(resolve => { merge = resolve; });
      } });
      const older = operations.saveFile();
      await waiting;
      mockSaveDialog.mockResolvedValue('/test/new.md');
      await operations.saveFileAs();
      const saved = { ...tabs.value[0] };
      expect(saved.hasChanges).toBe(false);
      merge('Obsolete merge');
      await older;
      expect({ ...tabs.value[0] }).toEqual(saved);
      expect(paused.files.get('/test/file.md')).toBe('External');
    });

    it('does not accept the merged source as saved when its disk write fails', async () => {
      const { options, tabs } = makeOptions();
      const paused = pauseRename();
      paused.files.set('/test/file.md', 'External');
      mockRename.mockRejectedValueOnce(new Error('rename failed'));
      await useFileOperations({ ...options, onPreSaveConflict: async () => 'Merged' }).saveFile();
      expect(paused.files.get('/test/file.md')).toBe('External');
      expect(tabs.value[0].originalMarkdown).toBe('# hello');
      expect(tabs.value[0].markdown).toBe('Merged');
      expect(tabs.value[0].hasChanges).toBe(true);
    });

    it('updates the original document when tabs are reordered during a write', async () => {
      const { options, tabs } = makeOptions();
      const original = tabs.value[0];
      const other = makeTab({ id: 'tab-2', filePath: '/test/other.md', content: '<p>other</p>' });
      tabs.value.push(other);
      const paused = pauseRename();
      const saving = useFileOperations(options).saveFile();
      await paused.entered;
      tabs.value.reverse();
      paused.release();
      await saving;

      expect(original.hasChanges).toBe(false);
      expect(original.originalMarkdown).toBe('md:<p>hello</p>');
      expect(tabs.value[0].filePath).toBe('/test/other.md');
      expect(tabs.value[0].content).toBe('<p>other</p>');
      expect(tabs.value[0].hasChanges).toBe(true);
    });

    it('does not update a different pane when focus changes during a write', async () => {
      const original = ref([makeTab()]);
      const other = ref([makeTab({ id: 'tab-2', filePath: '/test/other.md', content: '<p>other</p>' })]);
      const focus = ref('left');
      const currentTabs = computed(() => focus.value === 'left' ? original.value : other.value);
      const { options } = makeOptions();
      const paused = pauseRename();
      const saving = useFileOperations({
        ...options,
        tabs: currentTabs,
        activeTabId: computed(() => currentTabs.value[0].id),
        activeTab: computed(() => currentTabs.value[0]),
        getEditorHtml: () => currentTabs.value[0].content,
      }).saveFile();
      await paused.entered;
      focus.value = 'right';
      paused.release();
      await saving;

      expect(original.value[0].hasChanges).toBe(false);
      expect(other.value[0].filePath).toBe('/test/other.md');
      expect(other.value[0].content).toBe('<p>other</p>');
      expect(other.value[0].hasChanges).toBe(true);
    });

    it('saves the requested document if the active tab changes while Save As asks for a path', async () => {
      let selectPath!: (path: string) => void;
      mockSaveDialog.mockImplementation(() => new Promise<string>(resolve => { selectPath = resolve; }));
      const { options, tabs } = makeOptions();
      const original = tabs.value[0];
      tabs.value.push(makeTab({ id: 'tab-2', filePath: '/test/other.md', content: '<p>other</p>' }));
      const paused = pauseRename();
      const saving = useFileOperations({
        ...options,
        activeTab: computed(() => tabs.value.find(tab => tab.id === options.activeTabId.value)!),
        getEditorHtml: () => tabs.value.find(tab => tab.id === options.activeTabId.value)!.content,
      }).saveFileAs();
      options.activeTabId.value = 'tab-2';
      selectPath('/test/saved-as.md');
      await paused.entered;
      paused.release();
      await saving;

      expect(paused.files.get('/test/saved-as.md')).toBe('md:<p>hello</p>');
      expect(original.filePath).toBe('/test/saved-as.md');
      expect(tabs.value[1].filePath).toBe('/test/other.md');
      expect(tabs.value[1].hasChanges).toBe(true);
    });
  });

  describe('Save As delayed before the FIFO write', () => {
    const fixture = () => {
      const { options, tabs } = makeOptions({ content: '<p>A</p>', markdown: 'md:<p>A</p>' });
      const tab = tabs.value[0];
      options.getEditorHtml.mockImplementation(() => tab.content);
      mockReadTextFile.mockImplementation(async (path: string) => {
        if (!mockFiles.has(path)) throw new Error(`ENOENT: ${path}`);
        return mockFiles.get(path)!;
      });
      const dialog = deferred<string | null>();
      mockSaveDialog.mockReturnValueOnce(dialog.promise);
      const onAfterSave = vi.fn();
      const markSaveEnd = vi.fn();
      const operations = useFileOperations({ ...options, onAfterSave, markSaveEnd });
      const editB = () => {
        tab.content = '<p>B</p>';
        setDocumentMarkdown(tab, 'md:<p>B</p>');
      };
      return { tab, dialog, operations, editB, onAfterSave, markSaveEnd };
    };

    it.each(['/test/file.md', '/test/other.md'])('does not write or rebind delayed A to %s after B succeeds', async destination => {
      mockFiles.set('/test/other.md', 'Unrelated');
      const { tab, dialog, operations, editB, onAfterSave, markSaveEnd } = fixture();
      const older = operations.saveFileAs();
      try {
        editB();
        expect(await operations.saveFile()).toBe(true);
        const current = { ...tab };
        const writes = mockWriteTextFile.mock.calls.length;
        dialog.resolve(destination);
        await older;

        expect.soft(mockFiles.get('/test/file.md')).toBe('md:<p>B</p>');
        expect.soft(mockFiles.get('/test/other.md')).toBe('Unrelated');
        expect.soft(mockWriteTextFile).toHaveBeenCalledTimes(writes);
        expect.soft(mockRename).toHaveBeenCalledTimes(1);
        expect({ ...tab }).toEqual(current);
        expect(tab.hasChanges).toBe(false);
        expect(onAfterSave).toHaveBeenCalledExactlyOnceWith('/test/file.md', 'md:<p>B</p>');
        expect(markSaveEnd).toHaveBeenLastCalledWith('/test/file.md', 'md:<p>B</p>');
      } finally { dialog.resolve(null); await older; }
    });

    it('rechecks delayed A inside the FIFO queue after the preceding B commits', async () => {
      const { tab, dialog, operations, editB } = fixture();
      const entered = deferred<void>(), release = deferred<void>(), queuedA = deferred<void>();
      const rename = mockRename.getMockImplementation()!;
      mockRename.mockImplementationOnce(async (from, to) => {
        entered.resolve();
        await release.promise;
        await rename(from, to);
      });
      const write = atomicWrite.atomicWriteTextFile;
      const spy = vi.spyOn(atomicWrite, 'atomicWriteTextFile').mockImplementation((...args) => {
        const pending = write(...args);
        if (args[1] === 'md:<p>A</p>') queuedA.resolve();
        return pending;
      });
      const older = operations.saveFileAs();
      editB();
      const newer = operations.saveFile();
      try {
        await entered.promise;
        dialog.resolve('/test/file.md');
        await queuedA.promise;
        expect(mockWriteTextFile).toHaveBeenCalledTimes(2);
        release.resolve();
        expect(await newer).toBe(true);
        await older;

        expect(mockFiles.get('/test/file.md')).toBe('md:<p>B</p>');
        expect(mockWriteTextFile).toHaveBeenCalledTimes(2);
        expect(mockRename).toHaveBeenCalledTimes(1);
        expect(tab.originalMarkdown).toBe('md:<p>B</p>');
        expect(tab.markdown).toBe('md:<p>B</p>');
        expect(tab.hasChanges).toBe(false);
      } finally {
        dialog.resolve(null); release.resolve();
        await Promise.allSettled([older, newer]);
        spy.mockRestore();
      }
    });

    it('rejects A even when B committed but its frontend acknowledgement is still delayed', async () => {
      const { tab, dialog, operations, editB, markSaveEnd } = fixture();
      const committed = deferred<void>(), acknowledge = deferred<void>();
      const write = atomicWrite.atomicWriteTextFile;
      const spy = vi.spyOn(atomicWrite, 'atomicWriteTextFile').mockImplementationOnce(async (...args) => {
        await write(...args);
        committed.resolve();
        await acknowledge.promise;
      });
      const older = operations.saveFileAs();
      editB();
      const newer = operations.saveFile();
      try {
        await committed.promise;
        const previousBaseline = tab.originalMarkdown;
        dialog.resolve('/test/file.md');
        await older;
        expect.soft(mockFiles.get('/test/file.md')).toBe('md:<p>B</p>');
        expect.soft(mockWriteTextFile).toHaveBeenCalledTimes(2);
        expect(tab.originalMarkdown).toBe(previousBaseline);
        expect(tab.markdown).toBe('md:<p>B</p>');
        expect(tab.hasChanges).toBe(true);
        expect(markSaveEnd).toHaveBeenLastCalledWith('/test/file.md', 'md:<p>B</p>');
        acknowledge.resolve();
        expect(await newer).toBe(true);
        expect(tab.originalMarkdown).toBe('md:<p>B</p>');
        expect(tab.hasChanges).toBe(false);
      } finally {
        dialog.resolve(null); acknowledge.resolve();
        await Promise.allSettled([older, newer]);
        spy.mockRestore();
      }
    });

    it('rechecks A before rename when B saved another target during A readback', async () => {
      const { tab, dialog, operations, editB } = fixture();
      const entered = deferred<void>(), release = deferred<void>();
      const read = mockReadTextFile.getMockImplementation()!;
      mockReadTextFile.mockImplementation(async path => {
        const content = await read(path);
        if (path.endsWith('.tmp') && content === 'md:<p>A</p>') {
          entered.resolve();
          await release.promise;
        }
        return content;
      });
      const older = operations.saveFileAs();
      dialog.resolve('/test/file.md');
      try {
        await entered.promise;
        editB();
        mockSaveDialog.mockResolvedValueOnce('/test/new.md');
        await operations.saveFileAs();
        const current = { ...tab };
        release.resolve();
        await older;

        expect(mockFiles.get('/test/file.md')).toBe('# hello');
        expect(mockFiles.get('/test/new.md')).toBe('md:<p>B</p>');
        expect(mockRename).toHaveBeenCalledTimes(1);
        expect([...mockFiles.keys()].sort()).toEqual(['/test/file.md', '/test/new.md']);
        expect({ ...tab }).toEqual(current);
      } finally { release.resolve(); await older; }
    });

    it.each(['write failure', 'cancelled dialog'])('allows delayed A after a newer %s', async outcome => {
      const { tab, dialog, operations, editB } = fixture();
      const older = operations.saveFileAs();
      try {
        editB();
        if (outcome === 'write failure') {
          mockRename.mockRejectedValueOnce(new Error('B failed'));
          expect(await operations.saveFile()).toBe(false);
        } else {
          mockSaveDialog.mockResolvedValueOnce(null);
          await operations.saveFileAs();
        }
        expect(mockFiles.get('/test/file.md')).toBe('# hello');
        dialog.resolve('/test/file.md');
        await older;
        expect(mockFiles.get('/test/file.md')).toBe('md:<p>A</p>');
        expect(tab.filePath).toBe('/test/file.md');
        expect(tab.originalMarkdown).toBe('md:<p>A</p>');
        expect(tab.markdown).toBe('md:<p>B</p>');
        expect(tab.content).toBe('<p>B</p>');
        expect(tab.hasChanges).toBe(true);
      } finally { dialog.resolve(null); await older; }
    });

    it('leaves the successful B and document unchanged when A cancels its dialog', async () => {
      const { tab, dialog, operations, editB } = fixture();
      const older = operations.saveFileAs();
      editB();
      expect(await operations.saveFile()).toBe(true);
      const current = { ...tab };
      dialog.resolve(null);
      await older;
      expect(mockFiles.get('/test/file.md')).toBe('md:<p>B</p>');
      expect(mockWriteTextFile).toHaveBeenCalledTimes(2);
      expect({ ...tab }).toEqual(current);
    });
  });

  // ----------------------------------------------------------
  // openFileFromPath
  // ----------------------------------------------------------

  describe('openFileFromPath', () => {
    it('switches to existing tab if file already open', async () => {
      const existingTab = makeTab({ id: 'existing-tab' });
      const { options, switchToTab } = makeOptions();
      (options.findTabByFilePath as ReturnType<typeof vi.fn>).mockReturnValue(existingTab);

      const { openFileFromPath } = useFileOperations(options);
      await openFileFromPath('/test/file.md');

      expect(switchToTab).toHaveBeenCalledWith('existing-tab');
      expect(mockReadTextFile).not.toHaveBeenCalled();
    });

    it('loads file content and calls onFileOpened callback', async () => {
      mockReadTextFile.mockResolvedValue('# new file content');
      const onFileOpened = vi.fn();

      const { options } = makeOptions({ filePath: null, hasChanges: false, content: '<p></p>' });
      const { openFileFromPath } = useFileOperations({ ...options, onFileOpened });

      await openFileFromPath('/other/file.md');

      expect(mockReadTextFile).toHaveBeenCalledWith('/other/file.md');
      expect(onFileOpened).toHaveBeenCalledWith('/other/file.md', '# new file content');
    });
  });

  // ----------------------------------------------------------
  // Large files — markdown-first open (issue #129)
  // ----------------------------------------------------------

  describe('large file open', () => {
    it('opens a file above the threshold as markdown-first without converting', async () => {
      const bigContent = 'x'.repeat(1_000_001);
      mockReadTextFile.mockResolvedValue(bigContent);
      const onLargeFileOpened = vi.fn();

      const { options, tabs, setEditorContent } = makeOptions(
        { filePath: null, hasChanges: false, content: '<p></p>' },
      );
      const { openFileFromPath } = useFileOperations({ ...options, onLargeFileOpened });

      await openFileFromPath('/big/big.md');

      const tab = tabs.value[0];
      expect(tab.largeFile).toBe(true);
      expect(tab.pendingMarkdown).toBe(bigContent);
      expect(tab.content).toBe('');
      expect(tab.originalMarkdown).toBe(bigContent);
      expect(markdownToHtml).not.toHaveBeenCalled();
      expect(setEditorContent).not.toHaveBeenCalled();
      expect(onLargeFileOpened).toHaveBeenCalledWith('/big/big.md', bigContent);
    });

    it('opens a large file into a new tab as markdown-first when active tab is not empty', async () => {
      const bigContent = 'y'.repeat(1_000_001);
      mockReadTextFile.mockResolvedValue(bigContent);
      const onLargeFileOpened = vi.fn();

      const { options, createNewTab, tabs } = makeOptions();
      tabs.value.push(makeTab({ id: 'new-tab-id', filePath: null, content: '', originalMarkdown: null }));
      const { openFileFromPath } = useFileOperations({ ...options, onLargeFileOpened });

      await openFileFromPath('/big/big.md');

      expect(createNewTab).toHaveBeenCalledWith('/big/big.md', '', 'big.md');
      const newTab = tabs.value.find(t => t.id === 'new-tab-id')!;
      expect(newTab.largeFile).toBe(true);
      expect(newTab.pendingMarkdown).toBe(bigContent);
      expect(markdownToHtml).not.toHaveBeenCalled();
      expect(onLargeFileOpened).toHaveBeenCalledWith('/big/big.md', bigContent);
    });

    it('opens a file below the threshold exactly as before', async () => {
      mockReadTextFile.mockResolvedValue('# small');
      const onLargeFileOpened = vi.fn();

      const { options, tabs } = makeOptions({ filePath: null, hasChanges: false, content: '<p></p>' });
      const { openFileFromPath } = useFileOperations({ ...options, onLargeFileOpened });

      await openFileFromPath('/small/small.md');

      const tab = tabs.value[0];
      expect(tab.largeFile).toBeUndefined();
      expect(tab.pendingMarkdown).toBeUndefined();
      expect(tab.content).toBe('<p># small</p>');
      expect(onLargeFileOpened).not.toHaveBeenCalled();
    });

    it('opens a large file via openFileInNewTab (relative link) as markdown-first', async () => {
      const bigContent = 'z'.repeat(1_000_001);
      mockReadTextFile.mockResolvedValue(bigContent);
      const onLargeFileOpened = vi.fn();

      const { options, createNewTab, tabs } = makeOptions();
      tabs.value.push(makeTab({ id: 'new-tab-id', filePath: null, content: '', originalMarkdown: null }));
      let loader!: (path: string) => Promise<boolean>;
      const openOwnedFile = vi.fn(async (path: string) => { expect(await loader(path)).toBe(true); });
      const operations = useFileOperations({ ...options, onLargeFileOpened, openOwnedFile });
      loader = operations.openFileFromPath;
      await operations.openFileInNewTab('big.md');
      expect(openOwnedFile).toHaveBeenCalledExactlyOnceWith('/test/big.md');

      expect(createNewTab).toHaveBeenCalledWith('/test/big.md', '', 'big.md');
      const newTab = tabs.value.find(t => t.id === 'new-tab-id')!;
      expect(newTab.largeFile).toBe(true);
      expect(newTab.pendingMarkdown).toBe(bigContent);
      expect(markdownToHtml).not.toHaveBeenCalled();
      expect(onLargeFileOpened).toHaveBeenCalledWith('/test/big.md', bigContent);
    });
  });
  it('does not report its own intervening save as an external conflict', async () => {
    const { options, tabs } = makeOptions({ content: '<p>A</p>', markdown: 'md:<p>A</p>' });
    options.getEditorHtml.mockImplementation(() => tabs.value[0].content);
    const entered = deferred<void>(), release = deferred<void>();
    let targetReads = 0;
    mockReadTextFile.mockImplementation(async path => {
      if (path === '/test/file.md' && ++targetReads === 2) { entered.resolve(); await release.promise; }
      if (!mockFiles.has(path)) throw new Error(`ENOENT: ${path}`);
      return mockFiles.get(path)!;
    });
    const renameEntered = deferred<void>(), renameRelease = deferred<void>();
    const move = mockRename.getMockImplementation()!;
    mockRename.mockImplementationOnce(async (from, to) => { renameEntered.resolve(); await renameRelease.promise; await move(from, to); });
    const conflict = vi.fn(async () => 'save' as const);
    const operations = useFileOperations({ ...options, onPreSaveConflict: conflict });
    const first = operations.saveFile();
    await renameEntered.promise;
    tabs.value[0].content = '<p>B</p>';
    setDocumentMarkdown(tabs.value[0], 'md:<p>B</p>');
    const second = operations.saveFile();
    try {
      await entered.promise;
      renameRelease.resolve();
      expect(await first).toBe(false);
      release.resolve();
      expect(await second).toBe(true);
      expect(conflict).not.toHaveBeenCalled();
      expect(mockFiles.get('/test/file.md')).toBe('md:<p>B</p>');
    } finally { renameRelease.resolve(); release.resolve(); await Promise.allSettled([first, second]); }
  });

  it('does not load an editable copy when the owned link opener rejects the request', async () => {
    const { options, createNewTab } = makeOptions();
    const openOwnedFile = vi.fn(async () => { throw new Error('Already owned or unavailable'); });
    await useFileOperations({ ...options, openOwnedFile }).openFileInNewTab('other.md');
    expect(openOwnedFile).toHaveBeenCalledExactlyOnceWith('/test/other.md');
    expect(mockReadTextFile).not.toHaveBeenCalled();
    expect(createNewTab).not.toHaveBeenCalled();
  });

  describe('Save As target ownership', () => {
    it.each(['\n# Title\n\n\nBody\n\n', '\r\n# Title\r\n\r\n\r\nBody\r\n\r\n', '# Title\r\n\n\nBody\n\r\n'])('copies unchanged source exactly on Save As (%j)', async source => {
      const converters = await import('../../utils/markdown-converter');
      const actual = await vi.importActual<typeof converters>('../../utils/markdown-converter');
      const detect = vi.mocked(converters.detectLineEnding), apply = vi.mocked(converters.applyLineEnding);
      const previousDetect = detect.getMockImplementation(), previousApply = apply.getMockImplementation();
      detect.mockImplementation(actual.detectLineEnding);
      apply.mockImplementation(actual.applyLineEnding);
      try {
        const { options, tabs } = makeOptions({ originalMarkdown: source, markdown: source.replace(/\r\n/g, '\n').trimEnd(), hasChanges: false });
        mockFiles.set('/test/file.md', source);
        mockReadTextFile.mockImplementation(async path => mockFiles.get(path)!);
        mockSaveDialog.mockResolvedValueOnce('/test/copy.md');
        const operations = useFileOperations({ ...options, getSaveMarkdown: () => source });
        expect(await operations.saveFile()).toBe(true);
        expect(mockWriteTextFile).not.toHaveBeenCalled();
        await operations.saveFileAs();
        expect(mockFiles.get('/test/copy.md')).toBe(source);
        expect(mockFiles.get('/test/file.md')).toBe(source);
        expect(tabs.value[0].originalMarkdown).toBe(source);
        expect(tabs.value[0].hasChanges).toBe(false);
      } finally {
        detect.mockImplementation(previousDetect!);
        apply.mockImplementation(previousApply!);
      }
    });

    it.each(['another tab', 'another pane', 'another window', 'empty source'])
      ('never writes or changes document state when the target belongs to %s', async scenario => {
        const empty = scenario === 'empty source';
        const { options, tabs } = makeOptions({ content: empty ? '<p></p>' : '<p>A</p>', markdown: empty ? '' : 'md:<p>A</p>' });
        const source = tabs.value[0];
        const other = makeTab({ id: 'other', filePath: '/test/owned.md', content: '<p>Other edits</p>', markdown: 'Other edits', originalMarkdown: 'Other saved content', hasChanges: true });
        mockFiles.set('/test/owned.md', 'Other saved content');
        mockSaveDialog.mockResolvedValueOnce('/test/owned.md');
        mockReadTextFile.mockImplementation(async path => mockFiles.get(path)!);
        const reserveSaveTarget = vi.fn(async () => null);
        const conflict = vi.fn(async () => 'save' as const);
        const before = { source: { ...source }, other: { ...other }, files: [...mockFiles] };
        const configured = { ...options, getMarkdownOverride: () => empty ? '' : 'md:<p>A</p>', reserveSaveTarget, onPreSaveConflict: conflict };
        await useFileOperations(configured).saveFileAs();
        expect.soft([...mockFiles]).toEqual(before.files);
        expect.soft({ ...source }).toEqual(before.source);
        expect.soft({ ...other }).toEqual(before.other);
        expect.soft(mockWriteTextFile).not.toHaveBeenCalled();
        expect.soft(conflict).not.toHaveBeenCalled();
        expect(reserveSaveTarget).toHaveBeenCalledTimes(1);
      });

    it('releases only its reservation after a failed Save As write', async () => {
      const { options, tabs } = makeOptions();
      mockReadTextFile.mockImplementation(async path => mockFiles.get(path)!);
      const finish = vi.fn(async () => true);
      const reserveSaveTarget = vi.fn(async () => ({ filePath: '/test/new.md', created: false, finish }));
      mockSaveDialog.mockResolvedValueOnce('/test/new.md');
      mockRename.mockRejectedValueOnce(new Error('Write rejected'));
      const configured = { ...options, reserveSaveTarget };
      await useFileOperations(configured).saveFileAs();
      expect(finish).toHaveBeenCalledExactlyOnceWith(false);
      expect(tabs.value[0].filePath).toBe('/test/file.md');
      expect(mockFiles.get('/test/file.md')).toBe('# hello');
    });
    it('publishes binding before ownership release and preserves edits made during the acknowledgement', async () => {
      const { options, tabs } = makeOptions();
      mockReadTextFile.mockImplementation(async path => mockFiles.get(path)!);
      mockSaveDialog.mockResolvedValueOnce('/test/new.md');
      const entered = deferred<void>(), release = deferred<void>();
      const finish = vi.fn(async (committed: boolean, publish?: boolean) => {
        expect(committed).toBe(true); expect(publish).toBe(true);
        expect(tabs.value[0].filePath).toBe('/test/new.md');
        expect(tabs.value[0].originalMarkdown).toBe('md:<p>hello</p>');
        expect(mockFiles.get('/test/new.md')).toBe('md:<p>hello</p>');
        entered.resolve(); await release.promise; return true;
      });
      const configured = { ...options, reserveSaveTarget: async () => ({ filePath: '/test/new.md', created: true, finish }) };
      const saving = useFileOperations(configured).saveFileAs();
      try {
        await entered.promise;
        tabs.value[0].content = '<p>Newer edits</p>';
        setDocumentMarkdown(tabs.value[0], 'Newer edits');
        release.resolve(); await saving;
        expect(tabs.value[0].markdown).toBe('Newer edits');
        expect(tabs.value[0].hasChanges).toBe(true);
        expect(tabs.value[0].originalMarkdown).toBe('md:<p>hello</p>');
      } finally { release.resolve(); await saving; }
    });

  });

});

// ============================================================
// handleLinkClick — in-document anchors
// ============================================================

describe('handleLinkClick — anchors', () => {
  // Returns the scrollTo calls recorded for each container, in DOM order.
  const buildPanes = (panes: Array<{ active?: boolean; html: string }>) => {
    document.body.innerHTML = panes
      .map(
        (p) =>
          `<div class="editor-pane${p.active ? ' active' : ''}">` +
          `<div class="editor-container">${p.html}</div></div>`
      )
      .join('');
    return Array.from(document.querySelectorAll<HTMLElement>('.editor-container')).map((c) => {
      const calls: unknown[] = [];
      c.scrollTo = ((arg: unknown) => calls.push(arg)) as typeof c.scrollTo;
      return calls;
    });
  };

  // Code+preview replaces the whole SplitContainer, so no .editor-pane exists.
  const buildBareContainer = (html: string) => {
    document.body.innerHTML = `<div class="split-editor-preview"><div class="editor-container">${html}</div></div>`;
    const c = document.querySelector<HTMLElement>('.editor-container')!;
    const calls: unknown[] = [];
    c.scrollTo = ((arg: unknown) => calls.push(arg)) as typeof c.scrollTo;
    return calls;
  };

  it('scrolls to an exactly matching heading id', () => {
    const { options } = makeOptions();
    const { handleLinkClick } = useFileOperations(options as never);
    const [calls] = buildPanes([{ active: true, html: '<h2 id="overview">Overview</h2>' }]);

    handleLinkClick('#overview');

    expect(calls).toHaveLength(1);
  });

  it('searches the active pane, not the first one in the DOM', () => {
    const { options } = makeOptions();
    const { handleLinkClick } = useFileOperations(options as never);
    const [inactive, active] = buildPanes([
      { html: '<p>other document</p>' },
      { active: true, html: '<h2 id="overview">Overview</h2>' },
    ]);

    handleLinkClick('#overview');

    expect(inactive).toHaveLength(0);
    expect(active).toHaveLength(1);
  });

  it('falls back to the plain container when no pane is marked active', () => {
    const { options } = makeOptions();
    const { handleLinkClick } = useFileOperations(options as never);
    const calls = buildBareContainer('<h2 id="overview">Overview</h2>');

    handleLinkClick('#overview');

    expect(calls).toHaveLength(1);
  });

  it('resolves an anchor written against the old collapsed-hyphen slug rules', () => {
    const { options } = makeOptions();
    const { handleLinkClick } = useFileOperations(options as never);
    const [calls] = buildPanes([
      { active: true, html: '<h2 id="tier-0--write-path-correctness">Tier 0 — write-path correctness</h2>' },
    ]);

    // What MerMark used to generate, and what users hand-patched their docs to.
    handleLinkClick('#tier-0-write-path-correctness');

    expect(calls).toHaveLength(1);
  });

  it('resolves against heading text when the id is stale after a WYSIWYG edit', () => {
    const { options } = makeOptions();
    const { handleLinkClick } = useFileOperations(options as never);
    const [calls] = buildPanes([
      { active: true, html: '<h2 id="old-title">Renamed Section</h2>' },
    ]);

    handleLinkClick('#renamed-section');

    expect(calls).toHaveLength(1);
  });

  it('decodes percent-encoded anchors', () => {
    const { options } = makeOptions();
    const { handleLinkClick } = useFileOperations(options as never);
    const [calls] = buildPanes([{ active: true, html: '<h2 id="概要">概要</h2>' }]);

    handleLinkClick('#' + encodeURIComponent('概要'));

    expect(calls).toHaveLength(1);
  });

  it('reports a genuinely missing anchor instead of failing silently', () => {
    const onAnchorNotFound = vi.fn();
    const { options } = makeOptions({}, { onAnchorNotFound });
    const { handleLinkClick } = useFileOperations(options as never);
    const [calls] = buildPanes([{ active: true, html: '<h2 id="overview">Overview</h2>' }]);

    handleLinkClick('#nothing-like-this');

    expect(calls).toHaveLength(0);
    expect(onAnchorNotFound).toHaveBeenCalledWith('nothing-like-this');
  });

  it('does not treat an anchor as a file to open', () => {
    const { options, createNewTab } = makeOptions();
    const { handleLinkClick } = useFileOperations(options as never);
    buildPanes([{ active: true, html: '<p>no headings</p>' }]);

    handleLinkClick('#missing');

    expect(createNewTab).not.toHaveBeenCalled();
  });

  it('does not jump to an unrelated heading that carries a stale look-alike id', () => {
    const onAnchorNotFound = vi.fn();
    const { options } = makeOptions({}, { onAnchorNotFound });
    const { handleLinkClick } = useFileOperations(options as never);
    const [calls] = buildPanes([
      {
        active: true,
        html:
          '<h2 id="foo--bar">Deprecated Notice</h2>' +
          '<h2 id="foo-bar-2024">Foo Bar</h2>',
      },
    ]);

    // jsdom gives every element a zero rect, so stub distinct offsets to make
    // WHICH heading was chosen observable in the resulting scroll position.
    const wrong = document.getElementById('foo--bar')!;
    const right = document.getElementById('foo-bar-2024')!;
    const container = document.querySelector('.editor-container')!;
    container.getBoundingClientRect = (() => ({ top: 0 })) as never;
    wrong.getBoundingClientRect = (() => ({ top: 100 })) as never;
    right.getBoundingClientRect = (() => ({ top: 500 })) as never;

    handleLinkClick('#foo-bar');

    // Must land on the heading actually titled "Foo Bar" (500 - 20), never on
    // the one that merely holds a stale double-hyphen id (which would be 80).
    expect(calls).toEqual([{ top: 480, behavior: 'smooth' }]);
    expect(onAnchorNotFound).not.toHaveBeenCalled();
  });

  it('reports ambiguity instead of guessing between two equally good headings', () => {
    const onAnchorNotFound = vi.fn();
    const { options } = makeOptions({}, { onAnchorNotFound });
    const { handleLinkClick } = useFileOperations(options as never);
    const [calls] = buildPanes([
      { active: true, html: '<h2 id="a">Foo Bar</h2><h2 id="b">Foo  Bar</h2>' },
    ]);

    handleLinkClick('#foo-bar');

    expect(calls).toHaveLength(0);
    expect(onAnchorNotFound).toHaveBeenCalledWith('foo-bar');
  });

  it('does not throw on a malformed percent escape, and still reports it', () => {
    const onAnchorNotFound = vi.fn();
    const { options } = makeOptions({}, { onAnchorNotFound });
    const { handleLinkClick } = useFileOperations(options as never);
    buildPanes([{ active: true, html: '<h2 id="coverage">Coverage</h2>' }]);

    expect(() => handleLinkClick('#100%-coverage')).not.toThrow();
    expect(() => handleLinkClick('#a%zz')).not.toThrow();
    expect(onAnchorNotFound).toHaveBeenCalledTimes(2);
  });

});
