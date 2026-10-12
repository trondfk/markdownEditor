import type { Page } from '@playwright/test';

/**
 * Virtual file system state passed from the test via exposeFunction.
 * We use page.exposeFunction so the browser-side script can call back into
 * Node.js to read/write the shared mock state.
 */
export interface MockFs {
  [path: string]: string;
}

/**
 * Sets up Tauri IPC mocks and a virtual file system before the page loads.
 *
 * The virtual FS is backed by a plain object in Node land so tests can
 * inspect what was written without going through the UI.
 */
export async function setupTauriMocks(
  page: Page,
  opts: {
    /** Initial file system contents */
    initialFs?: MockFs;
    /** Initial file path to report from get_open_file_path (or null) */
    openFilePath?: string | null;
    /** App version string */
    version?: string;
    beforeRead?: (path: string) => void;
    beforeRename?: (from: string, to: string) => Promise<void>;
  } = {},
): Promise<{
  /** Inspect current virtual FS state from a test */
  getFs: () => MockFs;
  /** Inspect IPC calls log from a test */
  getCalls: () => Array<{ cmd: string; args: unknown }>;
  /**
   * Simulate an external file change: updates the Node-side FS and fires a
   * synthetic watcher event so the app sees the file as changed externally.
   * The file must already be watched by the app (i.e. opened in a tab).
   */
  triggerExternalChange: (filePath: string, newContent: string) => Promise<void>;
}> {
  const fs: MockFs = { ...(opts.initialFs ?? {}) };
  const calls: Array<{ cmd: string; args: unknown }> = [];
  type Owner = { window: string; instance: string; document: string; opened: boolean; sequence: number; leases: Set<string>; placeholder?: number };
  const openFiles = new Map<string, Owner>();
  const reservations = new Map<string, { window: string; instance: string; document: string; source: string | null; target: string; sequence: number; result?: boolean }>();
  const identities = new Map(Object.keys(fs).map((path, i) => [path, i + 1]));
  let nextIdentity = identities.size;
  const retire = (label: string) => {
    for (const [path, owner] of openFiles) {
      if (owner.window === label) owner.opened = false;
      if (!owner.opened && !owner.leases.size) openFiles.delete(path);
    }
  };
  const frontendInstances = new Map<string, string>();
  let nextInstance = 0;

  await page.exposeFunction('__mockFrontendLoaded', (label: string) => {
    retire(label);
    const instance = `${label}-${++nextInstance}`;
    frontendInstances.set(label, instance);
    return instance;
  });

  await page.exposeFunction('__mockFileRegistry', (cmd: string, path: string, label: string, instance?: string, documentId?: string) => {
    calls.push({ cmd, args: { path, label } });
    if (['register_open_file', 'unregister_open_file', 'unregister_window_files'].includes(cmd)
        && (!instance || frontendInstances.get(label) !== instance)) {
      throw new Error('The file-opening frontend instance is no longer current');
    }
    if (cmd === 'register_open_file') {
      if (!(path in fs)) throw new Error(`ENOENT: ${path}`);
      const owner = openFiles.get(path);
      if (owner) return { file_path: path, window_label: owner.window, document_id: owner.document, acquired: false };
      const document = crypto.randomUUID();
      openFiles.set(path, { window: label, instance: instance!, document, opened: true, sequence: 0, leases: new Set() });
      return { file_path: path, window_label: label, document_id: document, acquired: true };
    }
    if (cmd === 'unregister_open_file') {
      const owner = openFiles.get(path);
      if (owner?.window === label && owner.document === documentId) {
        owner.opened = false;
        if (!owner.leases.size) openFiles.delete(path);
      }
      return undefined;
    }
    if (cmd === 'unregister_window_files') {
      retire(label);
      return undefined;
    }
    if (cmd === 'focus_window_with_file') return openFiles.has(path);
    return openFiles.get(path)?.window ?? null;
  });

  await page.exposeFunction('__mockSaveTarget', (cmd: string, input: { filePath?: string; frontendInstance: string; documentId?: string; sourcePath?: string | null; sequence?: number; reservationId?: string; committed?: boolean; publish?: boolean }) => {
    calls.push({ cmd, args: input });
    const label = 'main';
    if (cmd === 'reserve_save_target') {
      if (frontendInstances.get(label) !== input.frontendInstance) throw new Error('Retired frontend');
      const document = input.documentId!;
      const source = input.sourcePath ?? null;
      if (source) {
        const owner = openFiles.get(source);
        if (!owner?.opened || owner.window !== label || owner.instance !== input.frontendInstance || owner.document !== document) throw new Error('Source ownership changed');
      }
      const path = input.filePath!;
      let owner = openFiles.get(path);
      if (owner && (owner.window !== label || owner.document !== document || owner.instance !== input.frontendInstance)) {
        return { status: 'occupied', file_path: path, window_label: owner.window };
      }
      const created = !(path in fs);
      if (created) { fs[path] = ''; identities.set(path, ++nextIdentity); }
      if (!owner) {
        owner = { window: label, instance: input.frontendInstance, document, opened: false, sequence: 0, leases: new Set(), placeholder: created ? identities.get(path) : undefined };
        openFiles.set(path, owner);
      }
      const token = crypto.randomUUID();
      owner.leases.add(token);
      if (source) openFiles.get(source)!.leases.add(token);
      reservations.set(token, { window: label, instance: input.frontendInstance, document, source, target: path, sequence: input.sequence! });
      return { status: 'reserved', file_path: path, reservation_id: token, created };
    }
    const token = input.reservationId!;
    const reservation = reservations.get(token);
    if (!reservation || reservation.window !== label || reservation.instance !== input.frontendInstance) throw new Error('Wrong reservation owner');
    if (reservation.result !== undefined) return reservation.result;
    const owners = [...openFiles.entries()].filter(([, owner]) => owner.document === reservation.document);
    const binding = owners.find(([, owner]) => owner.opened)?.[0] ?? null;
    const latest = Math.max(0, ...owners.map(([, owner]) => owner.sequence));
    const publish = !!input.committed && (input.publish ?? input.committed) && frontendInstances.get(label) === input.frontendInstance && binding === reservation.source && reservation.sequence > latest;
    if (publish) for (const [path, owner] of owners) {
      owner.opened = path === reservation.target; owner.sequence = reservation.sequence;
      if (owner.opened) owner.placeholder = undefined;
    }
    const target = openFiles.get(reservation.target)!;
    if (!input.committed && target.leases.size === 1 && target.placeholder !== undefined
        && identities.get(reservation.target) === target.placeholder && fs[reservation.target] === '') {
      delete fs[reservation.target]; identities.delete(reservation.target);
    }
    for (const [path, owner] of openFiles) {
      owner.leases.delete(token);
      if (!owner.opened && !owner.leases.size) openFiles.delete(path);
    }
    reservation.result = publish;
    return publish;
  });

  // Expose Node-side functions so the browser script can call them
  await page.exposeFunction('__mockFsRead', (path: string): string => {
    calls.push({ cmd: 'read', args: path });
    opts.beforeRead?.(path);
    if (!(path in fs)) throw new Error(`ENOENT: ${path}`);
    return fs[path];
  });

  await page.exposeFunction('__mockFsWrite', (path: string, content: string, options?: { createNew?: boolean; create?: boolean }): void => {
    calls.push({ cmd: 'write', args: { path, content, options } });
    if (options?.createNew && path in fs) throw new Error(`EEXIST: ${path}`);
    if (!options?.createNew && options?.create === false && !(path in fs)) throw new Error(`ENOENT: ${path}`);
    if (!(path in fs)) identities.set(path, ++nextIdentity);
    fs[path] = content;
  });

  await page.exposeFunction('__mockFsRename', async (from: string, to: string): Promise<void> => {
    calls.push({ cmd: 'rename', args: { from, to } });
    await opts.beforeRename?.(from, to);
    if (!(from in fs)) throw new Error(`ENOENT rename: ${from}`);
    fs[to] = fs[from];
    identities.set(to, identities.get(from)!);
    identities.delete(from);
    delete fs[from];
  });

  await page.exposeFunction('__mockFsRemove', (path: string): void => {
    calls.push({ cmd: 'remove', args: path });
    if (!(path in fs)) throw new Error(`ENOENT remove: ${path}`);
    delete fs[path];
    identities.delete(path);
  });

  await page.exposeFunction('__mockFsExists', (path: string): boolean => {
    return path in fs;
  });

  await page.exposeFunction('__mockFsWatch', (): void => {
    // no-op — watcher registration is tracked browser-side via __watchCallbacks
  });

  // NOTE: dialogSavePath is intentionally NOT exposed via page.exposeFunction
  // because exposeFunction creates immutable bindings that can't be overridden
  // from tests. Instead, we use a plain window variable set in addInitScript,
  // which tests can override via page.evaluate.

  const openFilePath = opts.openFilePath ?? null;
  const version = opts.version ?? '0.0.0-test';

  // Inject mock __TAURI_INTERNALS__ before the app JS runs
  await page.addInitScript(
    ({ openFilePath, version }: { openFilePath: string | null; version: string }) => {
      // Keep the first-run AI popover from covering toolbar controls in tests.
      // Tests that provide their own settings before this mock keep them.
      if (!localStorage.getItem('mermark-settings')) {
        localStorage.setItem('mermark-settings', JSON.stringify({ ai: { hasSeenFirstRun: true } }));
      }

      // Helper to resolve a promise from a window-exposed async Node function
      const call = (fn: string, ...args: unknown[]): Promise<unknown> =>
        (window as Record<string, unknown>)[fn]?.(...args) as Promise<unknown>;

      if (window === window.top) {
        window.addEventListener('load', async () => {
          const instance = await call('__mockFrontendLoaded', 'main');
          (window as unknown as Record<string, unknown>).__mermarkFileOpeningInstance = instance;
          window.dispatchEvent(new Event('mermark-file-opening-ready'));
        }, { once: true });
      }

      // Mutable dialog save path — tests override this via page.evaluate
      // Using a plain window variable (NOT page.exposeFunction) so it can be reassigned
      (window as Record<string, unknown>).__mockDialogSavePath = null;

      // Watcher callback registry: path -> Tauri callback id
      // Filled when plugin:fs|watch is invoked (see invoke handler below).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__watchCallbacks = {} as Record<string, { id: number; index: number }>;

      // Trigger a synthetic watcher event for a path (called from test via page.evaluate).
      // The Node side must have already updated the FS content before calling this.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__triggerWatchEvent = (path: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const channel = (window as any).__watchCallbacks[path] as { id: number; index: number } | undefined;
        if (channel) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cb = (window as any)[`_cb_${channel.id}`];
          if (cb) cb({ index: channel.index++, message: { type: 'modify', paths: [path], attrs: null } });
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: 'main' },
          windows: [{ label: 'main' }],
        },

        transformCallback(callback: (data: unknown) => unknown, once: boolean) {
          const id = Math.random();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any)[`_cb_${id}`] = once
            ? (data: unknown) => { callback(data); delete (window as any)[`_cb_${id}`]; }
            : callback;
          return id;
        },

        async invoke(cmd: string, args: Record<string, unknown> | Uint8Array = {}, options: Record<string, unknown> = {}) {
          // ── fs plugin ──────────────────────────────────────────────
          if (cmd === 'plugin:fs|read_text_file') {
            const path = (args as Record<string, unknown>).path as string;
            const content = await call('__mockFsRead', path) as string;
            // Return as array of bytes (Uint8Array.from works on iterable of numbers)
            return Array.from(new TextEncoder().encode(content));
          }
          if (cmd === 'plugin:fs|write_text_file') {
            // plugin-fs v2: body = Uint8Array, path in options.headers.path (URL-encoded)
            const headers = (options as Record<string, unknown>)?.headers as Record<string, string> | undefined;
            const path = decodeURIComponent(headers?.path ?? '');
            const content = new TextDecoder().decode(args as Uint8Array);
            const writeOptions = headers?.options && headers.options !== 'undefined'
              ? JSON.parse(headers.options) : undefined;
            return call('__mockFsWrite', path, content, writeOptions);
          }
          if (cmd === 'plugin:fs|rename') {
            const a = args as Record<string, unknown>;
            return call('__mockFsRename', a.oldPath ?? a.from, a.newPath ?? a.to);
          }
          if (cmd === 'plugin:fs|remove') {
            return call('__mockFsRemove', (args as Record<string, unknown>).path);
          }
          if (cmd === 'plugin:fs|exists') {
            return call('__mockFsExists', (args as Record<string, unknown>).path);
          }
          if (cmd === 'plugin:fs|watch') {
            // Capture the Tauri callback id so tests can fire synthetic events.
            // plugin-fs v2 sends the callback through a Channel in `onEvent`.
            const watchArgs = args as Record<string, unknown>;
            const cbId = (watchArgs.onEvent as { id?: number } | undefined)?.id ?? watchArgs.id as number;
            const paths = (watchArgs.paths as string[]) ?? [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const p of paths) (window as any).__watchCallbacks[p] = { id: cbId, index: 0 };
            await call('__mockFsWatch');
            return 1;
          }
          if (cmd === 'plugin:fs|unwatch') {
            return call('__mockFsWatch');
          }

          // ── dialog plugin ──────────────────────────────────────────
          if (cmd === 'plugin:dialog|open') {
            return (window as Record<string, unknown>).__mockDialogOpenPath ?? null;
          }
          if (cmd === 'plugin:dialog|save') {
            // Read the mutable path variable (overridable from tests via page.evaluate)
            return (window as Record<string, unknown>).__mockDialogSavePath ?? null;
          }

          // ── shell plugin ───────────────────────────────────────────
          if (cmd === 'plugin:shell|open') {
            return undefined;
          }

          // ── updater ────────────────────────────────────────────────
          if (cmd.startsWith('plugin:updater')) return null;

          // ── core app ───────────────────────────────────────────────
          if (cmd === 'plugin:app|version' || cmd === 'app_get_version') return version;

          // ── event system ──────────────────────────────────────────
          if (cmd === 'plugin:event|listen') return 1; // return numeric event ID
          if (cmd === 'plugin:event|unlisten') return undefined;
          if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') return undefined;

          // ── window commands ────────────────────────────────────────
          if (cmd === 'plugin:window|set_title' || cmd === 'plugin:core|set_title') return undefined;
          if (cmd === 'plugin:window|is_maximized') return false;
          if (cmd === 'plugin:window|maximize' || cmd === 'plugin:window|unmaximize') return undefined;
          if (cmd === 'plugin:window|close' || cmd === 'plugin:window|destroy') return undefined;
          if (cmd.startsWith('plugin:window|')) return undefined;

          // ── deep-link / process ────────────────────────────────────
          if (cmd.startsWith('plugin:deep-link') || cmd.startsWith('plugin:process')) return null;

          // ── custom Rust commands ───────────────────────────────────
          if (cmd === 'get_open_file_path') return openFilePath;
          if (cmd === 'get_current_window_label') return 'main';
          if (cmd === 'reserve_save_target' || cmd === 'finish_save_target') return call('__mockSaveTarget', cmd, args);
          if (cmd === 'register_open_file' || cmd === 'unregister_open_file' || cmd === 'check_file_open' || cmd === 'get_window_for_file' || cmd === 'focus_window_with_file' || cmd === 'unregister_window_files') {
            const input = args as Record<string, unknown>;
            return call('__mockFileRegistry', cmd, input.filePath ?? '', input.windowLabel ?? 'main', input.frontendInstance, input.documentId);
          }

          // Fallback
          console.warn(`[TauriMock] Unhandled IPC: ${cmd}`, args);
          return null;
        },

        // Minimal event system
        event: {
          listen: async () => () => {},
          emit: async () => {},
          once: async () => () => {},
        },
      };
    },
    { openFilePath, version },
  );

  const triggerExternalChange = async (filePath: string, newContent: string): Promise<void> => {
    // 1. Update the Node-side virtual FS so subsequent readTextFile calls return new content
    fs[filePath] = newContent;
    // 2. Fire a synthetic watcher event in the browser — the app will read the updated content
    await page.evaluate((path: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__triggerWatchEvent(path);
    }, filePath);
  };

  return {
    getFs: () => ({ ...fs }),
    getCalls: () => [...calls],
    triggerExternalChange,
  };
}
