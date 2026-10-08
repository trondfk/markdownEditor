import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Buffer } from 'node:buffer';
import type { WriteFileOptions } from '@tauri-apps/plugin-fs';

const fsMocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  const write = async (path: string, content: string, options?: WriteFileOptions) => {
    if (options?.createNew && files.has(path)) throw new Error(`EEXIST: ${path}`);
    if (!options?.createNew && options?.create === false && !files.has(path)) throw new Error(`ENOENT: ${path}`);
    files.set(path, content);
  };
  const read = async (path: string) => {
    if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
    return files.get(path)!;
  };
  const move = async (from: string, to: string) => {
    if (!files.has(from)) throw new Error(`ENOENT rename: ${from}`);
    files.set(to, files.get(from)!);
    files.delete(from);
  };
  const unlink = async (path: string) => {
    if (!files.has(path)) throw new Error(`ENOENT remove: ${path}`);
    files.delete(path);
  };
  return {
    files, write, read, move, unlink,
    writeTextFile: vi.fn(write),
    readTextFile: vi.fn(read),
    rename: vi.fn(move),
    remove: vi.fn(unlink),
  };
});

vi.mock('@tauri-apps/plugin-fs', () => fsMocks);

import { atomicWriteTextFile } from '../../utils/atomic-write';

const TARGET = 'D:/notes/thesis.md';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function independentWriters() {
  vi.resetModules();
  const first = await import('../../utils/atomic-write');
  vi.resetModules();
  const second = await import('../../utils/atomic-write');
  expect(first.atomicWriteTextFile).not.toBe(second.atomicWriteTextFile);
  return [first.atomicWriteTextFile, second.atomicWriteTextFile] as const;
}

