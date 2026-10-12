import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WriteFileOptions } from '@tauri-apps/plugin-fs';
import { mount } from '@vue/test-utils';
import SplitContainer from '../../components/SplitContainer.vue';
import { useSplitView } from '../../composables/useSplitView';
import { createDefaultSplitViewState } from '../../types/pane';

const mocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  const registry = new Map<string, string>();
  const destination = new Map<string, string>();
  const destinationReady = vi.fn(async () => {});
  const commitReady = vi.fn(async () => {});
  return {
    files, registry, destination, destinationReady, commitReady,
    dropOutside: null as null | ((tabId: string, paneId: string, filePath: string) => Promise<void>),
    writeTextFile: vi.fn(async (path: string, content: string, options?: WriteFileOptions) => {
      if (options?.createNew && files.has(path)) throw new Error(`EEXIST: ${path}`);
      if (!options?.createNew && options?.create === false && !files.has(path)) throw new Error(`ENOENT: ${path}`);
      files.set(path, content);
    }),
    readTextFile: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
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
    createNewWindow: vi.fn(async (path: string) => {
      registry.set(path, 'target');
      destination.set(path, files.get(path)!);
      await destinationReady();
      return 'target';
    }),
    createTransferWindow: vi.fn(async () => { await destinationReady(); return 'target'; }),
    closeWindow: vi.fn(async (_label: string) => {}),
    transferTabToWindow: vi.fn(async (path: string, _source: string, target: string) => {
      await commitReady();
      registry.set(path, target);
      destination.set(path, files.get(path)!);
    }),
    unregisterOpenFile: vi.fn(async (path: string) => { registry.delete(path); }),
    getAllWindows: vi.fn(async () => ['main']),
    closeCurrentWindow: vi.fn(async () => {}),
  };
});

