import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tab } from '../../composables/useTabs';
import type { WriteFileOptions } from '@tauri-apps/plugin-fs';
import type { UnsavedTab } from '../../composables/useCloseConfirmation';
import { setDocumentMarkdown } from '../../utils/save-state';
import { ref } from 'vue';
import { useTabSerializer } from '../../composables/useTabSerializer';

// Captures the close callback so a test can fire a window-close itself.
const windowMocks = vi.hoisted(() => ({
  closeHandler: null as null | ((event: { preventDefault: () => void }) => Promise<void>),
}));

// A tiny in-memory filesystem, so the tests can assert on what actually landed
// on disk rather than on the sequence of tmp-write / verify / rename calls that
// the atomic write performs.
const fsMocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    writeTextFile: vi.fn(async (path: string, content: string, options?: WriteFileOptions) => {
      if (options?.createNew && files.has(path)) throw new Error(`EEXIST: ${path}`);
      if (!options?.createNew && options?.create === false && !files.has(path)) throw new Error(`ENOENT: ${path}`);
      files.set(path, content);
    }),
    readTextFile: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`no such file: ${path}`);
      return files.get(path)!;
    }),
    rename: vi.fn(async (from: string, to: string) => {
      if (!files.has(from)) throw new Error(`ENOENT rename: ${from}`);
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    remove: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT remove: ${path}`);
      files.delete(path);
    }),
    mkdir: vi.fn(async () => {}),
  };
});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: vi.fn((cb) => {
      windowMocks.closeHandler = cb;
      return Promise.resolve(() => {});
    }),
  })),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  exit: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@tauri-apps/plugin-fs', () => fsMocks);

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => 'D:/appdata'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import { useCloseConfirmation } from '../../composables/useCloseConfirmation';
import { exit } from '@tauri-apps/plugin-process';

describe('useCloseConfirmation', () => {
  const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
    id: `tab-${Math.random().toString(36).slice(2, 11)}`,
    filePath: null,
    fileName: 'Test Document',
    content: '<p>Test content</p>',
    hasChanges: false,
    scrollTop: 0,
    originalMarkdown: null,
    ...overrides,
  });

  const createMockOptions = (unsaved: UnsavedTab[] = []) => ({
    reserveSaveTarget: vi.fn(async (_state: unknown, filePath: string) => ({ filePath, created: false, finish: vi.fn(async () => true) })),
    collectUnsavedTabs: vi.fn(() => unsaved),
    getTabMarkdown: vi.fn((_paneId: string, tab: Tab) => tab.content),
    switchToTab: vi.fn(() => Promise.resolve()),
    syncActiveTabContent: vi.fn(),
  });

  /** Fires a window-close and returns the event, so the test can assert on it. */
  const requestClose = async () => {
    const event = { preventDefault: vi.fn() };
    await windowMocks.closeHandler!(event);
    return event;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.files.clear();
    windowMocks.closeHandler = null;
  });

  describe('initial state', () => {
    it('should initialize with dialog hidden', () => {
      const { showSaveConfirmDialog } = useCloseConfirmation(createMockOptions());

      expect(showSaveConfirmDialog.value).toBe(false);
    });

    it('should initialize with no current tab to save', () => {
      const { currentTabToSave } = useCloseConfirmation(createMockOptions());

      expect(currentTabToSave.value).toBe(null);
    });

    it('should initialize with zero tabs to save count', () => {
      const { tabsToSaveCount } = useCloseConfirmation(createMockOptions());

      expect(tabsToSaveCount.value).toBe(0);
    });
  });

  describe('closing with unsaved work', () => {
    it('lets the window close when nothing is dirty', async () => {
      const { setupCloseHandler, showSaveConfirmDialog } = useCloseConfirmation(createMockOptions());

      await setupCloseHandler();
      const event = await requestClose();

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(showSaveConfirmDialog.value).toBe(false);
    });

    it('holds the window open and prompts for each dirty tab', async () => {
      const first = createMockTab({ id: 'tab-1', hasChanges: true, fileName: 'One.md' });
      const second = createMockTab({ id: 'tab-2', hasChanges: true, fileName: 'Two.md' });

      const { setupCloseHandler, showSaveConfirmDialog, tabsToSaveCount } = useCloseConfirmation(
        createMockOptions([
          { paneId: 'left', tab: first },
          { paneId: 'left', tab: second },
        ]),
      );

      await setupCloseHandler();
      const event = await requestClose();

      expect(event.preventDefault).toHaveBeenCalled();
      expect(showSaveConfirmDialog.value).toBe(true);
      expect(tabsToSaveCount.value).toBe(2);
    });

    // Regression: the collection used to read the focused pane's tab list only,
    // so edits sitting in the other half of a split view were dropped on close
    // without any prompt at all.
    it('prompts for dirty tabs in every pane, not only the focused one', async () => {
      const left = createMockTab({ id: 'left-1', hasChanges: true, fileName: 'Left.md' });
      const right = createMockTab({ id: 'right-1', hasChanges: true, fileName: 'Right.md' });

      const { setupCloseHandler, tabsToSaveCount, currentTabToSave } = useCloseConfirmation(
        createMockOptions([
          { paneId: 'left', tab: left },
          { paneId: 'right', tab: right },
        ]),
      );

      await setupCloseHandler();
      await requestClose();

      expect(tabsToSaveCount.value).toBe(2);
      expect(currentTabToSave.value?.tab.fileName).toBe('Left.md');
    });

    it('focuses the pane that owns the tab before asking about it', async () => {
      const right = createMockTab({ id: 'right-1', hasChanges: true, fileName: 'Right.md' });
      const options = createMockOptions([{ paneId: 'right', tab: right }]);

      const { setupCloseHandler } = useCloseConfirmation(options);

      await setupCloseHandler();
      await requestClose();

      expect(options.switchToTab).toHaveBeenCalledWith('right', 'right-1');
    });

    it('serializes a tab against the pane that holds it', async () => {
      const right = createMockTab({
        id: 'right-1',
        filePath: 'D:/notes/right.md',
        hasChanges: true,
        originalMarkdown: '# Old',
      });
      const options = createMockOptions([{ paneId: 'right', tab: right }]);

      const { setupCloseHandler, handleSave } = useCloseConfirmation(options);

      await setupCloseHandler();
      await requestClose();
      await handleSave();

      expect(options.getTabMarkdown).toHaveBeenCalledWith('right', right);
    });
  });

  describe('handleCancel', () => {
    it('should hide dialog and clear state', () => {
      const { showSaveConfirmDialog, currentTabToSave, handleCancel } =
        useCloseConfirmation(createMockOptions());

      showSaveConfirmDialog.value = true;

      handleCancel();

      expect(showSaveConfirmDialog.value).toBe(false);
      expect(currentTabToSave.value).toBe(null);
    });
  });

  describe('handleDiscard', () => {
    it('should mark current tab as not having changes', () => {
      const tab = createMockTab({ hasChanges: true });
      const { currentTabToSave, handleDiscard } = useCloseConfirmation(createMockOptions());

      currentTabToSave.value = { paneId: 'left', tab };

      handleDiscard();

      expect(tab.hasChanges).toBe(false);
    });

    it('should do nothing if no current tab to save', () => {
      const { handleDiscard } = useCloseConfirmation(createMockOptions());

      expect(() => handleDiscard()).not.toThrow();
    });
  });

  describe('setupCloseHandler', () => {
    it('should return an unlisten function', async () => {
      const { setupCloseHandler } = useCloseConfirmation(createMockOptions());

      const unlisten = await setupCloseHandler();

      expect(typeof unlisten).toBe('function');
    });
  });

  describe('save-on-quit never destroys a document', () => {
    it('writes the pinned Markdown while focusing is pending and another document is mounted', async () => {
      const tab = createMockTab({ id: 'target', filePath: '/target.md', markdown: 'Pinned work', content: '<p>Stale cache</p>', originalMarkdown: 'Old disk', hasChanges: true });
      const activeTabId = ref('other');
      let release!: () => void;
      const ready = new Promise<void>(resolve => { release = resolve; });
      const serializer = useTabSerializer({
        activeTabId, activePaneId: ref('left'), isMarkdownFirst: () => false,
        getEditorSource: () => ({ tabId: 'other', html: '<p>Other document</p>' }),
      });
      const close = useCloseConfirmation({
        ...createMockOptions([{ paneId: 'left', tab }]),
        getTabMarkdown: serializer.getTabMarkdown,
        switchToTab: async (_pane, id) => { activeTabId.value = id; await ready; },
      });
      try {
        await close.setupCloseHandler();
        await requestClose();
        await close.handleSave();
        expect(fsMocks.files.get('/target.md')).toBe('Pinned work');
        expect(tab.markdown).toBe('Pinned work');
        expect(tab.originalMarkdown).toBe('Pinned work');
        expect(tab.hasChanges).toBe(false);
        expect(exit).toHaveBeenCalledOnce();
      } finally { release(); }
    });

    it('does not write, mutate or exit when the mounted source belongs to another document', async () => {
      const tab = createMockTab({ id: 'target', content: '<p>Unsaved work</p>', hasChanges: true });
      const serializer = useTabSerializer({
        activeTabId: ref('target'), activePaneId: ref('left'), isMarkdownFirst: () => false,
        getEditorSource: () => ({ tabId: 'other', html: '<p>Other work</p>' }),
      });
      const close = useCloseConfirmation({ ...createMockOptions([{ paneId: 'left', tab }]), getTabMarkdown: serializer.getTabMarkdown });
      await close.setupCloseHandler();
      await requestClose();
      await close.handleSave();
      expect(fsMocks.files.size).toBe(0);
      expect(tab.content).toBe('<p>Unsaved work</p>');
      expect(tab.markdown).toBeUndefined();
      expect(tab.editRevision).toBeUndefined();
      expect(tab.originalMarkdown).toBeNull();
      expect(tab.filePath).toBeNull();
      expect(tab.hasChanges).toBe(true);
      expect(exit).not.toHaveBeenCalled();
      expect(close.currentTabToSave.value?.tab.id).toBe('target');
    });

    it('does not exit or discard edits made while the close-save is writing', async () => {
      const tab = createMockTab({
        filePath: 'D:/notes/important.md',
        content: '# First edit',
        hasChanges: true,
        originalMarkdown: '# Old',
      });
      let release!: () => void;
      let started!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { started = resolve; });
      fsMocks.rename.mockImplementationOnce(async (from, to) => {
        started();
        await pending;
        if (!fsMocks.files.has(from)) throw new Error(`ENOENT rename: ${from}`);
        fsMocks.files.set(to, fsMocks.files.get(from)!);
        fsMocks.files.delete(from);
      });
      const options = createMockOptions([{ paneId: 'left', tab }]);
      const close = useCloseConfirmation(options);
      await close.setupCloseHandler();
      await requestClose();
      const saving = close.handleSave();
      await entered;
      tab.content = '# First edit plus newer work';
      setDocumentMarkdown(tab, tab.content);
      release();
      await saving;

      expect(fsMocks.files.get(tab.filePath!)).toBe('# First edit');
      expect(tab.content).toBe('# First edit plus newer work');
      expect.soft(tab.hasChanges).toBe(true);
      expect.soft(exit).not.toHaveBeenCalled();
      expect.soft(close.currentTabToSave.value?.tab.id).toBe(tab.id);
    });

    it('checks earlier saved tabs again before exiting after another tab saves', async () => {
      const first = createMockTab({ id: 'first', filePath: '/first.md', hasChanges: true });
      const second = createMockTab({ id: 'second', filePath: '/second.md', hasChanges: true });
      const close = useCloseConfirmation(createMockOptions([
        { paneId: 'left', tab: first }, { paneId: 'right', tab: second },
      ]));
      await close.setupCloseHandler();
      await requestClose();
      await close.handleSave();
      expect(first.hasChanges).toBe(false);
      expect(close.currentTabToSave.value?.tab.id).toBe(second.id);

      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      fsMocks.rename.mockImplementationOnce(async (from, to) => {
        entered();
        await gate;
        if (!fsMocks.files.has(from)) throw new Error(`ENOENT rename: ${from}`);
        fsMocks.files.set(to, fsMocks.files.get(from)!);
        fsMocks.files.delete(from);
      });
      const saving = close.handleSave();
      await started;
      first.content = '<p>Newer work in the earlier tab</p>';
      setDocumentMarkdown(first, first.content);
      release();
      await saving;

      expect(exit).not.toHaveBeenCalled();
      expect(close.currentTabToSave.value?.tab.id).toBe(first.id);
      expect(close.showSaveConfirmDialog.value).toBe(true);
      await close.handleSave();
      expect(fsMocks.files.get('/first.md')).toBe(first.content);
      expect(exit).toHaveBeenCalledWith(0);
    });

    it('does not exit when the close operation is cancelled during its save', async () => {
      const tab = createMockTab({ filePath: '/doc.md', hasChanges: true });
      const close = useCloseConfirmation(createMockOptions([{ paneId: 'left', tab }]));
      await close.setupCloseHandler();
      await requestClose();
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      fsMocks.rename.mockImplementationOnce(async (from, to) => {
        entered();
        await gate;
        if (!fsMocks.files.has(from)) throw new Error(`ENOENT rename: ${from}`);
        fsMocks.files.set(to, fsMocks.files.get(from)!);
        fsMocks.files.delete(from);
      });
      const saving = close.handleSave();
      await started;
      close.handleCancel();
      release();
      await saving;

      expect(fsMocks.files.get('/doc.md')).toBe(tab.content);
      expect(exit).not.toHaveBeenCalled();
      expect(close.showSaveConfirmDialog.value).toBe(false);
    });

    // Regression: the active tab used to be serialized straight from the WYSIWYG
    // editor. In code view / split-editor / large-file mode that component is
    // unmounted and yielded the '<p></p>' placeholder, so clicking "Save" in the
    // quit dialog wrote an empty file over the user's work.
    it('skips the write when no editor can supply the content', async () => {
      const tab = createMockTab({
        id: 'tab-1',
        filePath: 'D:/notes/important.md',
        hasChanges: true,
        originalMarkdown: '# Hours of work',
      });
      const onSaveFailed = vi.fn();

      const { handleSave, currentTabToSave } = useCloseConfirmation({
        ...createMockOptions(),
        getTabMarkdown: () => null,
        onSaveFailed,
      });

      currentTabToSave.value = { paneId: 'left', tab };
      await handleSave();

      expect(fsMocks.files.size).toBe(0);
      expect(onSaveFailed).toHaveBeenCalledWith(tab);
    });

    it('keeps the tab dirty so the close is not silently accepted', async () => {
      const tab = createMockTab({
        id: 'tab-1',
        filePath: 'D:/notes/important.md',
        hasChanges: true,
        originalMarkdown: '# Hours of work',
      });

      const { handleSave, currentTabToSave } = useCloseConfirmation({
        ...createMockOptions(),
        getTabMarkdown: () => null,
      });

      currentTabToSave.value = { paneId: 'left', tab };
      await handleSave();

      expect(tab.hasChanges).toBe(true);
    });

    it('refuses to empty a file that still had content', async () => {
      const tab = createMockTab({
        id: 'tab-1',
        filePath: 'D:/notes/important.md',
        hasChanges: true,
        originalMarkdown: '# Hours of work',
      });
      const onSaveFailed = vi.fn();

      const { handleSave, currentTabToSave } = useCloseConfirmation({
        ...createMockOptions(),
        getTabMarkdown: () => '',
        onSaveFailed,
      });

      currentTabToSave.value = { paneId: 'left', tab };
      await handleSave();

      expect(fsMocks.files.size).toBe(0);
      expect(onSaveFailed).toHaveBeenCalledWith(tab);
      expect(tab.hasChanges).toBe(true);
    });

    it('writes normally when the content resolves', async () => {
      const tab = createMockTab({
        id: 'tab-1',
        filePath: 'D:/notes/important.md',
        hasChanges: true,
        originalMarkdown: '# Old',
      });

      const { handleSave, currentTabToSave } = useCloseConfirmation({
        ...createMockOptions(),
        getTabMarkdown: () => '# Hours of work\n',
      });

      currentTabToSave.value = { paneId: 'left', tab };
      await handleSave();

      expect(fsMocks.files.get('D:/notes/important.md')).toBe('# Hours of work');
      expect(tab.hasChanges).toBe(false);
      expect(tab.originalMarkdown).toBe('# Hours of work');
    });

    it('allows emptying a document that was already empty', async () => {
      const tab = createMockTab({
        id: 'tab-1',
        filePath: 'D:/notes/scratch.md',
        hasChanges: true,
        originalMarkdown: '',
      });

      const { handleSave, currentTabToSave } = useCloseConfirmation({
        ...createMockOptions(),
        getTabMarkdown: () => '',
      });

      currentTabToSave.value = { paneId: 'left', tab };
      await handleSave();

      expect(fsMocks.files.get('D:/notes/scratch.md')).toBe('');
    });

    it('leaves no temporary file behind after a successful save', async () => {
      const tab = createMockTab({
        id: 'tab-1',
        filePath: 'D:/notes/important.md',
        hasChanges: true,
        originalMarkdown: '# Old',
      });

      const { handleSave, currentTabToSave } = useCloseConfirmation({
        ...createMockOptions(),
        getTabMarkdown: () => '# New',
      });

      currentTabToSave.value = { paneId: 'left', tab };
      await handleSave();

      expect([...fsMocks.files.keys()].filter(path => path.endsWith('.tmp'))).toEqual([]);
    });

    // The original file has to survive a failed write, which is the whole point
    // of going through a temporary sibling.
    it('leaves the previous file intact when the write fails', async () => {
      fsMocks.files.set('D:/notes/important.md', '# Hours of work');
      fsMocks.rename.mockRejectedValueOnce(new Error('disk full'));

      const tab = createMockTab({
        id: 'tab-1',
        filePath: 'D:/notes/important.md',
        hasChanges: true,
        originalMarkdown: '# Hours of work',
      });

      const { handleSave, currentTabToSave } = useCloseConfirmation({
        ...createMockOptions(),
        getTabMarkdown: () => '# Replacement',
      });

      currentTabToSave.value = { paneId: 'left', tab };
      await handleSave();

      expect(fsMocks.files.get('D:/notes/important.md')).toBe('# Hours of work');
      expect([...fsMocks.files.keys()].filter(path => path.endsWith('.tmp'))).toEqual([]);
      expect(tab.hasChanges).toBe(true);
    });
  });
  it('refuses first-time close-save to an owned target without changing either file or tab', async () => {
    const tab = createMockTab({ hasChanges: true, markdown: 'New work' });
    fsMocks.files.set('/owned.md', 'Other saved work');
    const before = { ...tab };
    const options = { ...createMockOptions([{ paneId: 'left', tab }]), reserveSaveTarget: vi.fn(async () => null) };
    const { save } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(save).mockResolvedValueOnce('/owned.md');
    const closing = useCloseConfirmation(options);
    await closing.setupCloseHandler(); await requestClose(); await closing.handleSave();
    expect({ ...tab }).toEqual(before);
    expect([...fsMocks.files]).toEqual([['/owned.md', 'Other saved work']]);
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
    expect(closing.showSaveConfirmDialog.value).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    expect(options.reserveSaveTarget).toHaveBeenCalledTimes(1);
  });

});
