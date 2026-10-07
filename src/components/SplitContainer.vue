<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useSplitView, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO } from '../composables/useSplitView';
import { useTabDrag } from '../composables/useTabDrag';
import { useWindowManager } from '../composables/useWindowManager';
import { htmlToMarkdown } from '../utils/markdown-converter';
import { wouldTruncateDocument } from '../utils/save-guard';
import { atomicWriteTextFile } from '../utils/atomic-write';
import { auditShrink } from '../utils/save-audit';
import { captureSaveState, completeSave, isSaveStateCurrent } from '../utils/save-state';
import { ratioFromPointer } from '../utils/resize';
import type { Tab } from '../composables/useTabs';
import EditorPane from './EditorPane.vue';
import ResizeDivider from './ResizeDivider.vue';

const {
  splitState,
  isSplitActive,
  leftPane,
  rightPane,
  activePaneId,
  setActivePane,
  setSplitRatio,
  switchTab,
  removeTabWithoutCreate,
  isWindowEmpty,
  disableSplit,
  updateTabContent,
  updateTabChanges,
  moveTabBetweenPanes,
  reorderTabWithinPane,
} = useSplitView();

const { setOnDrop, setOnDropOutside } = useTabDrag();
const {
  createTransferWindow,
  closeWindow,
  closeCurrentWindow,
  getAllWindows,
  getCurrentWindowLabel,
  transferTabToWindow,
} = useWindowManager();

const props = defineProps<{
  /**
   * Serializes a tab to markdown, or returns null when no mounted editor can
   * supply its text. Injected because the mode state that decides this lives in
   * App.vue.
   */
  getTabMarkdown?: (paneId: string, tab: Tab) => string | null;
}>();

const emit = defineEmits<{
  linkClick: [href: string];
  closeTabRequest: [paneId: string, tabId: string];
  changesUpdated: [paneId: string, tabId: string, hasChanges: boolean];
  togglePin: [paneId: string, tabId: string];
  closeOthers: [paneId: string, tabId: string];
  closeAll: [paneId: string];
  closeAllButPinned: [paneId: string];
  closeSaved: [paneId: string];
}>();

const leftPaneRef = ref<InstanceType<typeof EditorPane> | null>(null);
const rightPaneRef = ref<InstanceType<typeof EditorPane> | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);

onMounted(() => {
  setOnDrop((tabId, sourcePaneId, targetPaneId, targetIndex) => {
    if (sourcePaneId === targetPaneId) {
      reorderTabWithinPane(targetPaneId, tabId, targetIndex);
    } else {
      moveTabBetweenPanes({
        tabId,
        sourcePaneId,
        targetPaneId,
        targetIndex,
      });
    }
  });

  setOnDropOutside(async (tabId, paneId, filePath) => {
    if (!filePath) {
      console.log('[SplitContainer] Cannot transfer unsaved document');
      return;
    }

    try {
      const pane = splitState.value.panes.find(p => p.id === paneId);
      const tab = pane?.tabs.find(t => t.id === tabId);
      if (!tab || tab.filePath !== filePath) return;

      // Save file content before transfer. tab.content is stale in code view and
      // empty for markdown-first tabs, so go through the resolver.
      const source = props.getTabMarkdown
        ? props.getTabMarkdown(paneId, tab)
        : htmlToMarkdown(tab.content);
      if (source === null) {
        console.error('[transfer] no editor could supply content for', filePath);
        return;
      }
      const state = captureSaveState(tab, source);
      const markdownContent = source.trimEnd();
      if (wouldTruncateDocument(markdownContent, tab.originalMarkdown)) {
        console.error('[transfer] refused to empty', filePath);
        return;
      }
      auditShrink('tab-transfer', filePath, markdownContent, tab.originalMarkdown);
      await atomicWriteTextFile(filePath, markdownContent);
      if (!completeSave(state, filePath, markdownContent)) return;

      // Get current window label and all windows
      const currentWindow = await getCurrentWindowLabel();
      const allWindows = await getAllWindows();
      if (!isSaveStateCurrent(state)) return;

      // Find other windows (excluding current one)
      const otherWindows = allWindows.filter(w => w !== currentWindow);

      console.log('[SplitContainer] Current window:', currentWindow);
      console.log('[SplitContainer] Other windows:', otherWindows);

      const createdWindow = otherWindows.length === 0;
      const targetWindow = createdWindow
        ? await createTransferWindow()
        : otherWindows.includes('main') ? 'main' : otherWindows[0];
      const sourcePane = splitState.value.panes.find(p => p.tabs.includes(tab));
      if (!sourcePane || !isSaveStateCurrent(state)) {
        if (createdWindow) await closeWindow(targetWindow);
        return;
      }

      // Detach the editor before ownership moves. A rejected handoff restores it;
      // an accepted handoff leaves only the destination owning the document.
      const sourceIndex = sourcePane.tabs.indexOf(tab);
      const sourceActiveId = sourcePane.activeTabId;
      removeTabWithoutCreate(sourcePane.id, tabId);
      await nextTick();
      try {
        await transferTabToWindow(filePath, currentWindow, targetWindow);
      } catch (error) {
        const restorePane = splitState.value.panes.find(p => p.id === sourcePane.id) ?? leftPane.value;
        restorePane.tabs.splice(sourceIndex, 0, tab);
        if (sourceActiveId === tabId || !restorePane.activeTabId) restorePane.activeTabId = tabId;
        if (createdWindow) await closeWindow(targetWindow);
        throw error;
      }

      if (isWindowEmpty()) {
        await closeCurrentWindow();
        return;
      }

      if (isSplitActive.value) {
        const sourcePaneAfter = splitState.value.panes.find(p => p.id === sourcePane.id);
        if (sourcePaneAfter && sourcePaneAfter.tabs.length === 0) {
          disableSplit();
        }
      }
    } catch (error) {
      console.error('[SplitContainer] Error transferring tab:', error);
    }
  });
});

