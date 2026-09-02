<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useSplitView, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO } from '../composables/useSplitView';
import { useTabDrag } from '../composables/useTabDrag';
import { useWindowManager } from '../composables/useWindowManager';
import { htmlToMarkdown } from '../utils/markdown-converter';
import { wouldTruncateDocument } from '../utils/save-guard';
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
  createNewWindow,
  closeCurrentWindow,
  unregisterOpenFile,
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

      // Save file content before transfer. tab.content is stale in code view and
      // empty for markdown-first tabs, so go through the resolver.
      if (tab) {
        const source = props.getTabMarkdown
          ? props.getTabMarkdown(paneId, tab)
          : htmlToMarkdown(tab.content);
        if (source === null) {
          console.error('[transfer] no editor could supply content for', filePath);
          return;
        }
        const markdownContent = source.trimEnd();
        if (wouldTruncateDocument(markdownContent, tab.originalMarkdown)) {
          console.error('[transfer] refused to empty', filePath);
          return;
        }
        await writeTextFile(filePath, markdownContent);
      }

      // Get current window label and all windows
      const currentWindow = await getCurrentWindowLabel();
      const allWindows = await getAllWindows();

      // Find other windows (excluding current one)
      const otherWindows = allWindows.filter(w => w !== currentWindow);

      console.log('[SplitContainer] Current window:', currentWindow);
      console.log('[SplitContainer] Other windows:', otherWindows);

      // Unregister the file from this window before transfer
      await unregisterOpenFile(filePath);

      if (otherWindows.length > 0) {
        // Transfer to an existing window (prefer 'main' if available, otherwise first other window)
        const targetWindow = otherWindows.includes('main') ? 'main' : otherWindows[0];
        console.log('[SplitContainer] Transferring to existing window:', targetWindow);
        await transferTabToWindow(filePath, currentWindow, targetWindow);
      } else {
        // No other windows exist, create a new one
        console.log('[SplitContainer] Creating new window');
        await createNewWindow(filePath);
      }

      if (tab) {
        tab.hasChanges = false;
      }
      removeTabWithoutCreate(paneId, tabId);

      if (isWindowEmpty()) {
        await closeCurrentWindow();
        return;
      }

      if (isSplitActive.value) {
        const sourcePaneAfter = splitState.value.panes.find(p => p.id === paneId);
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
  emit('changesUpdated', paneId, tabId, hasChanges);
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
