import { expect, test } from '@playwright/test';
import { setupTauriMocks } from './helpers/tauri-mock';
import { fillCodeEditor, openCodeView } from './helpers/code-editor';

const SOURCE = '/test/source-owned.md';
const TARGET = '/test/target-owned.md';

for (const location of ['tab', 'pane', 'window', 'empty source']) {
  test(`Save As refuses a target owned by another ${location}`, async ({ page }) => {
    const empty = location === 'empty source';
    const mocks = await setupTauriMocks(page, {
      initialFs: { [SOURCE]: '# Source', [TARGET]: '# Target saved content' },
      openFilePath: empty ? null : SOURCE,
    });
    await page.goto('/');
    const sourceEditor = page.locator('.ProseMirror').first();
    await expect(sourceEditor).toBeVisible();
    if (!empty) {
      await expect(sourceEditor).toContainText('Source');
      await sourceEditor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText(' Source unsaved work');
      await expect(sourceEditor).toContainText('Source unsaved work');
      await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
    }
    if (location === 'tab' || location === 'pane') {
      if (location === 'pane') {
        await page.locator('.split-toggle-btn').first().click();
        await page.locator('.editor-pane').last().click();
      }
      await page.evaluate(path => { (window as Record<string, unknown>).__mockDialogOpenPath = path; }, TARGET);
      await page.keyboard.press('Control+o');
      await expect(page.locator('.tab.active').filter({ hasText: 'target-owned.md' })).toBeVisible();
      await expect(page.locator('.editor-pane.active .ProseMirror')).toContainText('Target saved content');
      const targetEditor = page.locator('.editor-pane.active .ProseMirror');
      await targetEditor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText(' Target unsaved work');
      await page.locator('.tab-bar .tab').filter({ hasText: 'source-owned.md' }).click();
      await expect(page.locator('.editor-pane.active .ProseMirror')).toContainText('Source unsaved work');
    } else {
      await page.evaluate(async path => {
        const mock = window as unknown as {
          __mockFrontendLoaded: (label: string) => Promise<string>;
          __mockFileRegistry: (cmd: string, path: string, label: string, instance?: string) => Promise<unknown>;
        };
        const instance = await mock.__mockFrontendLoaded('other');
        await mock.__mockFileRegistry('register_open_file', path, 'other', instance);
      }, TARGET);
    }
    const before = { ...mocks.getFs() };
    const calls = mocks.getCalls().length;
    await page.evaluate(path => { (window as Record<string, unknown>).__mockDialogSavePath = path; }, TARGET);
    await page.keyboard.press('Control+Shift+s');
    await expect(page.locator('.toast-message')).toContainText(/another open document|annet åpent dokument/);
    expect(mocks.getFs()).toEqual(before);
    expect(mocks.getCalls().slice(calls).filter(c => ['write', 'rename', 'unregister_open_file'].includes(c.cmd))).toEqual([]);
    if (!empty) {
      await expect(page.locator('.tab-bar .tab').filter({ hasText: 'source-owned.md' }).locator('.tab-unsaved')).toBeVisible();
      await expect(page.locator('.ProseMirror').filter({ hasText: 'Source unsaved work' })).toBeVisible();
    }
    if (location === 'tab') {
      await page.locator('.tab-bar .tab').filter({ hasText: 'target-owned.md' }).click();
      await expect(page.locator('.ProseMirror')).toContainText('Target unsaved work');
      await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
    }
    const owner = await page.evaluate(path => {
      return (window as unknown as { __mockFileRegistry: (cmd: string, path: string, label: string) => Promise<string> })
        .__mockFileRegistry('check_file_open', path, 'main');
    }, TARGET);
    expect(owner).toBe(location === 'tab' || location === 'pane' ? 'main' : 'other');
  });
}