const leftPaneStyle = computed(() => ({
  flex: isSplitActive.value ? `0 0 ${splitState.value.splitRatio * 100}%` : '1',
  maxWidth: isSplitActive.value ? `${splitState.value.splitRatio * 100}%` : '100%',
}));

const rightPaneStyle = computed(() => ({
  flex: isSplitActive.value ? `0 0 ${(1 - splitState.value.splitRatio) * 100}%` : '0',
  maxWidth: isSplitActive.value ? `${(1 - splitState.value.splitRatio) * 100}%` : '0',
}));

const onDividerResize = (clientX: number) => {
  if (!containerRef.value) return;
  const bounds = containerRef.value.getBoundingClientRect();
  setSplitRatio(ratioFromPointer(clientX, bounds, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO));
};

const handleSwitchTab = (paneId: string, tabId: string) => {
  switchTab(paneId, tabId);
};

const handleCloseTab = (paneId: string, tabId: string) => {
  emit('closeTabRequest', paneId, tabId);
};

const handleContentUpdate = (paneId: string, tabId: string, content: string) => {
  updateTabContent(paneId, tabId, content);
};

const handleChangesUpdate = (paneId: string, tabId: string, hasChanges: boolean) => {
  updateTabChanges(paneId, tabId, hasChanges);
  const tab = splitState.value.panes.find(p => p.id === paneId)?.tabs.find(t => t.id === tabId);
  emit('changesUpdated', paneId, tabId, tab?.hasChanges ?? false);
};

const handleLinkClick = (href: string) => {
  emit('linkClick', href);
};

const handlePaneFocus = (paneId: string) => {
  setActivePane(paneId);
};

const getEditorContent = (paneId: string): string => {
  if (paneId === 'left' && leftPaneRef.value) {
    return leftPaneRef.value.getEditorContent();
  }
  if (paneId === 'right' && rightPaneRef.value) {
    return rightPaneRef.value.getEditorContent();
  }
  return '';
};

const setEditorContent = (paneId: string, content: string) => {
  if (paneId === 'left' && leftPaneRef.value) {
    leftPaneRef.value.setEditorContent(content);
  }
  if (paneId === 'right' && rightPaneRef.value) {
    rightPaneRef.value.setEditorContent(content);
  }
};

const getActiveEditorContent = (): string => {
  return getEditorContent(activePaneId.value);
};

const setActiveEditorContent = (content: string) => {
  setEditorContent(activePaneId.value, content);
};

const findPaneIdAt = (x: number, y: number): string | null => {
  const el = document.elementFromPoint(x, y);
  return el?.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId ?? null;
};

