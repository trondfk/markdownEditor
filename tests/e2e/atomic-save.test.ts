import { test, expect } from '@playwright/test';
import { setupTauriMocks } from './helpers/tauri-mock';
import { codeEditor, fillCodeEditor, openCodeView } from './helpers/code-editor';

// ============================================================
// Test suite: Atomic Save & Code View Save (#28)
// ============================================================

const SAMPLE_MD = '# Hello World\n\nThis is a test file.\n';
const SAMPLE_PATH = '/test/hello.md';
const SAVE_PATH = '/test/saved.md';

/** Wait for the tab bar to show a specific file name */
async function waitForTab(page: import('@playwright/test').Page, fileName: string) {
  await expect(page.locator('.tab-bar .tab')).toContainText(fileName, { timeout: 8_000 });
}

/** Override save dialog mock to return a specific path, then press Ctrl+Shift+S */
async function saveAs(page: import('@playwright/test').Page, savePath: string) {
  await page.evaluate((path) => {
    (window as Record<string, unknown>).__mockDialogSavePath = path;
  }, savePath);
  await page.keyboard.press('Control+Shift+s');
  await page.waitForTimeout(1_000);
}

// ============================================================

test.describe('Atomic Save — write .tmp → rename', () => {
  test('overlapping saves commit verified snapshots in FIFO order and leave B on disk', async ({ page }) => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    let enteredB!: () => void, releaseB!: () => void;
    const startedB = new Promise<void>(resolve => { enteredB = resolve; });
    const pendingB = new Promise<void>(resolve => { releaseB = resolve; });
    let diskBeforeB: string | undefined;
    let renames = 0;
    const { getFs, getCalls } = await setupTauriMocks(page, {
      initialFs: { [SAMPLE_PATH]: SAMPLE_MD },
      openFilePath: SAMPLE_PATH,
      beforeRename: async () => {
        if (++renames === 1) {
          entered(); await pending;
        } else if (renames === 2) {
          diskBeforeB = getFs()[SAMPLE_PATH];
          enteredB(); await pendingB;
        }
      },
    });
    try {
      await page.goto('/');
      await waitForTab(page, 'hello.md');
      await openCodeView(page);
      await fillCodeEditor(page, '# Snapshot A');
      await page.evaluate(path => {
        (window as Record<string, unknown>).__mockDialogSavePath = path;
      }, SAMPLE_PATH);
      await page.keyboard.press('Control+Shift+s');
      await started;
      await fillCodeEditor(page, '# Snapshot B');
      await page.keyboard.press('Control+Shift+s');
      expect(getFs()[SAMPLE_PATH]).toBe(SAMPLE_MD);
      expect(getCalls().filter(call => call.cmd === 'rename')).toHaveLength(1);
      release();
      await startedB;
      expect(diskBeforeB).toBe('# Snapshot A');
      expect(getFs()[SAMPLE_PATH]).toBe('# Snapshot A');
      const paths = getCalls().filter(call => call.cmd === 'rename')
        .map(call => (call.args as { from: string }).from);
      expect(new Set(paths).size).toBe(2);
      expect(getFs()[paths[0]]).toBeUndefined();
      expect(getFs()[paths[1]]).toBe('# Snapshot B');
      for (const path of paths) {
        expect(getCalls()).toContainEqual({ cmd: 'read', args: path });
        expect(getCalls()).toContainEqual({ cmd: 'write', args: {
          path, content: '', options: { createNew: true },
        } });
      }
      releaseB();
      await expect.poll(() => getFs()[SAMPLE_PATH]).toBe('# Snapshot B');
      await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
      expect(Object.keys(getFs()).filter(path => path.endsWith('.tmp'))).toEqual([]);
    } finally { release(); releaseB(); }
  });

  test('saves via .tmp file that is then renamed to final path', async ({ page }) => {
    const { getFs, getCalls } = await setupTauriMocks(page, {
      initialFs: { [SAMPLE_PATH]: SAMPLE_MD },
      openFilePath: SAMPLE_PATH,
    });

    await page.goto('/');
    await page.waitForSelector('.tab-bar', { timeout: 10_000 });
    await waitForTab(page, 'hello.md');

    // Use Save As (always saves regardless of hasChanges flag)
    await saveAs(page, SAVE_PATH);

    const calls = getCalls();
    const writeCalls = calls.filter(c => c.cmd === 'write');
    const renameCalls = calls.filter(c => c.cmd === 'rename');

    // Must write to .tmp first
    const tmpWrite = writeCalls.find(c => (c.args as { path: string }).path.endsWith('.tmp'));
    expect(tmpWrite, 'Should write to .tmp file first').toBeTruthy();

    // Then rename .tmp → final path
    const renameOp = renameCalls.find(c => {
      const a = c.args as { from: string; to: string };
      return a.from?.endsWith('.tmp') && a.to === SAVE_PATH;
    });
    expect(renameOp, 'Should rename .tmp to final path').toBeTruthy();
    const temporaryPath = (renameOp!.args as { from: string }).from;
    expect(writeCalls.map(call => call.args)).toContainEqual({
      path: temporaryPath, content: '', options: { createNew: true },
    });
    expect(writeCalls.map(call => call.args)).toContainEqual({
      path: temporaryPath, content: getFs()[SAVE_PATH], options: { create: false },
    });
    expect(calls.some(call => call.cmd === 'read' && call.args === temporaryPath)).toBe(true);

    // Final file must have content
    const finalFs = getFs();
    expect(finalFs[SAVE_PATH]).toBeTruthy();
    expect(finalFs[SAVE_PATH].length).toBeGreaterThan(0);
    expect(finalFs[SAVE_PATH]).toContain('Hello World');
    expect(finalFs[SAVE_PATH]).toContain('This is a test file.');
  });

  test('no .tmp leftover on disk after successful save', async ({ page }) => {
    const { getFs } = await setupTauriMocks(page, {
      initialFs: { [SAMPLE_PATH]: SAMPLE_MD },
      openFilePath: SAMPLE_PATH,
    });

    await page.goto('/');
    await page.waitForSelector('.tab-bar', { timeout: 10_000 });
    await waitForTab(page, 'hello.md');

    await saveAs(page, SAVE_PATH);

    const finalFs = getFs();
    const tmpFiles = Object.keys(finalFs).filter(k => k.endsWith('.tmp'));
    expect(tmpFiles, 'No .tmp files should remain after successful save').toHaveLength(0);
  });

  test('saved file content is not empty after Save As', async ({ page }) => {
    const { getFs } = await setupTauriMocks(page, {
      initialFs: { [SAMPLE_PATH]: SAMPLE_MD },
      openFilePath: SAMPLE_PATH,
    });

    await page.goto('/');
    await page.waitForSelector('.tab-bar', { timeout: 10_000 });
    await waitForTab(page, 'hello.md');

    await saveAs(page, SAVE_PATH);

    const finalFs = getFs();
    expect(finalFs[SAVE_PATH], 'Saved file should exist').toBeDefined();
    expect(finalFs[SAVE_PATH].length, 'Saved file must not be empty').toBeGreaterThan(0);
    // Should contain actual markdown content, not empty or garbage
    expect(finalFs[SAVE_PATH]).toContain('Hello World');
  });
});

