import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodeView } from '../../composables/useCodeView';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdown-converter';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Editor from '../../components/Editor.vue';
import { useSettings } from '../../composables/useSettings';

const SOURCE = '\n# Heading\n\n\n\nFirst paragraph.\n\n\nSecond paragraph.\n\n';

describe('raw Markdown and rendered content', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it.each([SOURCE, SOURCE.replace(/\n/g, '\r\n')])('uses source lines in code view without adding empty visual paragraphs (%j)', async source => {
    const html = markdownToHtml(SOURCE);
    const visual = document.createElement('div');
    visual.innerHTML = html;
    expect(visual.querySelectorAll('h1, p')).toHaveLength(3);
    expect(htmlToMarkdown(html)).not.toBe(SOURCE);
    const setActiveContent = vi.fn(), markAsChanged = vi.fn();
    const options = { getActiveContent: () => html, getActiveMarkdown: () => source, setActiveContent, markAsChanged };
    const view = useCodeView(options);
    await view.toggleCodeView(null);
    expect(view.codeContent.value).toBe(SOURCE);
    await view.toggleCodeView(null);
    expect(setActiveContent).not.toHaveBeenCalled();
    expect(markAsChanged).not.toHaveBeenCalled();
  });

  it.each([true, false])('does not reserve a gutter in the visual editor when showLineNumbers=%s', async enabled => {
    const { settings, setShowLineNumbers } = useSettings();
    const previous = settings.value.showLineNumbers;
    setShowLineNumbers(enabled);
    const wrapper = mount(Editor, { props: { modelValue: markdownToHtml(SOURCE), documentId: 'visual-document' }, attachTo: document.body });
    try {
      await nextTick();
      await vi.advanceTimersByTimeAsync(0);
      expect(wrapper.find('.ProseMirror').exists()).toBe(true);
      expect(wrapper.find('.editor-gutter').exists()).toBe(false);
      expect(wrapper.find('.editor-content-wrapper').classes()).not.toContain('has-line-numbers');
      expect(settings.value.showLineNumbers).toBe(enabled);
    } finally { wrapper.unmount(); setShowLineNumbers(previous); }
  });
});
