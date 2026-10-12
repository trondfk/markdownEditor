import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodeView } from '../../composables/useCodeView';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdown-converter';
import { mount } from '@vue/test-utils';
import EditorGutter from '../../components/EditorGutter.vue';

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

  it('labels visual row numbers distinctly from Markdown source line numbers', () => {
    const wrapper = mount(EditorGutter, { props: { lines: [{ top: 0, height: 24, num: 1 }, { top: 24, height: 24, num: 2 }] } });
    try {
      expect(wrapper.attributes('data-line-number-kind')).toBe('visual');
      expect(wrapper.attributes('title')).toMatch(/source|kilde/);
      expect(wrapper.findAll('.editor-gutter-line').map(line => line.text())).toEqual(['V1', 'V2']);
    } finally { wrapper.unmount(); }
  });
});