// ============================================================

test.describe('Code View Save — no 0KB bug (#28)', () => {
  test('saves non-empty content when editing in code view', async ({ page }) => {
    const newContent = '# Modified in Code View\n\nContent added via code view.\n';
    const { getFs } = await setupTauriMocks(page, {
      initialFs: { [SAMPLE_PATH]: SAMPLE_MD },
      openFilePath: SAMPLE_PATH,
    });

    await page.goto('/');
    await page.waitForSelector('.tab-bar', { timeout: 10_000 });
    await waitForTab(page, 'hello.md');

    // Switch to code view
    await openCodeView(page);
    await page.waitForTimeout(300); // Let Vue reactivity set initial content

    // Fill with new content and trigger input event
    await fillCodeEditor(page, newContent);
    await page.waitForTimeout(300);

    await saveAs(page, SAVE_PATH);

    const finalFs = getFs();

    // The file must NOT be empty/0KB — this was the original bug
    expect(finalFs[SAVE_PATH], 'Saved file should exist').toBeDefined();
    expect(
      finalFs[SAVE_PATH].length,
      'Saved file must not be 0KB (code view save bug #28)',
    ).toBeGreaterThan(0);
    expect(finalFs[SAVE_PATH]).toContain('Modified in Code View');
  });

  test('saved content from code view matches exactly what was typed', async ({ page }) => {
    const expectedContent = '# My Document\n\nSome content here.\n';

    const { getFs } = await setupTauriMocks(page, {
      initialFs: { [SAMPLE_PATH]: SAMPLE_MD },
      openFilePath: SAMPLE_PATH,
    });

    await page.goto('/');
    await page.waitForSelector('.tab-bar', { timeout: 10_000 });
    await waitForTab(page, 'hello.md');

    await openCodeView(page);
    await page.waitForTimeout(300);

    await fillCodeEditor(page, expectedContent);
    await page.waitForTimeout(300);

    await saveAs(page, SAVE_PATH);

    const finalFs = getFs();
    // Save normalizes trailing whitespace but otherwise keeps raw Markdown (no HTML conversion).
    expect(finalFs[SAVE_PATH]).toBe(expectedContent.trimEnd());
  });

  test('code view does not save empty file (regression test for 0KB bug)', async ({ page }) => {
    // This is the core regression test: before the fix, saving in code view
    // would result in a 0KB file because the HTML editor was unmounted.
    const { getFs } = await setupTauriMocks(page, {
      initialFs: { [SAMPLE_PATH]: SAMPLE_MD },
      openFilePath: SAMPLE_PATH,
    });

    await page.goto('/');
    await page.waitForSelector('.tab-bar', { timeout: 10_000 });
    await waitForTab(page, 'hello.md');

    // Switch to code view WITHOUT editing — save the original content
    await openCodeView(page);
    await expect(codeEditor(page)).toBeVisible({ timeout: 3_000 });
    await page.waitForTimeout(300);

    await saveAs(page, SAVE_PATH);

    const finalFs = getFs();
    // Before fix: file was 0 bytes. After fix: file has actual markdown content.
    expect(finalFs[SAVE_PATH], 'File should exist after save').toBeDefined();
    expect(
      finalFs[SAVE_PATH].trim().length,
      'File must not be 0KB — regression test for #28',
    ).toBeGreaterThan(0);
  });
});