const findVisualTargetAt = (x: number, y: number) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;

  const paneEl = (el as Element).closest('.editor-pane') as HTMLElement | null;
  if (!paneEl) return null;

  const container = containerRef.value;
  if (!container) return null;

  const panes = Array.from(container.querySelectorAll(':scope > .editor-pane')) as HTMLElement[];
  const idx = panes.indexOf(paneEl);
  const targetRef = idx === 0 ? leftPaneRef.value : rightPaneRef.value;
  if (!targetRef) return null;

  return {
    filePath: targetRef.getFilePath?.() ?? null,
    insertImages: (items: { path: string; alt: string }[]) =>
      targetRef.insertImagesByPath?.(items),
  };
};

const getActiveVisualSearchApi = () => {
  const paneRef = activePaneId.value === 'left' ? leftPaneRef.value : rightPaneRef.value;
  if (!paneRef) return null;

  return {
    getSearchTextMap: () => paneRef.getSearchTextMap?.() ?? null,
    setSearchHighlights: (...args: Parameters<NonNullable<typeof paneRef.setSearchHighlights>>) =>
      paneRef.setSearchHighlights?.(...args),
    clearSearchHighlights: () => paneRef.clearSearchHighlights?.(),
    focusSearchMatch: (...args: Parameters<NonNullable<typeof paneRef.focusSearchMatch>>) =>
      paneRef.focusSearchMatch?.(...args),
  };
};

const getActiveEditor = () => {
  const paneRef = activePaneId.value === 'left' ? leftPaneRef.value : rightPaneRef.value;
  return paneRef?.editor ?? null;
};

defineExpose({
  getEditorContent,
  setEditorContent,
  getActiveEditorContent,
  setActiveEditorContent,
  getActiveEditor,
  getActiveVisualSearchApi,
  findVisualTargetAt,
  findPaneIdAt,
  leftPaneRef,
  rightPaneRef,
});
</script>

<template>
  <div
    ref="containerRef"
    class="split-container"
    :class="{ 'split-active': isSplitActive }"
  >
    <!-- Left Pane (always visible) -->
    <EditorPane
      ref="leftPaneRef"
      :pane="leftPane"
      :is-active="activePaneId === 'left'"
      :style="leftPaneStyle"
      @switch-tab="(tabId) => handleSwitchTab('left', tabId)"
      @close-tab="(tabId) => handleCloseTab('left', tabId)"
      @toggle-pin="(tabId) => emit('togglePin', 'left', tabId)"
      @close-others="(tabId) => emit('closeOthers', 'left', tabId)"
      @close-all="emit('closeAll', 'left')"
      @close-all-but-pinned="emit('closeAllButPinned', 'left')"
      @close-saved="emit('closeSaved', 'left')"
      @update-content="(tabId, content) => handleContentUpdate('left', tabId, content)"
      @update-changes="(tabId, hasChanges) => handleChangesUpdate('left', tabId, hasChanges)"
      @link-click="handleLinkClick"
      @focus="handlePaneFocus('left')"
    />

    <!-- Divider (only visible in split mode) -->
    <ResizeDivider v-if="isSplitActive" @resize="onDividerResize" />

    <!-- Right Pane (only in split mode) -->
    <EditorPane
      v-if="isSplitActive && rightPane"
      ref="rightPaneRef"
      :pane="rightPane"
      :is-active="activePaneId === 'right'"
      :style="rightPaneStyle"
      @switch-tab="(tabId) => handleSwitchTab('right', tabId)"
      @close-tab="(tabId) => handleCloseTab('right', tabId)"
      @toggle-pin="(tabId) => emit('togglePin', 'right', tabId)"
      @close-others="(tabId) => emit('closeOthers', 'right', tabId)"
      @close-all="emit('closeAll', 'right')"
      @close-all-but-pinned="emit('closeAllButPinned', 'right')"
      @close-saved="emit('closeSaved', 'right')"
      @update-content="(tabId, content) => handleContentUpdate('right', tabId, content)"
      @update-changes="(tabId, hasChanges) => handleChangesUpdate('right', tabId, hasChanges)"
      @link-click="handleLinkClick"
      @focus="handlePaneFocus('right')"
    />
  </div>
</template>

<style scoped>
.split-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

@media print {
  .split-container {
    display: block;
  }
}
</style>
