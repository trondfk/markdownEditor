import { describe, it, expect, vi, beforeEach } from 'vitest';

const fsMocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    writeTextFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    readTextFile: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`no such file: ${path}`);
      return files.get(path)!;
    }),
    rename: vi.fn(async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    remove: vi.fn(async (path: string) => {
      files.delete(path);
    }),
  };
});

vi.mock('@tauri-apps/plugin-fs', () => fsMocks);

import { atomicWriteTextFile } from '../../utils/atomic-write';

const TARGET = 'D:/notes/thesis.md';
const TMP = `${TARGET}.tmp`;

describe('atomicWriteTextFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.files.clear();
  });

  it('lands the content on the target path', async () => {
    await atomicWriteTextFile(TARGET, '# Chapter one');

    expect(fsMocks.files.get(TARGET)).toBe('# Chapter one');
  });

  it('writes through a temporary sibling rather than the target itself', async () => {
    await atomicWriteTextFile(TARGET, '# Chapter one');

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(TMP, '# Chapter one');
    expect(fsMocks.writeTextFile).not.toHaveBeenCalledWith(TARGET, '# Chapter one');
    expect(fsMocks.rename).toHaveBeenCalledWith(TMP, TARGET);
  });

  it('leaves no temporary file behind', async () => {
    await atomicWriteTextFile(TARGET, '# Chapter one');

    expect(fsMocks.files.has(TMP)).toBe(false);
  });

  it('reads the temporary file back to confirm the bytes match', async () => {
    await atomicWriteTextFile(TARGET, '# Chapter one');

    expect(fsMocks.readTextFile).toHaveBeenCalledWith(TMP);
  });

  // The reason for all of this: a failure must never damage the file that is
  // already on disk.
  it('keeps the previous file when the rename fails', async () => {
    fsMocks.files.set(TARGET, '# Hours of work');
    fsMocks.rename.mockRejectedValueOnce(new Error('disk full'));

    await expect(atomicWriteTextFile(TARGET, '# Replacement')).rejects.toThrow('disk full');

    expect(fsMocks.files.get(TARGET)).toBe('# Hours of work');
    expect(fsMocks.files.has(TMP)).toBe(false);
  });

  it('keeps the previous file when the temporary write fails', async () => {
    fsMocks.files.set(TARGET, '# Hours of work');
    fsMocks.writeTextFile.mockRejectedValueOnce(new Error('read-only volume'));

    await expect(atomicWriteTextFile(TARGET, '# Replacement')).rejects.toThrow('read-only volume');

    expect(fsMocks.files.get(TARGET)).toBe('# Hours of work');
  });

  it('refuses the rename when the readback does not match what we wrote', async () => {
    fsMocks.files.set(TARGET, '# Hours of work');
    fsMocks.readTextFile.mockResolvedValueOnce('# truncated half-w');

    await expect(atomicWriteTextFile(TARGET, '# Replacement')).rejects.toThrow(
      /verification failed/,
    );

    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(fsMocks.files.get(TARGET)).toBe('# Hours of work');
    expect(fsMocks.files.has(TMP)).toBe(false);
  });
});
