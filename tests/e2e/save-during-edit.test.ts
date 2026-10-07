import { test, expect } from '@playwright/test';
import { setupTauriMocks } from './helpers/tauri-mock';
import { fillCodeEditor, getCodeEditorValue, openCodeView } from './helpers/code-editor';

const PATH = '/test/edit-during-save.md';
const ORIGINAL = '# Original\n\nInitial content.';

test('an older close-save cannot close the dirty document in a replacement prompt', async ({ page }) => {
  const otherPath = '/test/other-close.md';
  const started = deferred();
  const release = deferred();
  const mocks = await setupTauriMocks(page, {
    initialFs: { [PATH]: ORIGINAL, [otherPath]: 'Original B' }, openFilePath: PATH,
    beforeRename: async (_from, to) => { if (to === PATH) { started.resolve(); await release.promise; } },
  });
  try {
    await page.goto('/');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toContainText('Initial content.');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' Saved A');
    await page.evaluate(path => { (window as unknown as Record<string, unknown>).__mockDialogOpenPath = path; }, otherPath);
    await page.keyboard.press('Control+o');
    await expect(editor).toContainText('Original B');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' UNSAVED B');
    const tabA = page.locator('.tab-bar .tab').filter({ hasText: 'edit-during-save.md' });
    const tabB = page.locator('.tab-bar .tab').filter({ hasText: 'other-close.md' });
    await tabA.locator('.tab-close').click();
    await page.locator('.dialog .btn-save').click();
    await started.promise;
    await page.locator('.dialog .btn-cancel').click();
    await tabB.locator('.tab-close').click();
    await expect(page.locator('.dialog')).toContainText('other-close.md');
    release.resolve();
    await expect.poll(() => mocks.getFs()[PATH]).toContain('Saved A');
    await expect(tabB).toBeVisible();
    await expect(tabB.locator('.tab-unsaved')).toBeVisible();
    await expect(page.locator('.dialog')).toContainText('other-close.md');
    expect(mocks.getFs()[otherPath]).toBe('Original B');
  } finally { release.resolve(); }
});

test('cancelling a pending close-save retains the tab without a completion error', async ({ page }) => {
  const started = deferred();
  const release = deferred();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const mocks = await setupTauriMocks(page, {
    initialFs: { [PATH]: ORIGINAL }, openFilePath: PATH,
    beforeRename: async () => { started.resolve(); await release.promise; },
  });
  try {
    await page.goto('/');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toContainText('Initial content.');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' Saved after cancellation');
    await page.locator('.tab.active .tab-close').click();
    await page.locator('.dialog .btn-save').click();
    await started.promise;
    await page.locator('.dialog .btn-cancel').click();
    release.resolve();
    await expect.poll(() => mocks.getFs()[PATH]).toContain('Saved after cancellation');
    await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
    await expect(page.locator('.tab.active')).toContainText('edit-during-save.md');
    await expect(page.locator('.dialog')).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally { release.resolve(); }
});

test('close-saving an inactive code document preserves its Markdown and the active document', async ({ page }) => {
  const otherPath = '/test/active-code.md';
  const mocks = await setupTauriMocks(page, {
    initialFs: { [PATH]: ORIGINAL, [otherPath]: 'Original B' }, openFilePath: PATH,
  });
  await page.goto('/');
  await expect(page.locator('.ProseMirror')).toContainText('Initial content.');
  await openCodeView(page);
  await fillCodeEditor(page, 'Pinned code work in A');
  await page.evaluate(path => { (window as unknown as Record<string, unknown>).__mockDialogOpenPath = path; }, otherPath);
  await page.keyboard.press('Control+o');
  await expect.poll(() => getCodeEditorValue(page)).toBe('Original B');
  await fillCodeEditor(page, 'Unsaved code work in B');
  const tabA = page.locator('.tab-bar .tab').filter({ hasText: 'edit-during-save.md' });
  const tabB = page.locator('.tab-bar .tab').filter({ hasText: 'active-code.md' });
  await tabA.locator('.tab-close').click();
  await page.locator('.dialog .btn-save').click();
  await expect(tabA).not.toBeVisible();
  expect(mocks.getFs()[PATH]).toBe('Pinned code work in A');
  expect(mocks.getFs()[otherPath]).toBe('Original B');
  await expect(tabB.locator('.tab-unsaved')).toBeVisible();
  expect(await getCodeEditorValue(page)).toBe('Unsaved code work in B');
});