describe('atomicWriteTextFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fsMocks.files.clear();
    fsMocks.writeTextFile.mockImplementation(fsMocks.write);
    fsMocks.readTextFile.mockImplementation(fsMocks.read);
    fsMocks.rename.mockImplementation(fsMocks.move);
    fsMocks.remove.mockImplementation(fsMocks.unlink);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('lands the content on the target path', async () => {
    await atomicWriteTextFile(TARGET, '# Chapter one');

    expect(fsMocks.files.get(TARGET)).toBe('# Chapter one');
  });

  it.each([
    ['long ASCII', '/notes/', `${'a'.repeat(220)}.md`],
    ['maximum-length ASCII', '/notes/', `${'a'.repeat(252)}.md`],
    ['maximum-length multibyte', '/notes/', `${'界'.repeat(84)}.md`],
    ['Windows multibyte', 'D:\\notes\\', `${'界'.repeat(84)}.md`],
  ])('saves a valid %s filename within a 255-byte component limit', async (_label, directory, filename) => {
    const target = `${directory}${filename}`;
    expect(Buffer.byteLength(filename, 'utf8')).toBeLessThanOrEqual(255);
    fsMocks.files.set(target, 'Original');
    fsMocks.writeTextFile.mockImplementation(async (path, content, options) => {
      const basename = path.split(/[/\\]/).pop()!;
      if (Buffer.byteLength(basename, 'utf8') > 255) throw new Error('ENAMETOOLONG');
      await fsMocks.write(path, content, options);
    });

    await atomicWriteTextFile(target, 'Replacement');

    const [temporaryPath] = fsMocks.writeTextFile.mock.calls[0];
    expect(temporaryPath.slice(0, directory.length)).toBe(directory);
    expect(temporaryPath.slice(directory.length)).toMatch(/^mermark-[0-9a-f-]{36}\.tmp$/);
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(temporaryPath);
    expect(fsMocks.rename).toHaveBeenCalledWith(temporaryPath, target);
    expect(fsMocks.files.get(target)).toBe('Replacement');
    expect([...fsMocks.files.keys()]).toEqual([target]);
  });

  it('writes through a temporary sibling rather than the target itself', async () => {
    await atomicWriteTextFile(TARGET, '# Chapter one');

    const [tmpPath] = fsMocks.writeTextFile.mock.calls[0];
    expect(tmpPath).toMatch(/^D:\/notes\/mermark-[0-9a-f-]{36}\.tmp$/);
    expect(fsMocks.writeTextFile.mock.calls.every(([path]) => path !== TARGET)).toBe(true);
    expect(fsMocks.rename).toHaveBeenCalledWith(tmpPath, TARGET);
  });

  it.each([
    ['file.md', ''],
    ['/file.md', '/'],
    ['notes/file.md', 'notes/'],
    ['\\\\server\\notes\\file.md', '\\\\server\\notes\\'],
  ])('keeps the temporary file in the same directory as %s', async (target, directory) => {
    await atomicWriteTextFile(target, 'Replacement');

    const [temporaryPath] = fsMocks.writeTextFile.mock.calls[0];
    expect(temporaryPath.slice(0, directory.length)).toBe(directory);
    expect(temporaryPath.slice(directory.length)).toMatch(/^mermark-[0-9a-f-]{36}\.tmp$/);
    expect(fsMocks.files.get(target)).toBe('Replacement');
    expect([...fsMocks.files.keys()]).toEqual([target]);
  });

  it('leaves no temporary file behind', async () => {
    await atomicWriteTextFile(TARGET, '# Chapter one');

    expect([...fsMocks.files.keys()]).toEqual([TARGET]);
  });

  it('reads the temporary file back to confirm the bytes match', async () => {
    await atomicWriteTextFile(TARGET, '# Chapter one');

    expect(fsMocks.readTextFile).toHaveBeenCalledWith(fsMocks.writeTextFile.mock.calls[0][0]);
  });

  // The reason for all of this: a failure must never damage the file that is
  // already on disk.
  it('keeps the previous file when the rename fails', async () => {
    fsMocks.files.set(TARGET, '# Hours of work');
    fsMocks.rename.mockRejectedValueOnce(new Error('disk full'));

    await expect(atomicWriteTextFile(TARGET, '# Replacement')).rejects.toThrow('disk full');

    expect(fsMocks.files.get(TARGET)).toBe('# Hours of work');
    expect([...fsMocks.files.keys()]).toEqual([TARGET]);
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
    expect([...fsMocks.files.keys()]).toEqual([TARGET]);
  });

  it('keeps the previous file and other operations\' siblings when readback throws an I/O error', async () => {
    const otherTemporaryPath = 'D:/notes/mermark-other-operation.tmp';
    const error = new Error('EIO: read failed');
    fsMocks.files.set(TARGET, 'Original');
    fsMocks.files.set(otherTemporaryPath, 'Another operation owns this');
    fsMocks.readTextFile.mockRejectedValueOnce(error);

    await expect(atomicWriteTextFile(TARGET, 'Replacement')).rejects.toBe(error);

    const [ownedTemporaryPath] = fsMocks.writeTextFile.mock.calls[0];
    expect(fsMocks.remove).toHaveBeenCalledExactlyOnceWith(ownedTemporaryPath);
    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(fsMocks.files.get(TARGET)).toBe('Original');
    expect(fsMocks.files.get(otherTemporaryPath)).toBe('Another operation owns this');
    expect([...fsMocks.files.keys()]).toEqual([TARGET, otherTemporaryPath]);
  });

  it('exclusively reserves its sibling before writing the payload', async () => {
    await atomicWriteTextFile(TARGET, 'A');
    const [tmpPath] = fsMocks.writeTextFile.mock.calls[0];
    expect(fsMocks.writeTextFile).toHaveBeenNthCalledWith(1, tmpPath, '', { createNew: true });
    expect(fsMocks.writeTextFile).toHaveBeenNthCalledWith(2, tmpPath, 'A', { create: false });
  });

  it('allows two independent overlapping saves to replace only their own complete snapshots', async () => {
    const [writeA, writeB] = await independentWriters();
    const entered = deferred(), release = deferred();
    const replacements: string[] = [];
    fsMocks.rename.mockImplementationOnce(async (from, to) => {
      entered.resolve();
      await release.promise;
      replacements.push(await fsMocks.read(from));
      await fsMocks.move(from, to);
    });
    fsMocks.rename.mockImplementation(async (from, to) => {
      replacements.push(await fsMocks.read(from));
      await fsMocks.move(from, to);
    });
    const first = writeA(TARGET, 'A');
    try {
      await entered.promise;
      await writeB(TARGET, 'B');
      release.resolve();
      await first;
      const temporaryPaths = fsMocks.rename.mock.calls.map(([from]) => from);
      expect(new Set(temporaryPaths).size).toBe(2);
      expect(replacements).toEqual(['B', 'A']);
      expect(fsMocks.files.get(TARGET)).toBe('A');
      expect([...fsMocks.files.keys()]).toEqual([TARGET]);
    } finally { release.resolve(); await Promise.allSettled([first]); }
  });

  it('does not rename a competing save\'s partially written file onto the destination', async () => {
    const [writeA, writeB] = await independentWriters();
    const renameEntered = deferred(), releaseRename = deferred();
    const partialEntered = deferred(), releaseFailure = deferred();
    fsMocks.files.set(TARGET, 'Original');
    fsMocks.rename.mockImplementationOnce(async (from, to) => {
      renameEntered.resolve(); await releaseRename.promise;
      await fsMocks.move(from, to);
    });
    fsMocks.writeTextFile.mockImplementation(async (path, content, options) => {
      if (content !== 'B') return fsMocks.write(path, content, options);
      await fsMocks.write(path, '', options);
      partialEntered.resolve(); await releaseFailure.promise;
      throw new Error('disk full after truncation');
    });
    const first = writeA(TARGET, 'A');
    let second: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await renameEntered.promise;
      second = Promise.allSettled([writeB(TARGET, 'B')]);
      await partialEntered.promise;
      releaseRename.resolve(); await first;
      releaseFailure.resolve();
      expect((await second)[0]).toMatchObject({ status: 'rejected', reason: new Error('disk full after truncation') });
      expect(fsMocks.files.get(TARGET)).toBe('A');
      expect([...fsMocks.files.keys()]).toEqual([TARGET]);
    } finally {
      releaseRename.resolve(); releaseFailure.resolve();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });

  it.each(['verification', 'rename'])('cleans up only its own sibling after %s fails during another save', async failure => {
    const [writeA, writeB] = await independentWriters();
    const firstRead = deferred(), releaseFirst = deferred();
    const secondRead = deferred(), releaseSecond = deferred();
    fsMocks.files.set(TARGET, 'Original');
    fsMocks.readTextFile.mockImplementationOnce(async path => {
      const written = await fsMocks.read(path);
      firstRead.resolve(); await releaseFirst.promise;
      return failure === 'verification' ? 'Corrupted' : written;
    }).mockImplementationOnce(async path => {
      secondRead.resolve(); await releaseSecond.promise;
      return fsMocks.read(path);
    });
    if (failure === 'rename') fsMocks.rename.mockRejectedValueOnce(new Error('rename failed'));
    const first = Promise.allSettled([writeA(TARGET, 'A')]);
    let second: Promise<void> | undefined;
    try {
      await firstRead.promise;
      second = writeB(TARGET, 'B');
      await secondRead.promise;
      releaseFirst.resolve();
      expect((await first)[0].status).toBe('rejected');
      const secondPath = fsMocks.readTextFile.mock.calls[1][0];
      expect(fsMocks.files.get(secondPath)).toBe('B');
      expect(fsMocks.remove).not.toHaveBeenCalledWith(secondPath);
      releaseSecond.resolve(); await second;
      expect(fsMocks.files.get(TARGET)).toBe('B');
      expect([...fsMocks.files.keys()]).toEqual([TARGET]);
    } finally {
      releaseFirst.resolve(); releaseSecond.resolve();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });

  it('never truncates or deletes an existing sibling when exclusive creation fails', async () => {
    fsMocks.files.set(TARGET, 'Original');
    fsMocks.writeTextFile.mockImplementationOnce(async (path, content, options) => {
      fsMocks.files.set(path, 'Another operation owns this');
      await fsMocks.write(path, content, options);
    });
    await expect(atomicWriteTextFile(TARGET, 'Replacement')).rejects.toThrow('EEXIST');
    const [path] = fsMocks.writeTextFile.mock.calls[0];
    expect(fsMocks.files.get(path)).toBe('Another operation owns this');
    expect(fsMocks.files.get(TARGET)).toBe('Original');
    expect(fsMocks.remove).not.toHaveBeenCalled();
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
    expect(fsMocks.rename).not.toHaveBeenCalled();
  });

  it('preserves the owner\'s snapshot when independent saves generate the same sibling name', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const [writeA, writeB] = await independentWriters();
    const entered = deferred(), release = deferred();
    fsMocks.rename.mockImplementationOnce(async (from, to) => {
      entered.resolve(); await release.promise;
      await fsMocks.move(from, to);
    });
    const first = writeA(TARGET, 'A');
    try {
      await entered.promise;
      await expect(writeB(TARGET, 'B')).rejects.toThrow('EEXIST');
      const ownedPath = fsMocks.rename.mock.calls[0][0];
      expect(fsMocks.files.get(ownedPath)).toBe('A');
      expect(fsMocks.remove).not.toHaveBeenCalled();
      release.resolve(); await first;
      expect(fsMocks.files.get(TARGET)).toBe('A');
      expect([...fsMocks.files.keys()]).toEqual([TARGET]);
    } finally { release.resolve(); await Promise.allSettled([first]); }
  });

  it('does not clean up any path when initial creation fails', async () => {
    fsMocks.writeTextFile.mockRejectedValueOnce(new Error('permission denied'));
    await expect(atomicWriteTextFile(TARGET, 'A')).rejects.toThrow('permission denied');
    expect(fsMocks.remove).not.toHaveBeenCalled();
    expect(fsMocks.rename).not.toHaveBeenCalled();
  });

  it('preserves an existing legacy .tmp sibling', async () => {
    fsMocks.files.set(`${TARGET}.tmp`, 'Unrelated file');
    await atomicWriteTextFile(TARGET, 'A');
    expect(fsMocks.files.get(`${TARGET}.tmp`)).toBe('Unrelated file');
    expect(fsMocks.files.get(TARGET)).toBe('A');
  });

  it('preserves the original error if cleanup also fails', async () => {
    const error = new Error('rename failed');
    fsMocks.files.set(TARGET, 'Original');
    fsMocks.rename.mockRejectedValueOnce(error);
    fsMocks.remove.mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(atomicWriteTextFile(TARGET, 'A')).rejects.toBe(error);
    expect(fsMocks.files.get(TARGET)).toBe('Original');
  });

  it('still saves a genuinely empty document', async () => {
    await atomicWriteTextFile(TARGET, '');
    expect(fsMocks.files.get(TARGET)).toBe('');
    expect([...fsMocks.files.keys()]).toEqual([TARGET]);
  });
});
