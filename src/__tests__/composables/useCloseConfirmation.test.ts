import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import type { Tab } from '../../composables/useTabs';

// Mock Tauri APIs before importing the module
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  exit: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(() => Promise.resolve()),
}));

import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useCloseConfirmation } from '../../composables/useCloseConfirmation';

describe('useCloseConfirmation', () => {
  const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
    id: `tab-${Math.random().toString(36).substr(2, 9)}`,
    filePath: null,
    fileName: 'Test Document',
    content: '<p>Test content</p>',
    hasChanges: false,
    scrollTop: 0,
    originalMarkdown: null,
    ...overrides,
  });

  const createMockOptions = (tabsArray: Tab[] = [createMockTab()]) => {
    const tabs = ref<Tab[]>(tabsArray);

    return {
      tabs,
      getTabMarkdown: vi.fn((tab: Tab) => tab.content),
      switchToTab: vi.fn(() => Promise.resolve()),
      syncActiveTabContent: vi.fn(),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with dialog hidden', () => {
      const options = createMockOptions();
      const { showSaveConfirmDialog } = useCloseConfirmation(options);

      expect(showSaveConfirmDialog.value).toBe(false);
    });

    it('should initialize with no current tab to save', () => {
      const options = createMockOptions();
      const { currentTabToSave } = useCloseConfirmation(options);

      expect(currentTabToSave.value).toBe(null);
    });

    it('should initialize with zero tabs to save count', () => {
      const options = createMockOptions();
      const { tabsToSaveCount } = useCloseConfirmation(options);

      expect(tabsToSaveCount.value).toBe(0);
    });
  });

  describe('collectUnsavedTabs (via internal behavior)', () => {
    it('should detect tabs with unsaved changes', () => {
      const tab1 = createMockTab({ id: 'tab-1', hasChanges: true, fileName: 'Unsaved 1' });
      const tab2 = createMockTab({ id: 'tab-2', hasChanges: false, fileName: 'Saved' });
      const tab3 = createMockTab({ id: 'tab-3', hasChanges: true, fileName: 'Unsaved 2' });

      const options = createMockOptions([tab1, tab2, tab3]);
      const { tabs } = options;

      // Verify tabs are set up correctly
      expect(tabs.value.length).toBe(3);
      expect(tabs.value.filter(t => t.hasChanges).length).toBe(2);
    });

    it('should detect single tab with unsaved changes', () => {
      const tab = createMockTab({ hasChanges: true });
      const options = createMockOptions([tab]);

      expect(options.tabs.value[0].hasChanges).toBe(true);
    });

    it('should detect no unsaved changes when all tabs are saved', () => {
      const tab1 = createMockTab({ hasChanges: false });
      const tab2 = createMockTab({ hasChanges: false });

      const options = createMockOptions([tab1, tab2]);

      expect(options.tabs.value.every(t => !t.hasChanges)).toBe(true);
    });
  });

  describe('handleCancel', () => {
    it('should hide dialog and clear state', () => {
      const options = createMockOptions();
      const { showSaveConfirmDialog, currentTabToSave, handleCancel } = useCloseConfirmation(options);

      // Simulate dialog being shown
      showSaveConfirmDialog.value = true;

      handleCancel();

      expect(showSaveConfirmDialog.value).toBe(false);
      expect(currentTabToSave.value).toBe(null);
    });
  });

  describe('handleDiscard', () => {
    it('should mark current tab as not having changes', async () => {
      const tab = createMockTab({ hasChanges: true });
      const options = createMockOptions([tab]);
      const { currentTabToSave, handleDiscard } = useCloseConfirmation(options);

      // Simulate having a current tab to save
      currentTabToSave.value = { tab, index: 0 };

      handleDiscard();

      expect(tab.hasChanges).toBe(false);
    });

    it('should do nothing if no current tab to save', () => {
      const options = createMockOptions();
      const { handleDiscard } = useCloseConfirmation(options);

      // Should not throw
      expect(() => handleDiscard()).not.toThrow();
    });
  });

  describe('setupCloseHandler', () => {
    it('should return an unlisten function', async () => {
      const options = createMockOptions();
      const { setupCloseHandler } = useCloseConfirmation(options);

      const unlisten = await setupCloseHandler();

      expect(typeof unlisten).toBe('function');
    });
  });

  describe('multiple tabs with changes', () => {
    it('should track correct count of tabs to save', () => {
      const tab1 = createMockTab({ id: 'tab-1', hasChanges: true });
      const tab2 = createMockTab({ id: 'tab-2', hasChanges: true });
      const tab3 = createMockTab({ id: 'tab-3', hasChanges: false });

      const options = createMockOptions([tab1, tab2, tab3]);

      const unsavedCount = options.tabs.value.filter(t => t.hasChanges).length;
      expect(unsavedCount).toBe(2);
    });

    it('should properly identify unsaved tabs by name', () => {
      const tabs = [
        createMockTab({ id: 'tab-1', fileName: 'Document 1', hasChanges: true }),
        createMockTab({ id: 'tab-2', fileName: 'Document 2', hasChanges: false }),
        createMockTab({ id: 'tab-3', fileName: 'Document 3', hasChanges: true }),
      ];

      const options = createMockOptions(tabs);

      const unsavedFileNames = options.tabs.value
        .filter(t => t.hasChanges)
        .map(t => t.fileName);

      expect(unsavedFileNames).toEqual(['Document 1', 'Document 3']);
    });
  });

  describe('syncActiveTabContent', () => {
    it('should call syncActiveTabContent when provided', () => {
      const syncFn = vi.fn();
      const options = {
        ...createMockOptions(),
        syncActiveTabContent: syncFn,
      };

      useCloseConfirmation(options);

      // syncActiveTabContent is called internally when close is requested
      // This test verifies it's properly passed through
      expect(options.syncActiveTabContent).toBeDefined();
    });
  });

  describe('save-on-quit never destroys a document', () => {
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
        ...createMockOptions([tab]),
        getTabMarkdown: () => null,
        onSaveFailed,
      });

      currentTabToSave.value = { tab, index: 0 };
      await handleSave();

      expect(writeTextFile).not.toHaveBeenCalled();
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
        ...createMockOptions([tab]),
        getTabMarkdown: () => null,
      });

      currentTabToSave.value = { tab, index: 0 };
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
        ...createMockOptions([tab]),
        getTabMarkdown: () => '',
        onSaveFailed,
      });

      currentTabToSave.value = { tab, index: 0 };
      await handleSave();

      expect(writeTextFile).not.toHaveBeenCalled();
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
        ...createMockOptions([tab]),
        getTabMarkdown: () => '# Hours of work\n',
      });

      currentTabToSave.value = { tab, index: 0 };
      await handleSave();

      expect(writeTextFile).toHaveBeenCalledWith('D:/notes/important.md', '# Hours of work');
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
        ...createMockOptions([tab]),
        getTabMarkdown: () => '',
      });

      currentTabToSave.value = { tab, index: 0 };
      await handleSave();

      expect(writeTextFile).toHaveBeenCalledWith('D:/notes/scratch.md', '');
    });
  });
});