test('a new genuinely empty code document can be saved', async ({ page }) => {
  const emptyPath = '/test/empty-code.md';
  const mocks = await setupTauriMocks(page);
  await page.goto('/');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await openCodeView(page);
  await page.evaluate(path => { (window as unknown as Record<string, unknown>).__mockDialogSavePath = path; }, emptyPath);
  await page.keyboard.press('Control+s');
  await expect.poll(() => mocks.getFs()[emptyPath]).toBe('');
  await expect(page.locator('.tab.active')).toContainText('empty-code.md');
});

for (const autoSave of [false, true]) {
  test(`undo to opened A after saving B stays dirty, close protects A, and ${autoSave ? 'autosave' : 'manual save'} persists A`, async ({ page }) => {
    if (autoSave) {
      await page.addInitScript(() => {
        localStorage.setItem('mermark-settings', JSON.stringify({ autoSave: true, ai: { hasSeenFirstRun: true } }));
      });
    }
    const openedA = 'Initial content.';
    const mocks = await setupTauriMocks(page, { initialFs: { [PATH]: openedA }, openFilePath: PATH });
    await page.goto('/');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toContainText('Initial content.');
    // Keep the edit out of the history group created by the initial file load.
    await page.waitForTimeout(600);
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' version B');
    await page.keyboard.press('Control+s');
    await expect.poll(() => mocks.getFs()[PATH]).toContain('version B');
    await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
    await page.locator('button[data-tooltip-text*="Undo"]').first().click();
    await expect(editor).not.toContainText('version B');
    await expect(editor).toContainText('Initial content.');
    await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
    expect(mocks.getFs()[PATH]).toContain('version B');
    await page.locator('.tab.active .tab-close').click();
    await expect(page.locator('.dialog .btn-save')).toBeVisible();
    await page.locator('.dialog .btn-cancel').click();
    await expect(editor).toContainText('Initial content.');
    if (!autoSave) await page.keyboard.press('Control+s');
    await expect.poll(() => mocks.getFs()[PATH], { timeout: 8_000 }).toBe(openedA);
    await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
  });
}

