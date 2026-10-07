import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createDefaultPane } from '../../types/pane';
import EditorPane from '../../components/EditorPane.vue';
import { useTabSerializer } from '../../composables/useTabSerializer';

const editorMock = vi.hoisted(() => ({ ready: false }));
vi.mock('../../components/Editor.vue', () => ({ default: {
  props: ['documentId', 'modelValue'],
  setup: (props: { documentId: string; modelValue: string }, { expose }: { expose: (value: object) => void }) => {
    const documentId = props.documentId;
    expose({ documentId, editor: editorMock.ready ? { getHTML: () => props.modelValue } : undefined });
  },
  template: '<div />',
} }));
vi.mock('../../components/TabBar.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../../composables/useWorkspace', () => ({ useWorkspace: () => ({ dropTargetPaneId: { value: null } }) }));
vi.mock('../../composables/useTabDrag', () => ({ useTabDrag: () => ({ isDragging: false, draggedTab: null }) }));

describe('editor availability for saving', () => {
  beforeEach(() => { editorMock.ready = false; });
  it('returns null when the pane is mounted but the editor is unavailable', () => {
    const wrapper = mount(EditorPane, { props: { pane: createDefaultPane('left'), isActive: true } });
    try {
      expect(wrapper.vm.getEditorContent()).toBeNull();
      expect(wrapper.vm.getEditorSource()).toBeNull();
    } finally { wrapper.unmount(); }
  });

  it('exposes the actual loaded document while a tab switch is waiting for rendering', async () => {
    editorMock.ready = true;
    const pane = reactive(createDefaultPane('left'));
    const first = pane.tabs[0];
    delete first.markdown;
    first.content = '<p>First</p>';
    const second = { ...first, id: 'second', content: '<p>Second</p>' };
    pane.tabs.push(second);
    const wrapper = mount(EditorPane, { props: { pane, isActive: true } });
    const serializer = useTabSerializer({
      activeTabId: ref(second.id), activePaneId: ref('left'), isMarkdownFirst: () => false,
      getEditorSource: () => wrapper.vm.getEditorSource(),
    });
    try {
      pane.activeTabId = second.id;
      expect(wrapper.vm.getEditorSource()?.tabId).toBe(first.id);
      expect(serializer.getTabMarkdown('left', second)).toBeNull();
      await nextTick();
      expect(wrapper.vm.getEditorSource()?.tabId).toBe(second.id);
      expect(serializer.getTabMarkdown('left', second)).toBe('Second');
    } finally { wrapper.unmount(); }
  });

  it('exposes a genuinely empty ready editor as available content', () => {
    editorMock.ready = true;
    const pane = createDefaultPane('left');
    delete pane.tabs[0].markdown;
    pane.tabs[0].content = '';
    const wrapper = mount(EditorPane, { props: { pane, isActive: true } });
    try {
      const source = wrapper.vm.getEditorSource();
      expect(source?.tabId).toBe(pane.tabs[0].id);
      const serializer = useTabSerializer({
        activeTabId: ref(pane.activeTabId), activePaneId: ref('left'), isMarkdownFirst: () => false,
        getEditorSource: () => source,
      });
      expect(serializer.getTabMarkdown('left', pane.tabs[0])).toBe('');
    } finally { wrapper.unmount(); }
  });

  it('routes delayed editor updates to their loaded document rather than the newly active tab', () => {
    editorMock.ready = true;
    const pane = reactive(createDefaultPane('left'));
    const first = pane.tabs[0];
    const second = { ...first, id: 'second' };
    pane.tabs.push(second);
    const wrapper = mount(EditorPane, { props: { pane, isActive: true } });
    try {
      pane.activeTabId = second.id;
      const previousEditor = wrapper.findComponent({ ref: 'editorRef' });
      previousEditor.vm.$emit('update:modelValue', '<p>Later first edit</p>', first.id);
      previousEditor.vm.$emit('update:hasChanges', true, first.id);
      expect(wrapper.emitted('updateContent')).toEqual([[first.id, '<p>Later first edit</p>']]);
      expect(wrapper.emitted('updateChanges')).toEqual([[first.id, true]]);
    } finally { wrapper.unmount(); }
  });

  it('ignores delayed updates from an editor whose document has been removed', () => {
    editorMock.ready = true;
    const pane = reactive(createDefaultPane('left'));
    const first = pane.tabs[0];
    pane.tabs.push({ ...first, id: 'second' });
    const wrapper = mount(EditorPane, { props: { pane, isActive: true } });
    try {
      const previousEditor = wrapper.findComponent({ ref: 'editorRef' });
      pane.tabs.shift();
      pane.activeTabId = 'second';
      previousEditor.vm.$emit('update:modelValue', '<p>Removed work</p>', first.id);
      previousEditor.vm.$emit('update:hasChanges', true, first.id);
      expect(wrapper.emitted('updateContent')).toBeUndefined();
      expect(wrapper.emitted('updateChanges')).toBeUndefined();
    } finally { wrapper.unmount(); }
  });
});
