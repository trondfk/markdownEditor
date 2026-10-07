import { ref, computed, nextTick, type Ref, type ComputedRef } from 'vue';
import { t } from '../i18n';
import { EMPTY_TAB_CONTENT } from '../constants';
import { refreshDirtyState, setDocumentMarkdown } from '../utils/save-state';
import { htmlToMarkdown } from '../utils/markdown-converter';

export interface Tab {
  id: string;
  filePath: string | null;
  fileName: string;
  content: string;
  hasChanges: boolean;
  /** Monotonic edit counter, including raw-source edits that do not update HTML. */
  editRevision?: number;
  /** Current authoritative Markdown. HTML and pendingMarkdown are view caches. */
  markdown?: string;
  scrollTop: number;
  originalMarkdown: string | null;
  /**
   * User-pinned flag. Pinned tabs are protected from "Close all" / "Close
   * others" actions and may be visually rendered differently. Persisted
   * with the session by useSessionRestore.
   */
  pinned?: boolean;
  /** True when the file exceeded LARGE_FILE_CHAR_THRESHOLD at open. */
  largeFile?: boolean;
  /**
   * Raw markdown source of truth while no HTML has been generated yet.
   * Non-null only for large files that have never entered a visual view.
   */
  pendingMarkdown?: string | null;
}

export interface UseTabsOptions {
  onContentChange?: (content: string) => void;
}

export interface UseTabsReturn {
  tabs: Ref<Tab[]>;
  activeTabId: Ref<string>;
  activeTab: ComputedRef<Tab>;
  createNewTab: (filePath?: string | null, fileContent?: string, fileName?: string) => string;
  switchToTab: (tabId: string, preserveHasChanges?: boolean, getEditorContent?: () => string, setEditorContent?: (content: string) => void) => Promise<void>;
  closeTab: (tabId: string, getEditorContent?: () => string, setEditorContent?: (content: string) => void) => Promise<void>;
  findTabByFilePath: (filePath: string) => Tab | undefined;
  updateTabContent: (content: string) => void;
  updateTabChanges: (hasChanges: boolean) => void;
  saveScrollPosition: (scrollTop: number) => void;
}

export function useTabs(): UseTabsReturn {
  const tabs = ref<Tab[]>([{
    id: 'tab-1',
    filePath: null,
    fileName: t.value.newDocument,
    content: EMPTY_TAB_CONTENT,
    hasChanges: false,
    scrollTop: 0,
    originalMarkdown: null,
  }]);

  const activeTabId = ref('tab-1');
  let tabCounter = 1;

  const activeTab = computed(() =>
    tabs.value.find(t => t.id === activeTabId.value) || tabs.value[0]
  );

  const findActiveTabIndex = (): number =>
    tabs.value.findIndex(t => t.id === activeTabId.value);

  const createNewTab = (
    filePath: string | null = null,
    fileContent: string = EMPTY_TAB_CONTENT,
    fileName?: string
  ): string => {
    tabCounter++;
    const newTabId = `tab-${tabCounter}`;
    tabs.value.push({
      id: newTabId,
      filePath,
      fileName: fileName ?? t.value.newDocument,
      content: fileContent,
      hasChanges: false,
      scrollTop: 0,
      originalMarkdown: null,
    });
    return newTabId;
  };

  const switchToTab = async (
    tabId: string,
    preserveHasChanges: boolean = true,
    getEditorContent?: () => string,
    setEditorContent?: (content: string) => void
  ): Promise<void> => {
    // Save current editor content to current tab before switching
    if (getEditorContent) {
      const currentIdx = findActiveTabIndex();
      if (currentIdx !== -1) {
        tabs.value[currentIdx].content = getEditorContent();
      }
    }

    activeTabId.value = tabId;

    // Update editor with new tab's content
    if (setEditorContent && activeTab.value) {
      setEditorContent(activeTab.value.content || EMPTY_TAB_CONTENT);

      await nextTick();

      // Content load notifications cannot override the document's saved state.
      if (preserveHasChanges) {
        const tab = tabs.value.find(t => t.id === tabId);
        if (tab) {
          refreshDirtyState(tab);
        }
      }
    }
  };

  const closeTab = async (
    tabId: string,
    _getEditorContent?: () => string,
    setEditorContent?: (content: string) => void
  ): Promise<void> => {
    const tabIndex = tabs.value.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    // Remove the tab
    tabs.value.splice(tabIndex, 1);

    // If we closed the active tab, switch to another
    if (activeTabId.value === tabId) {
      if (tabs.value.length > 0) {
        const newIndex = Math.max(0, tabIndex - 1);
        activeTabId.value = tabs.value[newIndex].id;
        if (setEditorContent) {
          setEditorContent(tabs.value[newIndex].content);
        }
      } else {
        // Create a new empty tab if all tabs are closed
        const newTabId = createNewTab();
        activeTabId.value = newTabId;
        if (setEditorContent) {
          setEditorContent(EMPTY_TAB_CONTENT);
        }
      }
      await nextTick();
    }
  };

  const findTabByFilePath = (filePath: string): Tab | undefined => {
    return tabs.value.find(t => t.filePath === filePath);
  };

  const updateTabContent = (content: string): void => {
    const idx = findActiveTabIndex();
    if (idx !== -1) {
      if (tabs.value[idx].content !== content) {
        setDocumentMarkdown(tabs.value[idx], htmlToMarkdown(content));
      }
      tabs.value[idx].content = content;
    }
  };

  const updateTabChanges = (_hasChanges: boolean): void => {
    const idx = findActiveTabIndex();
    if (idx !== -1) {
      refreshDirtyState(tabs.value[idx]);
    }
  };

  const saveScrollPosition = (scrollTop: number): void => {
    const idx = findActiveTabIndex();
    if (idx !== -1) {
      tabs.value[idx].scrollTop = scrollTop;
    }
  };

  return {
    tabs,
    activeTabId,
    activeTab,
    createNewTab,
    switchToTab,
    closeTab,
    findTabByFilePath,
    updateTabContent,
    updateTabChanges,
    saveScrollPosition,
  };
}