test('lazy save stays clean when its delayed Markdown cache is published during the write', async ({ page }) => {
  const large = '# Section\n\nParagraph.\n\n'.repeat(50_000);
  const entered = deferred();
  const release = deferred();
  const mocks = await setupTauriMocks(page, {
    initialFs: { [PATH]: large }, openFilePath: PATH,
    beforeRename: async () => { entered.resolve(); await release.promise; },
  });
  try {
    await page.goto('/');
    const editor = page.locator('.lazy-editor-chunk[data-lazy-chunk="0"] .ProseMirror');
    await expect(editor).toBeEditable();
    await editor.click();
    await page.keyboard.press('Home');
    await page.keyboard.insertText('Saved lazy edit ');
    await page.keyboard.press('Control+s');
    await entered.promise;
    // The lazy editor publishes its parent cache on a 400ms debounce.
    await page.waitForTimeout(500);
    release.resolve();
    await expect.poll(() => mocks.getFs()[PATH]).toContain('Saved lazy edit');
    await expect(editor).toContainText('Saved lazy edit');
    await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
  } finally { release.resolve(); }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const mode of ['visual', 'code', 'split'] as const) {
  test(`manual save preserves newer ${mode} edits while the write is pending`, async ({ page }) => {
    const started = deferred();
    const release = deferred();
    let block = true;
    const mocks = await setupTauriMocks(page, {
      initialFs: { [PATH]: ORIGINAL },
      openFilePath: PATH,
      beforeRename: async () => {
        if (!block) return;
        started.resolve();
        await release.promise;
      },
    });
    try {
      await page.goto('/');
      await expect(page.locator('.tab-bar .tab')).toContainText('edit-during-save.md');
      if (mode !== 'visual') {
        if (mode === 'code') await openCodeView(page);
        else await page.getByRole('button', { name: 'Code + Preview', exact: true }).click();
        await fillCodeEditor(page, '# Snapshot before saving');
      } else {
        const editor = page.locator('.ProseMirror');
        await editor.click();
        await page.keyboard.press('Control+End');
        await page.keyboard.insertText(' first edit');
      }
      await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
      await page.keyboard.press('Control+s');
      await started.promise;
      const editor = mode !== 'visual' ? page.locator('.cm-content') : page.locator('.ProseMirror');
      await editor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText(' NEWER WORK');
      block = false;
      release.resolve();
      await expect.poll(() => mocks.getFs()[PATH]).not.toBe(ORIGINAL);
      expect(mocks.getFs()[PATH]).not.toContain('NEWER WORK');
      await expect(editor).toContainText('NEWER WORK');
      await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
      await page.keyboard.press('Control+s');
      await expect.poll(() => mocks.getFs()[PATH]).toContain('NEWER WORK');
      await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
      if (mode !== 'visual') expect(await getCodeEditorValue(page)).toContain('NEWER WORK');
    } finally {
      release.resolve();
    }
  });
}

test('autosave preserves newer edits and saves them on the next timer', async ({ page }) => {
  const started = deferred();
  const release = deferred();
  let block = true;
  await page.addInitScript(() => {
    localStorage.setItem('mermark-settings', JSON.stringify({
      autoSave: true,
      ai: { hasSeenFirstRun: true },
    }));
  });
  const mocks = await setupTauriMocks(page, {
    initialFs: { [PATH]: ORIGINAL },
    openFilePath: PATH,
    beforeRename: async () => {
      if (!block) return;
      started.resolve();
      await release.promise;
    },
  });
  try {
    await page.goto('/');
    const editor = page.locator('.ProseMirror');
    await expect(page.locator('.tab-bar .tab')).toContainText('edit-during-save.md');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' first edit');
    await started.promise;
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' NEWER AUTOSAVE WORK');
    block = false;
    release.resolve();
    await expect.poll(() => mocks.getFs()[PATH]).toContain('first edit');
    expect(mocks.getFs()[PATH]).not.toContain('NEWER AUTOSAVE WORK');
    await expect(editor).toContainText('NEWER AUTOSAVE WORK');
    await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
    await expect.poll(() => mocks.getFs()[PATH], { timeout: 8_000 }).toContain('NEWER AUTOSAVE WORK');
    await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
  } finally {
    release.resolve();
  }
});

test('saving from the close-tab dialog keeps the tab when newer edits arrive', async ({ page }) => {
  const started = deferred();
  const release = deferred();
  let block = true;
  const mocks = await setupTauriMocks(page, {
    initialFs: { [PATH]: ORIGINAL },
    openFilePath: PATH,
    beforeRename: async () => {
      if (!block) return;
      started.resolve();
      await release.promise;
    },
  });
  try {
    await page.goto('/');
    await expect(page.locator('.tab-bar .tab')).toContainText('edit-during-save.md');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' first edit');
    await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
    await page.locator('.tab.active .tab-close').click();
    await page.locator('.dialog .btn-save').click();
    await started.promise;
    await editor.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' NEWER WORK BEFORE CLOSE');
    block = false;
    release.resolve();

    await expect.poll(() => mocks.getFs()[PATH]).toContain('first edit');
    expect(mocks.getFs()[PATH]).not.toContain('NEWER WORK BEFORE CLOSE');
    await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
    await expect(editor).toContainText('NEWER WORK BEFORE CLOSE');
    await expect(page.locator('.dialog .btn-save')).toBeVisible();
    await page.locator('.dialog .btn-cancel').click();
    await page.keyboard.press('Control+s');
    await expect.poll(() => mocks.getFs()[PATH]).toContain('NEWER WORK BEFORE CLOSE');
  } finally {
    release.resolve();
  }
});
