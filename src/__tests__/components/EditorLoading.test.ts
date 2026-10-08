import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import Editor from '../../components/Editor.vue';
import { useSplitView } from '../../composables/useSplitView';
import { createDefaultSplitViewState } from '../../types/pane';
import { markdownToHtml } from '../../utils/markdown-converter';
import { captureSaveState, completeSave, setDocumentMarkdown } from '../../utils/save-state';

const LOADED_MARKDOWN = '# Loaded document\n\nParagraph from disk.\n';

describe('programmatic editor loading', () => {
  const wrappers: ReturnType<typeof mount<typeof Editor>>[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    useSplitView().splitState.value = createDefaultSplitViewState();
  });

  afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount());
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function mountDocument() {
    const split = useSplitView();
    const tab = split.leftPane.value.tabs[0];
    tab.filePath = '/test/loaded.md';
    tab.originalMarkdown = 'Previous';
    setDocumentMarkdown(tab, 'Previous');
    tab.content = '<p>Previous</p>';
    const wrapper = mount(Editor, {
      props: {
        modelValue: tab.content,
        documentId: tab.id,
        'onUpdate:modelValue': (html: string, documentId: string | undefined) => {
          if (documentId) split.updateTabContent('left', documentId, html);
        },
        'onUpdate:hasChanges': (changed: boolean, documentId: string | undefined) => {
          if (documentId) split.updateTabChanges('left', documentId, changed);
        },
      },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    return { wrapper, tab };
  }

  it.each([LOADED_MARKDOWN, ''])('preserves the loaded source and clean state for %j', async markdown => {
    const { wrapper, tab } = await mountDocument();
    tab.originalMarkdown = markdown;
    setDocumentMarkdown(tab, markdown);
    tab.content = markdownToHtml(markdown);
    const revision = tab.editRevision;

    await wrapper.setProps({ modelValue: tab.content });
    await vi.advanceTimersByTimeAsync(300);

    expect(wrapper.vm.editor?.getText()).toBe(markdown ? 'Loaded document\n\nParagraph from disk.' : '');
    expect(tab.markdown).toBe(markdown.trimEnd());
    expect(tab.originalMarkdown).toBe(markdown);
    expect(tab.editRevision).toBe(revision);
    expect(tab.hasChanges).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('records a real edit while load timers and an older save completion are pending', async () => {
    const { wrapper, tab } = await mountDocument();
    tab.originalMarkdown = LOADED_MARKDOWN;
    setDocumentMarkdown(tab, LOADED_MARKDOWN);
    tab.content = markdownToHtml(LOADED_MARKDOWN);
    await wrapper.setProps({ modelValue: tab.content });
    const saved = captureSaveState(tab);
    const revision = tab.editRevision ?? 0;
    const editor = wrapper.vm.editor!;

    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' NEWER WORK');
    await nextTick();

    expect(tab.markdown).toContain('Paragraph from disk. NEWER WORK');
    expect(tab.editRevision).toBe(revision + 1);
    expect(tab.hasChanges).toBe(true);
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
    expect(completeSave(saved, tab.filePath!, saved.markdown)).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(tab.markdown).toContain('NEWER WORK');
    expect(tab.originalMarkdown).not.toContain('NEWER WORK');
    expect(tab.editRevision).toBe(revision + 1);
    expect(tab.hasChanges).toBe(true);
    expect(editor.getText()).toContain('NEWER WORK');
  });
});
