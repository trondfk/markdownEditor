// ABOUTME: Writes a text file through a verified temporary sibling instead of straight onto the target.
// ABOUTME: Shared by every save path so the unattended ones are as crash-safe as an explicit Ctrl+S.

import { writeTextFile, readTextFile, rename, remove } from '@tauri-apps/plugin-fs';

/**
 * Writes `content` to `filePath` via a `.tmp` sibling that is read back and
 * compared before it replaces the target.
 *
 * A direct write truncates the file first, so a crash, a full disk or a killed
 * process leaves the document half-written with no way back. Going through a
 * sibling means the original survives every failure: either the rename happens
 * and the new content is complete, or it does not and the old file is untouched.
 */
export async function atomicWriteTextFile(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  try {
    await writeTextFile(tmpPath, content);
    const written = await readTextFile(tmpPath);
    if (written !== content) {
      throw new Error('atomic write verification failed: the bytes on disk do not match what we wrote');
    }
    await rename(tmpPath, filePath);
  } catch (error) {
    // Leaving a stray .tmp behind would confuse the workspace tree and the
    // next save, so clear it even though the write itself already failed.
    try {
      await remove(tmpPath);
    } catch {
      /* the tmp file may never have been created */
    }
    throw error;
  }
}
