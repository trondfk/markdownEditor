// ABOUTME: Writes a text file through a verified temporary sibling instead of straight onto the target.
// ABOUTME: Shared by manual save, autosave, close-save and transfer-save.

import { writeTextFile, readTextFile, rename, remove } from '@tauri-apps/plugin-fs';

const pendingWrites = new Map<string, Promise<void>>();

export interface AtomicWriteOptions {
  canWrite?: () => boolean;
  onCommitted?: () => void;
}

export class AtomicWriteCancelledError extends Error {
  constructor() {
    super('The save operation is no longer current');
    this.name = 'AtomicWriteCancelledError';
  }
}

/**
 * Reserves FIFO order synchronously for the exact path in this module instance.
 * Other windows, path aliases and writers outside this module are not coordinated.
 */
export function atomicWriteTextFile(filePath: string, content: string, options?: AtomicWriteOptions): Promise<void> {
  const previous = pendingWrites.get(filePath) ?? Promise.resolve();
  const writing = previous.then(() => writeVerifiedFile(filePath, content, options));
  // Only the queue tail absorbs failure. The caller still receives the write error.
  const settled = writing.then(() => undefined, () => undefined);
  pendingWrites.set(filePath, settled);
  void settled.then(() => {
    if (pendingWrites.get(filePath) === settled) pendingWrites.delete(filePath);
  });
  return writing;
}

async function writeVerifiedFile(filePath: string, content: string, options?: AtomicWriteOptions): Promise<void> {
  if (options?.canWrite && !options.canWrite()) throw new AtomicWriteCancelledError();
  const directoryEnd = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1;
  const tmpPath = `${filePath.slice(0, directoryEnd)}mermark-${crypto.randomUUID()}.tmp`;
  // Reserve ownership before writing the payload. Failed creation must not clean
  // up a path that could belong to another operation.
  await writeTextFile(tmpPath, '', { createNew: true });
  try {
    await writeTextFile(tmpPath, content, { create: false });
    const written = await readTextFile(tmpPath);
    if (written !== content) {
      throw new Error('atomic write verification failed: the bytes on disk do not match what we wrote');
    }
    // Recheck after asynchronous preparation, with no await before starting rename.
    if (options?.canWrite && !options.canWrite()) throw new AtomicWriteCancelledError();
    await rename(tmpPath, filePath);
  } catch (error) {
    try {
      await remove(tmpPath);
    } catch {
      /* preserve the original write, verification or rename error */
    }
    throw error;
  }
  // Record the successful commit before releasing this target's FIFO position.
  options?.onCommitted?.();
}
