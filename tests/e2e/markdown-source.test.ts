import { test, expect } from '@playwright/test';
import { setupTauriMocks } from './helpers/tauri-mock';
import { fillCodeEditor, getCodeEditorValue, openCodeView, openVisualView } from './helpers/code-editor';

const PATH = '/test/blank-lines.md';
const SOURCE = '\r\n# Heading\r\n\r\n\r\n\r\nFirst paragraph.\r\n\r\n\r\nSecond paragraph.\r\n\r\n';

test('open, code/visual round-trip and Save As preserve unchanged raw Markdown', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mermark-settings', JSON.stringify({ showLineNumbers: true, ai: { hasSeenFirstRun: true } })));
  const mocks = await setupTauriMocks(page, { initialFs: { [PATH]: SOURCE }, openFilePath: PATH });
  await page.goto('/');
  await expect(page.locator('.ProseMirror h1')).toHaveText('Heading');
  await expect(page.locator('.ProseMirror p')).toHaveCount(2);
  await expect(page.locator('.editor-gutter')).toHaveCount(0);
  await expect(page.locator('.has-line-numbers')).toHaveCount(0);
  const padding = await page.locator('.editor-content').evaluate(element => ({
    left: getComputedStyle(element).paddingLeft,
    right: getComputedStyle(element).paddingRight,
    expected: getComputedStyle(document.documentElement).getPropertyValue('--editor-pad-x').trim(),
  }));
  expect(padding.left).toBe(padding.expected);
  expect(padding.right).toBe(padding.expected);
  await openCodeView(page);
  expect(await getCodeEditorValue(page)).toBe(SOURCE.replace(/\r\n/g, '\n'));
  const gutter = await page.locator('.cm-lineNumbers .cm-gutterElement:visible').allTextContents();
  expect(gutter.filter(text => /^\d+$/.test(text))).toEqual(SOURCE.split('\n').map((_, i) => String(i + 1)));
  await expect(page.locator('.code-cursor-highlight-line')).toBeVisible();
  await openVisualView(page);
  await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
  await page.keyboard.press('Control+s');
  expect(mocks.getFs()[PATH]).toBe(SOURCE);
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__mockDialogSavePath = '/test/blank-lines-copy.md'; });
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => mocks.getFs()['/test/blank-lines-copy.md']).toBe(SOURCE);
  expect(mocks.getFs()[PATH]).toBe(SOURCE);
});

for (const enabled of [true, false]) {
  test(`code plus preview preserves source and code-only line numbers (enabled=${enabled})`, async ({ page }) => {
    await page.addInitScript(enabled => localStorage.setItem('mermark-settings', JSON.stringify({ showLineNumbers: enabled, ai: { hasSeenFirstRun: true } })), enabled);
    const mocks = await setupTauriMocks(page, { initialFs: { [PATH]: SOURCE }, openFilePath: PATH });
    await page.goto('/');
    await expect(page.locator('.ProseMirror h1')).toHaveText('Heading');
    await page.getByRole('button', { name: 'Code + Preview', exact: true }).click();
    await expect(page.locator('.split-editor-code .cm-content')).toBeVisible();
    await expect(page.locator('.split-editor-code .cm-lineNumbers')).toHaveCount(enabled ? 1 : 0);
    if (enabled) {
      const numbers = await page.locator('.split-editor-code .cm-lineNumbers .cm-gutterElement:visible').allTextContents();
      expect(numbers.filter(text => /^\d+$/.test(text))).toEqual(SOURCE.split('\n').map((_, i) => String(i + 1)));
    }
    await expect(page.locator('.split-editor-preview .editor-gutter')).toHaveCount(0);
    await expect(page.locator('.split-editor-preview .has-line-numbers')).toHaveCount(0);

    expect(await getCodeEditorValue(page)).toBe(SOURCE.replace(/\r\n/g, '\n'));
    await page.getByRole('button', { name: 'Code + Preview', exact: true }).click();
    await expect(page.locator('.ProseMirror h1')).toHaveText('Heading');
    await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
    await openCodeView(page);
    expect(await getCodeEditorValue(page)).toBe(SOURCE.replace(/\r\n/g, '\n'));
    await page.keyboard.press('Control+s');
    expect(mocks.getFs()[PATH]).toBe(SOURCE);
  });
}

test('real code edits retain interior blank lines through visual mode and save', async ({ page }) => {
  const source = '# Heading\n\n\n\nFirst paragraph.\n\n\nSecond paragraph.';
  const edited = source.replace('First paragraph.', 'First paragraph edited.');
  const mocks = await setupTauriMocks(page, { initialFs: { [PATH]: source }, openFilePath: PATH });
  await page.goto('/');
  await expect(page.locator('.ProseMirror h1')).toHaveText('Heading');
  await openCodeView(page);
  await expect(page.locator('.code-cursor-highlight-line')).toBeVisible();
  await fillCodeEditor(page, edited);
  await openVisualView(page);
  await expect(page.locator('.ProseMirror')).toContainText('First paragraph edited.');
  await expect(page.locator('.tab.active .tab-unsaved')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect.poll(() => mocks.getFs()[PATH]).toBe(edited);
  await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
  await openCodeView(page);
  expect(await getCodeEditorValue(page)).toBe(edited);
});
