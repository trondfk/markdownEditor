import { test, expect } from '@playwright/test';
import { setupTauriMocks } from './helpers/tauri-mock';
import { fillCodeEditor, openCodeView } from './helpers/code-editor';

test('reload restores saved Markdown and formulas without creating another document', async ({ page }) => {
  const path = '/test/reload-document.md';
  const saved = '# Saved document\n\nSaved Markdown with $E=mc^3$.';
  const mocks = await setupTauriMocks(page, {
    initialFs: { [path]: '# Original\n\n$E=mc^2$' },
    openFilePath: path,
  });
  await page.goto('/');
  await expect(page.locator('.ProseMirror h1')).toHaveText('Original');
  await openCodeView(page);
  await fillCodeEditor(page, saved);
  await page.keyboard.press('Control+s');
  await expect.poll(() => mocks.getFs()[path]).toBe(saved);
  await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();

  await page.reload();

  await expect(page.locator('.ProseMirror h1')).toHaveText('Saved document');
  await expect(page.locator('.katex-wrapper')).toHaveCount(1);
  await expect(page.locator('.katex-wrapper')).toHaveAttribute('data-formula', 'E%3Dmc%5E3');
  await expect(page.locator('.tab-bar .tab')).toHaveCount(1);
  await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
  const copy = '/test/reloaded-copy.md';
  await page.evaluate(path => {
    (window as unknown as Record<string, unknown>).__mockDialogSavePath = path;
  }, copy);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => mocks.getFs()[copy]).toBe(saved);
  expect(mocks.getFs()[path]).toBe(saved);
});

test('session restoration reacquires ownership after reload', async ({ page }) => {
  const path = '/test/session-document.md';
  const source = '# Restored session\n\nSaved source with $x^2$.';
  await page.addInitScript(path => {
    if (sessionStorage.getItem('reload-session-seeded')) return;
    localStorage.setItem('mermark-session', JSON.stringify({
      activePaneId: 'main',
      panes: [{ id: 'main', activeTabId: 'saved', tabs: [{ filePath: path, fileName: 'session-document.md' }] }],
    }));
    sessionStorage.setItem('reload-session-seeded', 'true');
  }, path);
  const mocks = await setupTauriMocks(page, { initialFs: { [path]: source } });
  await page.goto('/');
  await expect(page.locator('.ProseMirror h1')).toHaveText('Restored session');

  await page.reload();

  await expect(page.locator('.ProseMirror h1')).toHaveText('Restored session');
  await expect(page.locator('.katex-wrapper')).toHaveAttribute('data-formula', 'x%5E2');
  await expect(page.locator('.tab-bar .tab')).toHaveCount(1);
  await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
  expect(mocks.getFs()[path]).toBe(source);
});

test('a failed reload read releases its reservation and leaves saved content intact', async ({ page }) => {
  const path = '/test/retry-reload.md';
  const source = '# Saved source\n\n$E=mc^2$';
  let failReads = false;
  const mocks = await setupTauriMocks(page, {
    initialFs: { [path]: source }, openFilePath: path,
    beforeRead: () => { if (failReads) throw new Error('Controlled read failure'); },
  });
  await page.goto('/');
  await expect(page.locator('.ProseMirror h1')).toHaveText('Saved source');
  failReads = true;

  await page.reload();

  await expect.poll(() => mocks.getCalls().filter(call => call.cmd === 'unregister_open_file').length).toBe(1);
  expect(mocks.getFs()[path]).toBe(source);
  failReads = false;
  await page.evaluate(path => {
    (window as unknown as Record<string, unknown>).__mockDialogOpenPath = path;
  }, path);
  await page.keyboard.press('Control+o');
  await expect(page.locator('.ProseMirror h1')).toHaveText('Saved source');
  await expect(page.locator('.tab-bar .tab')).toHaveCount(1);
  await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
  expect(mocks.getFs()[path]).toBe(source);
});
