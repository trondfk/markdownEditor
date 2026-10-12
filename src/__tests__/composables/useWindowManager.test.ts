import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { captureSaveState, getDocumentId } from '../../utils/save-state';
import type { Tab } from '../../composables/useTabs';
import { useWindowManager } from '../../composables/useWindowManager';

describe('useWindowManager', () => {
  let windowManager: ReturnType<typeof useWindowManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as Record<string, unknown>).__mermarkFileOpeningInstance = 'frontend-1';
    windowManager = useWindowManager();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__mermarkFileOpeningInstance;
    vi.useRealTimers();
  });

  describe('file-opening frontend identity', () => {
    it('sends the native instance with claims and both forms of release', async () => {
      await windowManager.registerOpenFile('/test.md', 'main');
      await windowManager.unregisterOpenFile('/test.md');
      await windowManager.unregisterWindowFiles('main');
      expect(invoke).toHaveBeenCalledWith('register_open_file', {
        filePath: '/test.md', windowLabel: 'main', frontendInstance: 'frontend-1',
      });
      expect(invoke).toHaveBeenCalledWith('unregister_open_file', {
        filePath: '/test.md', frontendInstance: 'frontend-1',
      });
      expect(invoke).toHaveBeenCalledWith('unregister_window_files', {
        windowLabel: 'main', frontendInstance: 'frontend-1',
      });
    });

    it('waits for native page-load readiness before registering', async () => {
      delete (window as unknown as Record<string, unknown>).__mermarkFileOpeningInstance;
      const pending = windowManager.registerOpenFile('/test.md', 'main');
      expect(invoke).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('mermark-file-opening-ready'));
      expect(invoke).not.toHaveBeenCalled();
      (window as unknown as Record<string, unknown>).__mermarkFileOpeningInstance = 'loaded-frontend';
      window.dispatchEvent(new Event('mermark-file-opening-ready'));
      await pending;
      expect(invoke).toHaveBeenCalledExactlyOnceWith('register_open_file', {
        filePath: '/test.md', windowLabel: 'main', frontendInstance: 'loaded-frontend',
      });
    });

    it('does not mint an identity or register when native readiness is unavailable', async () => {
      vi.useFakeTimers();
      delete (window as unknown as Record<string, unknown>).__mermarkFileOpeningInstance;
      const result = expect(windowManager.registerOpenFile('/test.md', 'main'))
        .rejects.toThrow('Native file-opening instance is unavailable');
      await vi.advanceTimersByTimeAsync(10_000);
      await result;
      expect(invoke).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps delayed old-client releases bound to the retired instance after reload', async () => {
      await windowManager.registerOpenFile('/test.md', 'main');
      (window as unknown as Record<string, unknown>).__mermarkFileOpeningInstance = 'frontend-2';
      const reloaded = useWindowManager();
      await reloaded.registerOpenFile('/test.md', 'main');
      await windowManager.unregisterOpenFile('/test.md');
      await reloaded.unregisterOpenFile('/test.md');
      expect(invoke).toHaveBeenNthCalledWith(2, 'register_open_file', {
        filePath: '/test.md', windowLabel: 'main', frontendInstance: 'frontend-2',
      });
      expect(invoke).toHaveBeenNthCalledWith(3, 'unregister_open_file', {
        filePath: '/test.md', frontendInstance: 'frontend-1',
      });
      expect(invoke).toHaveBeenNthCalledWith(4, 'unregister_open_file', {
        filePath: '/test.md', frontendInstance: 'frontend-2',
      });
    });
  });

  describe('createNewWindow', () => {
    it('should invoke create_new_window with null filePath when not provided', async () => {
      vi.mocked(invoke).mockResolvedValueOnce('window-1');

      const result = await windowManager.createNewWindow();

      expect(invoke).toHaveBeenCalledWith('create_new_window', {
        filePath: null,
      });
      expect(result).toBe('window-1');
    });

    it('should invoke create_new_window with provided filePath', async () => {
      vi.mocked(invoke).mockResolvedValueOnce('window-2');

      const result = await windowManager.createNewWindow('/path/to/file.md');

      expect(invoke).toHaveBeenCalledWith('create_new_window', {
        filePath: '/path/to/file.md',
      });
      expect(result).toBe('window-2');
    });

    it('should handle null filePath explicitly', async () => {
      vi.mocked(invoke).mockResolvedValueOnce('window-3');

      const result = await windowManager.createNewWindow(null);

      expect(invoke).toHaveBeenCalledWith('create_new_window', {
        filePath: null,
      });
      expect(result).toBe('window-3');
    });
  });

  describe('getFilePathFromUrl', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      delete (window as any).location;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it('should return null when no file param exists', () => {
      (window as any).location = { search: '' };

      const result = windowManager.getFilePathFromUrl();

      expect(result).toBeNull();
    });

    it('should return decoded file path from URL', () => {
      (window as any).location = { search: '?file=%2Fpath%2Fto%2Ftest.md' };

      const result = windowManager.getFilePathFromUrl();

      expect(result).toBe('/path/to/test.md');
    });

    it('should handle special characters in file path', () => {
      (window as any).location = { search: '?file=%2Fpath%2Fto%2Fmy%20file%20(1).md' };

      const result = windowManager.getFilePathFromUrl();

      expect(result).toBe('/path/to/my file (1).md');
    });
  });

  describe('createTransferWindow', () => {
    it('creates a blank window and waits for its transfer listener before returning', async () => {
      let ready!: (event: any) => void;
      const unlisten = vi.fn();
      vi.mocked(listen).mockImplementationOnce(async (_name, callback) => {
        ready = callback;
        return unlisten;
      });
      vi.mocked(invoke).mockResolvedValueOnce('target');
      let finished = false;
      const creating = windowManager.createTransferWindow().then(label => { finished = true; return label; });
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('create_new_window', { filePath: null, deferOpen: true }));
      expect(finished).toBe(false);
      ready({ payload: 'other-window' });
      await Promise.resolve();
      expect(finished).toBe(false);
      ready({ payload: 'target' });
      expect(await creating).toBe('target');
      expect(unlisten).toHaveBeenCalledOnce();
    });

    it('handles readiness arriving before the window creation command returns', async () => {
      let ready!: (event: any) => void;
      const unlisten = vi.fn();
      vi.mocked(listen).mockImplementationOnce(async (_name, callback) => { ready = callback; return unlisten; });
      vi.mocked(invoke).mockImplementationOnce(async () => {
        ready({ payload: 'target' });
        return 'target';
      });
      expect(await windowManager.createTransferWindow()).toBe('target');
      expect(unlisten).toHaveBeenCalledOnce();
    });

    it('closes an unready blank window and releases its readiness listener on timeout', async () => {
      vi.useFakeTimers();
      try {
        const unlisten = vi.fn();
        const close = vi.fn(async () => {});
        vi.mocked(listen).mockResolvedValueOnce(unlisten);
        vi.mocked(invoke).mockResolvedValueOnce('target');
        vi.mocked(WebviewWindow.getByLabel).mockResolvedValueOnce({ close } as any);
        const rejected = expect(windowManager.createTransferWindow()).rejects.toThrow('did not become ready');
        await vi.advanceTimersByTimeAsync(15000);
        await rejected;
        expect(WebviewWindow.getByLabel).toHaveBeenCalledWith('target');
        expect(close).toHaveBeenCalledOnce();
        expect(unlisten).toHaveBeenCalledOnce();
      } finally { vi.useRealTimers(); }
    });
  });

  describe('getAllWindows', () => {
    it('should invoke get_all_windows and return window labels', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(['main', 'window-1', 'window-2']);

      const result = await windowManager.getAllWindows();

      expect(invoke).toHaveBeenCalledWith('get_all_windows');
      expect(result).toEqual(['main', 'window-1', 'window-2']);
    });

    it('should return empty array when no windows', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]);

      const result = await windowManager.getAllWindows();

      expect(result).toEqual([]);
    });
  });

  describe('getCurrentWindowLabel', () => {
    it('should invoke get_current_window_label and return label', async () => {
      vi.mocked(invoke).mockResolvedValueOnce('main');

      const result = await windowManager.getCurrentWindowLabel();

      expect(invoke).toHaveBeenCalledWith('get_current_window_label');
      expect(result).toBe('main');
    });
  });

  describe('transferTabToWindow', () => {
    it('should invoke transfer_tab_to_window with correct params', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await windowManager.transferTabToWindow(
        '/path/to/file.md',
        'main',
        'window-1'
      );

      expect(invoke).toHaveBeenCalledWith('transfer_tab_to_window', {
        filePath: '/path/to/file.md',
        sourceWindow: 'main',
        targetWindow: 'window-1',
        frontendInstance: 'frontend-1',
      });
    });
  });

  describe('onTabTransfer', () => {
    it('should register listener for tab-transfer event', async () => {
      const mockUnlisten = vi.fn();
      vi.mocked(listen).mockResolvedValueOnce(mockUnlisten);
      const callback = vi.fn();

      const unlisten = await windowManager.onTabTransfer(callback);

      expect(listen).toHaveBeenCalledWith('tab-transfer', expect.any(Function));
      expect(unlisten).toBe(mockUnlisten);
    });

    it('should call callback with payload when event received', async () => {
      const mockUnlisten = vi.fn();
      let eventHandler: (event: any) => void;

      vi.mocked(listen).mockImplementationOnce(async (_eventName, handler) => {
        eventHandler = handler as (event: any) => void;
        return mockUnlisten;
      });

      const callback = vi.fn();
      await windowManager.onTabTransfer(callback);

      eventHandler!({
        payload: {
          file_path: '/path/to/file.md',
          source_window: 'main',
          target_window: 'window-1',
        },
      });

      expect(callback).toHaveBeenCalledWith({
        file_path: '/path/to/file.md',
        source_window: 'main',
        target_window: 'window-1',
      });
    });
  });

  describe('closeCurrentWindow', () => {
    it('should get current window and close it', async () => {
      const mockClose = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getCurrentWindow).mockReturnValue({ close: mockClose } as any);

      await windowManager.closeCurrentWindow();

      expect(getCurrentWindow).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });
  it('reserves a target with the stable document and operation identity and publishes before releasing', async () => {
    const tab: Tab = { id: 'same-tab-id', filePath: '/old.md', fileName: 'old.md', content: '<p>A</p>', markdown: 'A', originalMarkdown: 'A', hasChanges: false, scrollTop: 0 };
    const state = captureSaveState(tab);
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'reserved', file_path: '/new.md', reservation_id: 'lease-1', created: true });
    const lease = await windowManager.reserveSaveTarget(state, '/new.md');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('reserve_save_target', {
      filePath: '/new.md', frontendInstance: 'frontend-1', documentId: getDocumentId(tab), sourcePath: '/old.md', sequence: state.sequence,
    });
    vi.mocked(invoke).mockResolvedValueOnce(true);
    expect(await lease!.finish(true, true)).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('finish_save_target', { reservationId: 'lease-1', frontendInstance: 'frontend-1', committed: true, publish: true });
  });

  it('does not manufacture a lease for an occupied target', async () => {
    const tab: Tab = { id: 'a', filePath: null, fileName: 'new', content: '<p></p>', originalMarkdown: null, hasChanges: false, scrollTop: 0 };
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'occupied', file_path: '/owned.md', window_label: 'main' });
    expect(await windowManager.reserveSaveTarget(captureSaveState(tab), '/owned.md')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('retries an unknown finalization reply with exactly the same reservation identity', async () => {
    const tab: Tab = { id: 'new', filePath: null, fileName: 'new', content: '<p>A</p>', originalMarkdown: null, hasChanges: true, scrollTop: 0 };
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'reserved', file_path: '/new.md', reservation_id: 'lease-retry', created: true });
    const lease = await windowManager.reserveSaveTarget(captureSaveState(tab), '/new.md');
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Reply unavailable')).mockResolvedValueOnce(true);
    expect(await lease!.finish(true, true)).toBe(true);
    const calls = vi.mocked(invoke).mock.calls.slice(-2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toEqual(['finish_save_target', { reservationId: 'lease-retry', frontendInstance: 'frontend-1', committed: true, publish: true }]);
  });

});
