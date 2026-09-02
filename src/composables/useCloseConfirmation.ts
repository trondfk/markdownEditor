import { ref, type Ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { wouldTruncateDocument } from '../utils/save-guard';
import type { Tab } from './useTabs';

export interface TabToSave {
  tab: Tab;
  index: number;
}

export interface UseCloseConfirmationOptions {
  tabs: Ref<Tab[]>;
  /**
   * Serializes a tab to markdown, or returns null when no mounted editor can
   * supply its text. Never falls back to a placeholder: a null here means the
   * save must be skipped, not that the document is empty.
   */
  getTabMarkdown: (tab: Tab) => string | null;
  switchToTab: (tabId: string, preserveHasChanges?: boolean) => Promise<void>;
  syncActiveTabContent?: () => void;
  /** Surfaces a save that could not be performed, so the user isn't stuck. */
  onSaveFailed?: (tab: Tab) => void;
}

export interface UseCloseConfirmationReturn {
  showSaveConfirmDialog: Ref<boolean>;
  currentTabToSave: Ref<TabToSave | null>;
  tabsToSaveCount: Ref<number>;
  currentTabIndex: Ref<number>;
  setupCloseHandler: () => Promise<() => void>;
  handleSave: () => Promise<void>;
  handleDiscard: () => void;
  handleCancel: () => void;
}

export function useCloseConfirmation(options: UseCloseConfirmationOptions): UseCloseConfirmationReturn {
  const { tabs, getTabMarkdown, switchToTab, syncActiveTabContent, onSaveFailed } = options;

  const showSaveConfirmDialog = ref(false);
  const currentTabToSave = ref<TabToSave | null>(null);
  const tabsToSave = ref<TabToSave[]>([]);
  const tabsToSaveCount = ref(0);
  const currentTabIndex = ref(0);

  const collectUnsavedTabs = (): TabToSave[] => {
    const unsaved: TabToSave[] = [];
    tabs.value.forEach((tab, index) => {
      if (tab.hasChanges) {
        unsaved.push({ tab, index });
      }
    });
    return unsaved;
  };

  const closeWindow = async (): Promise<void> => {
    // Force exit the application
    await exit(0);
  };

  const processNextTab = (): void => {
    if (tabsToSave.value.length === 0) {
      // All tabs processed, close the window
      showSaveConfirmDialog.value = false;
      currentTabToSave.value = null;
      closeWindow();
      return;
    }

    currentTabIndex.value++;
    currentTabToSave.value = tabsToSave.value.shift() || null;

    if (currentTabToSave.value) {
      // Switch to the tab so user can see what they're saving
      switchToTab(currentTabToSave.value.tab.id, true);
    }
  };

  const saveTabContent = async (tab: Tab): Promise<boolean> => {
    try {
      // Resolve the text before prompting for a path, so a tab we cannot
      // serialize never reaches writeTextFile.
      const source = getTabMarkdown(tab);
      if (source === null) {
        console.error('[close] no editor could supply content for', tab.fileName);
        onSaveFailed?.(tab);
        return false;
      }

      const markdown = source.trimEnd();
      if (wouldTruncateDocument(markdown, tab.originalMarkdown)) {
        console.error('[close] refused to empty', tab.fileName);
        onSaveFailed?.(tab);
        return false;
      }

      let filePath = tab.filePath;

      if (!filePath) {
        filePath = await save({
          filters: [{ name: 'Markdown', extensions: ['md'] }],
          defaultPath: `${tab.fileName.replace(/\.[^.]+$/, '')}.md`,
        });
      }

      if (filePath) {
        await writeTextFile(filePath, markdown);

        // Update the tab
        tab.filePath = filePath;
        tab.fileName = filePath.split(/[/\\]/).pop() || 'Dokument';
        tab.hasChanges = false;
        tab.originalMarkdown = markdown;
        return true;
      }

      // User cancelled save dialog
      return false;
    } catch (error) {
      console.error('Error saving file:', error);
      return false;
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!currentTabToSave.value) return;

    const saved = await saveTabContent(currentTabToSave.value.tab);

    if (saved) {
      processNextTab();
    }
    // If not saved (user cancelled), stay on current dialog
  };

  const handleDiscard = (): void => {
    if (!currentTabToSave.value) return;

    // Mark as not having changes (discard)
    currentTabToSave.value.tab.hasChanges = false;
    processNextTab();
  };

  const handleCancel = (): void => {
    // Cancel the entire close operation
    showSaveConfirmDialog.value = false;
    currentTabToSave.value = null;
    tabsToSave.value = [];
    // Don't close - user wants to keep working
  };

  const setupCloseHandler = async (): Promise<() => void> => {
    const appWindow = getCurrentWindow();

    const unlisten = await appWindow.onCloseRequested(async (event) => {
      try {
        // Sync active tab content before checking for unsaved changes
        if (syncActiveTabContent) {
          syncActiveTabContent();
        }

        const unsavedTabs = collectUnsavedTabs();

        if (unsavedTabs.length === 0) {
          // No unsaved changes - let the window close naturally
          return;
        }

        // Prevent default close to show save confirmation
        event.preventDefault();

        tabsToSave.value = [...unsavedTabs];
        tabsToSaveCount.value = unsavedTabs.length;
        currentTabIndex.value = 0;

        processNextTab();
        showSaveConfirmDialog.value = true;
      } catch (error) {
        console.error('Error in close handler:', error);
        // On error, don't prevent - let window close
      }
    });

    return unlisten;
  };

  return {
    showSaveConfirmDialog,
    currentTabToSave,
    tabsToSaveCount,
    currentTabIndex,
    setupCloseHandler,
    handleSave,
    handleDiscard,
    handleCancel,
  };
}
