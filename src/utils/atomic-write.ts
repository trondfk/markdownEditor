// ABOUTME: Writes a text file through a verified temporary sibling instead of straight onto the target.
// ABOUTME: Shared by manual save, autosave, close-save and transfer-save.

import { writeTextFile, readTextFile, rename, remove } from '@tauri-apps/plugin-fs';

/**
 * Writes through an exclusively created temporary sibling, verifies its content,
 * then replaces the target by rename. Each operation owns its sibling independently
 * of other saves to the same destination.
 */
export async function atomicWriteTextFile(filePath: string, content: string): Promise<void> {
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
    await rename(tmpPath, filePath);
  } catch (error) {
    try {
      await remove(tmpPath);
    } catch {
      /* preserve the original write, verification or rename error */
    }
    throw error;
  }
}