// ============================================================

test.describe('Save As', () => {
  test('Ctrl+Shift+S saves to a new path from dialog', async ({ page }) => {
    const { getFs } = await setupTauriMocks(page, {
      initialFs: { [SAMPLE_PATH]: SAMPLE_MD },
      openFilePath: SAMPLE_PATH,
    });

    await page.goto('/');
    await page.waitForSelector('.tab-bar', { timeout: 10_000 });
    await waitForTab(page, 'hello.md');

    await saveAs(page, SAVE_PATH);

    const finalFs = getFs();
    expect(finalFs[SAVE_PATH], 'File should be saved to new path').toBeDefined();
    expect(finalFs[SAVE_PATH].length).toBeGreaterThan(0);
  });

  test('Ctrl+Shift+S with dialog cancelled does not write file', async ({ page }) => {
    const { getFs } = await setupTauriMocks(page, {
      initialFs: { [SAMPLE_PATH]: SAMPLE_MD },
      openFilePath: SAMPLE_PATH,
    });

    await page.goto('/');
    await page.waitForSelector('.tab-bar', { timeout: 10_000 });
    await waitForTab(page, 'hello.md');

    // Dialog returns null (user cancelled)
    await page.evaluate(() => {
      (window as Record<string, unknown>).__mockDialogSavePath = null;
    });

    await page.keyboard.press('Control+Shift+s');
    await page.waitForTimeout(500);

    const finalFs = getFs();
    // Only original file should exist
    expect(Object.keys(finalFs)).toEqual([SAMPLE_PATH]);
  });
});