vi.mock('@tauri-apps/plugin-fs', () => mocks);
vi.mock('../../utils/save-audit', () => ({ auditShrink: vi.fn() }));
vi.mock('../../composables/useTabDrag', () => ({
  useTabDrag: () => ({
    setOnDrop: vi.fn(),
    setOnDropOutside: (callback: typeof mocks.dropOutside) => { mocks.dropOutside = callback; },
  }),
}));
vi.mock('../../composables/useWindowManager', () => ({
  useWindowManager: () => ({
    ...mocks,
    getCurrentWindowLabel: vi.fn(async () => 'main'),
  }),
}));
vi.mock('../../components/EditorPane.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../../components/ResizeDivider.vue', () => ({ default: { template: '<div />' } }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('saving before tab transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.clear();
    mocks.registry.clear();
    mocks.registry.set('/notes/doc.md', 'main');
    mocks.destination.clear();
    useSplitView().splitState.value = createDefaultSplitViewState();
  });

  it('returns null when the requested editor pane is unavailable', () => {
    const wrapper = mount(SplitContainer);
    try {
      expect(wrapper.vm.getEditorContent('right')).toBeNull();
    } finally { wrapper.unmount(); }
  });

  it('keeps newer edits and the source tab when they arrive during the save', async () => {
    const split = useSplitView();
    const tab = split.splitState.value.panes[0].tabs[0];
    tab.filePath = '/notes/doc.md';
    tab.originalMarkdown = '# Old';
    tab.content = '<p>Snapshot</p>';
    tab.hasChanges = true;
    const started = deferred();
    const release = deferred();
    mocks.rename.mockImplementationOnce(async (from, to) => {
      started.resolve();
      await release.promise;
      if (!mocks.files.has(from)) throw new Error(`ENOENT rename: ${from}`);
      mocks.files.set(to, mocks.files.get(from)!);
      mocks.files.delete(from);
    });
    const wrapper = mount(SplitContainer, { props: { reserveSaveTarget: async (_state: unknown, filePath: string) => ({ filePath, created: false, finish: async () => true }), getTabMarkdown: () => '# Snapshot' } });
    try {
      const transferring = mocks.dropOutside!(tab.id, 'left', tab.filePath);
      await started.promise;
      split.updateTabContent('left', tab.id, '<p>Snapshot plus newer work</p>');
      split.updateTabChanges('left', tab.id, true);
      release.resolve();
      await transferring;

      expect(mocks.files.get('/notes/doc.md')).toBe('# Snapshot');
      expect.soft(split.splitState.value.panes[0].tabs).toContain(tab);
      expect.soft(tab.hasChanges).toBe(true);
      expect.soft(mocks.createNewWindow).not.toHaveBeenCalled();
      expect.soft(mocks.createTransferWindow).not.toHaveBeenCalled();
      expect.soft(mocks.unregisterOpenFile).not.toHaveBeenCalled();
      expect.soft(mocks.registry.get('/notes/doc.md')).toBe('main');
      expect.soft(mocks.destination.has('/notes/doc.md')).toBe(false);
    } finally {
      release.resolve();
      wrapper.unmount();
    }
  });

  it('does not remove newer work when the window handoff is already pending', async () => {
    const split = useSplitView();
    const tab = split.splitState.value.panes[0].tabs[0];
    tab.filePath = '/notes/doc.md';
    tab.content = '<p>Snapshot</p>';
    tab.hasChanges = true;
    const started = deferred();
    const release = deferred();
    mocks.destinationReady.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
    });
    const wrapper = mount(SplitContainer, { props: { reserveSaveTarget: async (_state: unknown, filePath: string) => ({ filePath, created: false, finish: async () => true }), getTabMarkdown: () => '# Snapshot' } });
    try {
      const transferring = mocks.dropOutside!(tab.id, 'left', tab.filePath);
      await started.promise;
      split.updateTabContent('left', tab.id, '<p>Snapshot plus newer work</p>');
      split.updateTabChanges('left', tab.id, true);
      release.resolve();
      await transferring;

      expect.soft(split.splitState.value.panes[0].tabs).toContain(tab);
      expect.soft(tab.hasChanges).toBe(true);
      expect.soft(mocks.closeCurrentWindow).not.toHaveBeenCalled();
      expect.soft(mocks.registry.get('/notes/doc.md')).toBe('main');
      expect.soft(mocks.destination.has('/notes/doc.md')).toBe(false);
      expect.soft(mocks.closeWindow).toHaveBeenCalledWith('target');
    } finally {
      release.resolve();
      wrapper.unmount();
    }
  });

  it('detaches the source before committing ownership and opens only the destination document', async () => {
    const split = useSplitView();
    const tab = split.splitState.value.panes[0].tabs[0];
    Object.assign(tab, { filePath: '/notes/doc.md', content: '<p>Snapshot</p>', hasChanges: true });
    const started = deferred();
    const release = deferred();
    mocks.commitReady.mockImplementationOnce(async () => { started.resolve(); await release.promise; });
    const wrapper = mount(SplitContainer, { props: { reserveSaveTarget: async (_state: unknown, filePath: string) => ({ filePath, created: false, finish: async () => true }), getTabMarkdown: () => 'Snapshot' } });
    try {
      const transferring = mocks.dropOutside!(tab.id, 'left', tab.filePath!);
      await started.promise;
      expect.soft(split.splitState.value.panes[0].tabs).not.toContain(tab);
      expect.soft(mocks.registry.get('/notes/doc.md')).toBe('main');
      expect.soft(mocks.destination.has('/notes/doc.md')).toBe(false);
      release.resolve();
      await transferring;
      expect(mocks.registry.get('/notes/doc.md')).toBe('target');
      expect(mocks.destination.get('/notes/doc.md')).toBe('Snapshot');
      expect(split.splitState.value.panes[0].tabs).not.toContain(tab);
    } finally { release.resolve(); wrapper.unmount(); }
  });

  it('restores the source and its ownership when the ownership commit fails', async () => {
    const split = useSplitView();
    const tab = split.splitState.value.panes[0].tabs[0];
    Object.assign(tab, { filePath: '/notes/doc.md', content: '<p>Snapshot</p>', hasChanges: true });
    mocks.transferTabToWindow.mockRejectedValueOnce(new Error('destination missing before commit'));
    const wrapper = mount(SplitContainer, { props: { reserveSaveTarget: async (_state: unknown, filePath: string) => ({ filePath, created: false, finish: async () => true }), getTabMarkdown: () => 'Snapshot' } });
    try {
      await mocks.dropOutside!(tab.id, 'left', tab.filePath!);
      expect(split.splitState.value.panes[0].tabs).toContain(tab);
      expect(mocks.registry.get('/notes/doc.md')).toBe('main');
      expect(mocks.destination.has('/notes/doc.md')).toBe(false);
      expect(mocks.closeCurrentWindow).not.toHaveBeenCalled();
      expect(tab.hasChanges).toBe(false);
      expect(mocks.closeWindow).toHaveBeenCalledWith('target');
    } finally { wrapper.unmount(); }
  });
});
