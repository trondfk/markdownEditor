import { describe, expect, it, vi } from 'vitest';
import { useFileOpening } from '../../composables/useFileOpening';
import type { OpenFileClaim } from '../../composables/useWindowManager';
import { computed, ref } from 'vue';
import type { Tab } from '../../composables/useTabs';
import { useFileOperations } from '../../composables/useFileOperations';

const fsMocks = vi.hoisted(() => ({ readTextFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: fsMocks.readTextFile,
  writeTextFile: vi.fn(), rename: vi.fn(), remove: vi.fn(),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(label = 'main') {
  const registry = new Map<string, string>();
  const local = new Set<string>();
  const options = {
    getWindowLabel: vi.fn(() => label),
    registerOpenFile: vi.fn(async (_path: string, window: string): Promise<OpenFileClaim> => {
      const path = '/canonical/document.md';
      const owner = registry.get(path);
      if (owner) return { file_path: path, window_label: owner, acquired: false, document_id: "opening-document" };
      registry.set(path, window);
      return { file_path: path, window_label: window, acquired: true, document_id: "opening-document" };
    }),
    unregisterOpenFile: vi.fn(async (path: string) => {
      if (registry.get(path) === label) registry.delete(path);
    }),
    focusWindowWithFile: vi.fn(async () => true),
    findLocalFile: vi.fn((path: string) => local.has(path)),
    activateLocalFile: vi.fn(async () => {}),
    bindDocumentIdentity: vi.fn(),
    loadFile: vi.fn(async (path: string) => { local.add(path); return true; }),
  };
  return { options, registry, local, opener: useFileOpening(options) };
}

describe('atomic file opening', () => {
  it('claims before loading and uses the native canonical path', async () => {
    const { opener, options, registry } = fixture();
    options.loadFile.mockImplementation(async path => {
      expect(registry.get(path)).toBe('main');
      return true;
    });
    await opener.openFile('/alias/document.md');
    expect(options.loadFile).toHaveBeenCalledExactlyOnceWith('/canonical/document.md');
    expect(options.bindDocumentIdentity).toHaveBeenCalledExactlyOnceWith('/canonical/document.md', 'opening-document');
    expect(options.unregisterOpenFile).not.toHaveBeenCalled();
  });

  it('activates the existing owner in another window without loading', async () => {
    const { opener, options, registry } = fixture();
    registry.set('/canonical/document.md', 'window-2');
    await opener.openFile('/alias/document.md');
    expect(options.loadFile).not.toHaveBeenCalled();
    expect(options.focusWindowWithFile).toHaveBeenCalledExactlyOnceWith('/canonical/document.md');
    expect(registry.get('/canonical/document.md')).toBe('window-2');
  });

  it('activates the existing local tab without loading a second document', async () => {
    const { opener, options, registry, local } = fixture();
    registry.set('/canonical/document.md', 'main');
    local.add('/canonical/document.md');
    await opener.openFile('/alias/document.md');
    expect(options.activateLocalFile).toHaveBeenCalledExactlyOnceWith('/canonical/document.md');
    expect(options.loadFile).not.toHaveBeenCalled();
  });

  it('does not load or release when registration fails', async () => {
    const { opener, options } = fixture();
    options.registerOpenFile.mockRejectedValueOnce(new Error('Registry unavailable'));
    await expect(opener.openFile('/document.md')).rejects.toThrow('Registry unavailable');
    expect(options.loadFile).not.toHaveBeenCalled();
    expect(options.unregisterOpenFile).not.toHaveBeenCalled();
  });

  it('releases the acquired canonical reservation when loading fails', async () => {
    const { opener, options, registry } = fixture();
    options.loadFile.mockResolvedValueOnce(false);
    await expect(opener.openFile('/alias/document.md')).rejects.toThrow('File loading failed');
    expect(options.unregisterOpenFile).toHaveBeenCalledExactlyOnceWith('/canonical/document.md', 'opening-document');
    expect(registry.size).toBe(0);
  });

  it('releases a reservation after a thrown read error', async () => {
    const { opener, options, registry } = fixture();
    options.loadFile.mockRejectedValueOnce(new Error('Read failed'));
    await expect(opener.openFile('/document.md')).rejects.toThrow('Read failed');
    expect(registry.size).toBe(0);
  });

  it('releases ownership when the real file loader catches a filesystem read failure', async () => {
    const { options, registry } = fixture();
    const tabs = ref<Tab[]>([{
      id: 'empty', filePath: null, fileName: 'New', content: '<p></p>',
      hasChanges: false, scrollTop: 0, originalMarkdown: null,
    }]);
    const createNewTab = vi.fn();
    const operations = useFileOperations({
    reserveSaveTarget: vi.fn(),
      tabs, activeTabId: ref('empty'), activeTab: computed(() => tabs.value[0]),
      findTabByFilePath: () => undefined, createNewTab,
      switchToTab: vi.fn(), getEditorHtml: () => '<p></p>', setEditorContent: vi.fn(),
    });
    fsMocks.readTextFile.mockRejectedValueOnce(new Error('Actual read failure'));
    const opener = useFileOpening({ ...options, loadFile: operations.openFileFromPath });
    await expect(opener.openFile('/alias/document.md')).rejects.toThrow('File loading failed');
    expect(fsMocks.readTextFile).toHaveBeenCalledWith('/canonical/document.md');
    expect(tabs.value[0].filePath).toBeNull();
    expect(createNewTab).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it('does not release a live document when a later UI callback throws', async () => {
    const { opener, options, registry, local } = fixture();
    options.loadFile.mockImplementationOnce(async path => {
      local.add(path);
      throw new Error('UI failed');
    });
    await expect(opener.openFile('/document.md')).rejects.toThrow('UI failed');
    expect(options.unregisterOpenFile).not.toHaveBeenCalled();
    expect(registry.get('/canonical/document.md')).toBe('main');
    expect(options.bindDocumentIdentity).toHaveBeenCalledExactlyOnceWith('/canonical/document.md', 'opening-document');
  });

  it('does not open a copy if focusing the existing owner fails', async () => {
    const { opener, options, registry } = fixture();
    registry.set('/canonical/document.md', 'other');
    options.focusWindowWithFile.mockResolvedValueOnce(false);
    await expect(opener.openFile('/document.md')).rejects.toThrow('could not be activated');
    expect(options.loadFile).not.toHaveBeenCalled();
    expect(options.unregisterOpenFile).not.toHaveBeenCalled();
  });

  it('joins an in-progress same-window opening through aliases', async () => {
    const { opener, options, local } = fixture();
    const entered = deferred(), release = deferred();
    options.loadFile.mockImplementationOnce(async path => {
      entered.resolve();
      await release.promise;
      local.add(path);
      return true;
    });
    const first = opener.openFile('/alias-1/document.md');
    await entered.promise;
    const secondClaimed = deferred();
    const originalClaim = options.registerOpenFile.getMockImplementation()!;
    options.registerOpenFile.mockImplementationOnce(async (...args) => {
      const result = await originalClaim(...args);
      secondClaimed.resolve();
      return result;
    });
    const second = opener.openFile('/alias-2/document.md');
    await secondClaimed.promise;
    expect(options.loadFile).toHaveBeenCalledTimes(1);
    release.resolve();
    await Promise.all([first, second]);
    expect(options.loadFile).toHaveBeenCalledTimes(1);
    expect(options.activateLocalFile).toHaveBeenCalledTimes(1);
  });

  it('never loads merely because a same-window reservation exists', async () => {
    const { opener, options, registry } = fixture();
    registry.set('/canonical/document.md', 'main');
    await opener.openFile('/document.md');
    expect(options.loadFile).not.toHaveBeenCalled();
    expect(options.focusWindowWithFile).toHaveBeenCalled();
  });

  it('does not release ownership that moved to another window during a failed load', async () => {
    const { opener, options, registry } = fixture();
    options.loadFile.mockImplementationOnce(async path => {
      registry.set(path, 'other');
      return false;
    });
    await expect(opener.openFile('/document.md')).rejects.toThrow('File loading failed');
    expect(registry.get('/canonical/document.md')).toBe('other');
  });
});
