import { test, expect, type Page } from '@playwright/test';
import { setupTauriMocks } from './helpers/tauri-mock';
import { getCodeEditorValue, openCodeView, openVisualView } from './helpers/code-editor';

const DOC = '\\\\?\\C:\\Notes\\clipboard.md';
const ORIGINAL = '# Original\n\nKeep existing text.';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=';

async function imageBridge(page: Page, failWrite = false) {
  const files = new Map<string, number[]>();
  await page.exposeFunction('__testImageIo', (command: string, path: string, bytes?: number[]) => {
    if (path.startsWith('\\\\?\\') && path.includes('/')) throw new Error('Invalid Windows verbatim path separator');
    if (command === 'mkdir') return;
    if (command === 'exists') return files.has(path);
    if (command === 'write') {
      if (failWrite) throw new Error('Image write failed');
      files.set(path, bytes!); return;
    }
    if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
    return files.get(path);
  });
  await page.evaluate(() => {
    const host = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown, options?: { headers?: Record<string, string> }) => Promise<unknown> };
      __testImageIo: (command: string, path: string, bytes?: number[]) => Promise<unknown>;
    };
    const invoke = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      const input = args as { path: string };
      if (command === 'plugin:path|resolve_directory') return 'C:\\Users\\Tester\\AppData\\Roaming\\MerMark';
      if (command === 'plugin:fs|mkdir') return host.__testImageIo('mkdir', input.path);
      if (command === 'plugin:fs|read_file') return host.__testImageIo('read', input.path);
      if (command === 'plugin:fs|write_file') {
        return host.__testImageIo('write', decodeURIComponent(options!.headers!.path), Array.from(args as Uint8Array));
      }
      if (command === 'plugin:fs|exists' && await host.__testImageIo('exists', input.path)) return true;
      return invoke(command, args, options);
    };
  });
  return files;
}

async function pasteScreenshot(page: Page) {
  return page.locator('.ProseMirror').evaluate((element, png) => {
    const bytes = Uint8Array.from(atob(png), ch => ch.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
    return element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG);
}

for (const saved of [true, false]) {
  test(`pastes and saves a screenshot in a ${saved ? 'saved canonical Windows' : 'new unsaved'} document`, async ({ page }) => {
    const mocks = await setupTauriMocks(page, { initialFs: saved ? { [DOC]: ORIGINAL } : {}, openFilePath: saved ? DOC : null });
    await page.goto('/');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    if (saved) await expect(editor).toContainText('Keep existing text.');
    const images = await imageBridge(page);
    await editor.click();
    await page.keyboard.press('Control+End');
    if (!saved) await page.keyboard.insertText('Keep existing text.');
    expect(await pasteScreenshot(page)).toBe(false);
    await expect(editor.locator('img')).toHaveCount(1);
    await expect.poll(() => editor.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    await expect(editor).toContainText('Keep existing text.');
    expect(images.size).toBe(1);
    const path = [...images.keys()][0];
    expect(path.startsWith(saved ? '\\\\?\\C:\\Notes\\images\\' : 'C:/Users/Tester/AppData/Roaming/MerMark/unsaved-images/')).toBe(true);
    const destination = saved ? DOC : '\\\\?\\C:\\Notes\\first-save.md';
    await page.evaluate(path => { (window as unknown as Record<string, unknown>).__mockDialogSavePath = path; }, destination);
    await page.keyboard.press('Control+s');
    await expect.poll(() => mocks.getFs()[destination]).toContain('![screenshot-');
    expect(mocks.getFs()[destination]).toContain('Keep existing text.');
    expect(mocks.getFs()[destination]).toContain(saved ? '(images/screenshot-' : '(C:/Users/Tester/AppData/Roaming/MerMark/unsaved-images/');
    expect(mocks.getFs()[destination]).not.toContain('blob:');
    await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
    await openCodeView(page);
    expect(await getCodeEditorValue(page)).toContain('![screenshot-');
    await expect(page.locator('.code-cursor-highlight-line')).toBeVisible();
    await openVisualView(page);
    await expect.poll(() => page.locator('.ProseMirror img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    const copy = '\\\\?\\C:\\Notes\\clipboard-copy.md';
    await page.evaluate(path => { (window as unknown as Record<string, unknown>).__mockDialogSavePath = path; }, copy);
    await page.keyboard.press('Control+Shift+s');
    await expect.poll(() => mocks.getFs()[copy]).toBe(mocks.getFs()[destination]);
  });
}

test('a failed image write leaves selected document content, baseline and binding intact', async ({ page }) => {
  const mocks = await setupTauriMocks(page, { initialFs: { [DOC]: ORIGINAL }, openFilePath: DOC });
  await page.goto('/');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('Keep existing text.');
  await imageBridge(page, true);
  await editor.click(); await page.keyboard.press('Control+a');
  const before = await editor.innerHTML();
  const warning = page.waitForEvent('console', { predicate: message => message.type() === 'warning' && message.text().includes('Failed to import pasted image') });
  await pasteScreenshot(page); await warning;
  expect(await editor.innerHTML()).toBe(before);
  await expect(editor.locator('img')).toHaveCount(0);
  await expect(page.locator('.tab.active .tab-unsaved')).not.toBeVisible();
  await expect(page.locator('.tab.active')).toContainText('clipboard.md');
  await page.keyboard.press('Control+s');
  expect(mocks.getFs()[DOC]).toBe(ORIGINAL);
});

test('plain Markdown text and internal HTML copy/paste still reach the visual editor', async ({ page }) => {
  const mocks = await setupTauriMocks(page, { initialFs: { [DOC]: ORIGINAL }, openFilePath: DOC });
  await page.goto('/');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('Keep existing text.');
  await editor.click(); await page.keyboard.press('Control+End');
  await editor.evaluate(element => {
    const data = new DataTransfer(); data.setData('text/plain', '\nCopied Markdown **words**');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor).toContainText('Copied Markdown');
  await page.keyboard.press('Control+a');
  const copied = await editor.evaluate(element => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return { html: data.getData('text/html'), text: data.getData('text/plain') };
  });
  expect(copied.text).toContain('Copied Markdown');
  expect(copied.html).toContain('data-pm-slice');
  await editor.click();
  await page.keyboard.press('Control+End');
  await editor.evaluate(() => document.dispatchEvent(new Event('selectionchange')));
  await editor.evaluate((element, copied) => {
    const data = new DataTransfer(); data.setData('text/html', copied.html); data.setData('text/plain', copied.text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, copied);
  await expect.poll(async () => ((await editor.textContent())!.match(/Copied Markdown/g) ?? []).length).toBe(2);
  await page.keyboard.press('Control+s');
  await expect.poll(() => (mocks.getFs()[DOC].match(/Copied Markdown/g) ?? []).length).toBe(2);
});
