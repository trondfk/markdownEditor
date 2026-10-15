import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Editor from '../../components/Editor.vue';
import { htmlToMarkdown } from '../../utils/markdown-converter';

const fs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  mkdir: vi.fn(), writeFile: vi.fn(), readFile: vi.fn(), exists: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ ...fs }));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: async () => 'C:\\Users\\Tester\\AppData\\Roaming\\MerMark' }));

const DOC = '\\\\?\\C:\\Notes\\document.md';
const BYTES = new Uint8Array([137, 80, 78, 71]);
const ORIGINAL = '<p>Keep all existing text.</p>';

describe('visual editor clipboard images', () => {
  const wrappers: ReturnType<typeof mount<typeof Editor>>[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:clipboard-image'); });
    fs.files.clear(); vi.clearAllMocks();
    const validate = (path: string) => {
      if (path.startsWith('\\\\?\\') && path.includes('/')) throw new Error('Invalid Windows verbatim path separator');
    };
    fs.mkdir.mockImplementation(async (path: string) => { validate(path); });
    const key = (path: string) => path.startsWith('\\\\?\\') ? path : path.replace(/\\/g, '/');
    fs.writeFile.mockImplementation(async (path: string, bytes: Uint8Array) => { validate(path); fs.files.set(key(path), bytes); });
    fs.exists.mockImplementation(async (path: string) => fs.files.has(key(path)));
    fs.readFile.mockImplementation(async (path: string) => {
      validate(path);
      if (!fs.files.has(key(path))) throw new Error(`ENOENT: ${path}`);
      return fs.files.get(key(path))!;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount());
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  async function open(filePath: string | null) {
    const wrapper = mount(Editor, { props: { modelValue: ORIGINAL, documentId: 'clipboard-document', filePath }, attachTo: document.body });
    wrappers.push(wrapper);
    await nextTick(); await vi.advanceTimersByTimeAsync(300);
    wrapper.vm.editor!.commands.setTextSelection(wrapper.vm.editor!.state.doc.content.size - 1);
    return wrapper;
  }

  async function paste(wrapper: Awaited<ReturnType<typeof open>>, file?: File, text = '') {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      items: file ? [{ kind: 'file', type: file.type, getAsFile: () => file }] : [],
      files: file ? [file] : [], getData: (type: string) => type === 'text/plain' ? text : '',
    } });
    wrapper.find('.ProseMirror').element.dispatchEvent(event);
    await flushPromises(); await nextTick();
    return event;
  }

  function screenshot(unreadable = false) {
    const file = new File([BYTES], 'screenshot.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => {
      if (unreadable) throw new Error('Clipboard bytes unavailable');
      return BYTES.buffer;
    } });
    return file;
  }

  it.each([DOC, 'C:\\Notes\\ordinary.md', null])('imports a screenshot into the existing document for %s', async filePath => {
    const wrapper = await open(filePath);
    const event = await paste(wrapper, screenshot());
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.vm.editor!.getText()).toContain('Keep all existing text.');
    expect(wrapper.findAll('img.editor-image')).toHaveLength(1);
    const expected = filePath === DOC ? '\\\\?\\C:\\Notes\\images\\screenshot-1234.png'
      : filePath ? 'C:\\Notes/images/screenshot-1234.png' : 'C:/Users/Tester/AppData/Roaming/MerMark/unsaved-images/screenshot-1234.png';
    expect(fs.writeFile).toHaveBeenCalledExactlyOnceWith(expected, BYTES);
    expect(fs.readFile).toHaveBeenCalledWith(filePath && filePath !== DOC ? expected.replace(/\\/g, '/') : expected);
    expect(wrapper.find('img').attributes('src')).toBe('blob:clipboard-image');
    const source = htmlToMarkdown(wrapper.vm.editor!.getHTML());
    expect(source).toContain(filePath ? 'images/screenshot-1234.png' : expected);
    expect(source).not.toContain('blob:');
    expect(wrapper.emitted('update:modelValue')!.slice(-1)[0][1]).toBe('clipboard-document');
    expect(wrapper.emitted('update:hasChanges')!.slice(-1)[0][0]).toBe(true);
  });

  it('resolves an existing relative image against the canonical Windows document directory', async () => {
    const expected = '\\\\?\\C:\\Notes\\images\\existing.png';
    fs.files.set(expected, BYTES);
    const wrapper = await open(DOC);
    await wrapper.vm.insertImagesByPath([{ path: 'images/existing.png', alt: 'Existing' }]);
    expect(fs.readFile).toHaveBeenCalledWith(expected);
    expect(wrapper.find('img').attributes('src')).toBe('blob:clipboard-image');
  });

  it.each(['write', 'clipboard'])('leaves document content and selection intact after a %s failure', async failure => {
    const wrapper = await open(DOC);
    wrapper.vm.editor!.commands.selectAll();
    const before = wrapper.vm.editor!.getHTML();
    const selection = wrapper.vm.editor!.state.selection.toJSON();
    if (failure === 'write') fs.writeFile.mockRejectedValueOnce(new Error('Disk unavailable'));
    await paste(wrapper, screenshot(failure === 'clipboard'));
    expect(wrapper.vm.editor!.getHTML()).toBe(before);
    expect(wrapper.vm.editor!.state.selection.toJSON()).toEqual(selection);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('keeps existing image bytes and uses the existing collision naming convention', async () => {
    const existing = '\\\\?\\C:\\Notes\\images\\screenshot-1234.png';
    const original = new Uint8Array([1, 2, 3]);
    fs.files.set(existing, original);
    const wrapper = await open(DOC);
    await paste(wrapper, screenshot());
    expect(fs.writeFile).toHaveBeenCalledExactlyOnceWith('\\\\?\\C:\\Notes\\images\\screenshot-1234 (1).png', BYTES);
    expect(fs.files.get(existing)).toEqual(original);
    expect(wrapper.findAll('img.editor-image')).toHaveLength(1);
  });

  it('continues to paste ordinary text when no image is present', async () => {
    const wrapper = await open(DOC);
    await paste(wrapper, undefined, ' pasted text');
    expect(wrapper.vm.editor!.getText()).toContain('Keep all existing text. pasted text');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('never inserts a delayed screenshot into a replacement editor', async () => {
    const original = await open(DOC);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = fs.writeFile.getMockImplementation()!;
    fs.writeFile.mockImplementationOnce(async (path: string, bytes: Uint8Array) => {
      entered(); await gate; return write(path, bytes);
    });
    const pending = paste(original, screenshot());
    try {
      await started;
      original.unmount();
      const replacement = await open('C:\\Notes\\replacement.md');
      const before = replacement.vm.editor!.getHTML();
      release(); await pending; await flushPromises();
      expect(replacement.vm.editor!.getHTML()).toBe(before);
      expect(replacement.emitted('update:modelValue')).toBeUndefined();
    } finally { release(); await pending; }
  });
});