for (const existing of [false, true]) {
  test(`Save As updates binding and ownership for a free ${existing ? 'existing' : 'new'} target`, async ({ page }) => {
    const initialFs = existing ? { [SOURCE]: '# Source', [TARGET]: '# Old destination' } : { [SOURCE]: '# Source' };
    const mocks = await setupTauriMocks(page, { initialFs, openFilePath: SOURCE });
    await page.goto('/');
    await expect(page.locator('.ProseMirror')).toContainText('Source');
    await openCodeView(page);
    await fillCodeEditor(page, '# Saved at the new target');
    await page.evaluate(path => { (window as Record<string, unknown>).__mockDialogSavePath = path; }, TARGET);
    await page.keyboard.press('Control+Shift+s');
    if (existing) {
      await expect(page.locator('.conflict-panel')).toBeVisible();
      await page.getByRole('button', { name: /Save Anyway|Lagre likevel/ }).click();
    }
    await expect.poll(() => mocks.getFs()[TARGET]).toBe('# Saved at the new target');
    await expect(page.locator('.tab.active')).toContainText('target-owned.md');
    await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
    const owners = await page.evaluate(async paths => {
      const registry = (window as unknown as { __mockFileRegistry: (cmd: string, path: string, label: string) => Promise<string | null> }).__mockFileRegistry;
      return Promise.all(paths.map(path => registry('check_file_open', path, 'main')));
    }, [SOURCE, TARGET]);
    expect(owners).toEqual([null, 'main']);
    expect(mocks.getFs()[SOURCE]).toBe('# Source');
  });
}

test('first-time close-save refuses an owned target and retains the unsaved document', async ({ page }) => {
  const work = 'Untitled work must remain open';
  const mocks = await setupTauriMocks(page, { initialFs: { [TARGET]: '# Other saved content' } });
  await page.goto('/');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await openCodeView(page);
  await fillCodeEditor(page, work);
  await page.evaluate(async path => {
    const mock = window as unknown as {
      __mockFrontendLoaded: (label: string) => Promise<string>;
      __mockFileRegistry: (cmd: string, path: string, label: string, instance?: string) => Promise<unknown>;
    };
    const instance = await mock.__mockFrontendLoaded('other');
    await mock.__mockFileRegistry('register_open_file', path, 'other', instance);
    (window as Record<string, unknown>).__mockDialogSavePath = path;
  }, TARGET);
  await page.locator('.tab.active .tab-close').click();
  await page.locator('.dialog .btn-save').click();
  await expect(page.locator('.toast-message')).toContainText(/another open document|annet åpent dokument/);
  await expect(page.locator('.dialog')).toBeVisible();
  await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
  await expect(page.locator('.editor-pane')).toContainText(work);
  expect(mocks.getFs()).toEqual({ [TARGET]: '# Other saved content' });
  expect(mocks.getCalls().filter(c => c.cmd === 'write' || c.cmd === 'rename')).toEqual([]);
});

test('a failed Save As removes its new reservation without changing the source binding', async ({ page }) => {
  const mocks = await setupTauriMocks(page, {
    initialFs: { [SOURCE]: '# Source' }, openFilePath: SOURCE,
    beforeRename: async () => { throw new Error('Disk write failed'); },
  });
  await page.goto('/');
  await expect(page.locator('.ProseMirror')).toContainText('Source');
  await openCodeView(page);
  await fillCodeEditor(page, '# Unsaved work');
  await page.evaluate(path => { (window as Record<string, unknown>).__mockDialogSavePath = path; }, TARGET);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => mocks.getCalls().some(c => c.cmd === 'finish_save_target')).toBe(true);
  await expect(page.locator('.tab.active')).toContainText('source-owned.md');
  await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
  expect(mocks.getFs()).toEqual({ [SOURCE]: '# Source' });
  const owners = await page.evaluate(async paths => {
    const registry = (window as unknown as { __mockFileRegistry: (cmd: string, path: string, label: string) => Promise<string | null> }).__mockFileRegistry;
    return Promise.all(paths.map(path => registry('check_file_open', path, 'main')));
  }, [SOURCE, TARGET]);
  expect(owners).toEqual(['main', null]);
});

test('Markdown links acquire ownership before loading the linked document', async ({ page }) => {
  const mocks = await setupTauriMocks(page, {
    initialFs: { [SOURCE]: '# Source\n\n[Open target](target-owned.md)', [TARGET]: '# Target' }, openFilePath: SOURCE,
  });
  await page.goto('/');
  await expect(page.locator('.ProseMirror a')).toHaveText('Open target');
  await page.locator('.ProseMirror a').click();
  await expect(page.locator('.tab.active')).toContainText('target-owned.md');
  await expect(page.locator('.ProseMirror')).toContainText('Target');
  const calls = mocks.getCalls();
  const claim = calls.findIndex(c => c.cmd === 'register_open_file' && (c.args as { path: string }).path === TARGET);
  const read = calls.findIndex(c => c.cmd === 'read' && c.args === TARGET);
  expect(claim).toBeGreaterThanOrEqual(0);
  expect(read).toBeGreaterThan(claim);
});
