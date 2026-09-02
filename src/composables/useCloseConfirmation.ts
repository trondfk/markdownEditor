import { ref, type Ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { save } from '@tauri-apps/plugin-dialog';
import { wouldTruncateDocument } from '../utils/save-guard';
import { atomicWriteTextFile } from '../utils/atomic-write';
import { auditShrink } from '../utils/save-audit';
import type { Tab } from './useTabs';

/** A dirty tab together with the pane that holds it. */
export interface UnsavedTab {
  paneId: string;
  tab: Tab;
}

export type TabToSave = UnsavedTab;

export interface UseCloseConfirmationOptions {
  /**
   * Every tab in the window with unsaved changes, across all panes.
   *
   * This has to span panes. Collecting only the focused pane's tabs let a
   * split pane's edits be discarded on close without so much as a prompt.
   */
  collectUnsavedTabs: () => UnsavedTab[];
  /**
   * Serializes a tab to markdown, or returns null when no mounted editor can
   * supply its text. Never falls back to a placeholder: a null here means the
   * save must be skipped, not that the document is empty.
   */
  getTabMarkdown: (paneId: string, tab: Tab) => string | null;
  /** Focuses a tab, switching panes when the tab lives in the other one. */
  switchToTab: (paneId: string, tabId: string) => Promise<void>;
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
  const { collectUnsavedTabs, getTabMarkdown, switchToTab, syncActiveTabContent, onSaveFailed } =
    options;

  const showSaveConfirmDialog = ref(false);
  const currentTabToSave = ref<TabToSave | null>(null);
  const tabsToSave = ref<TabToSave[]>([]);
  const tabsToSaveCount = ref(0);
  const currentTabIndex = ref(0);

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
      // Switch to the tab so user can see what they're saving. Focusing it also
      // mounts its editor, which is what lets the serializer read live text for
      // a tab that was sitting in the unfocused pane.
      switchToTab(currentTabToSave.value.paneId, currentTabToSave.value.tab.id);
    }
  };

  const saveTabContent = async (paneId: string, tab: Tab): Promise<boolean> => {
    try {
      // Resolve the text before prompting for a path, so a tab we cannot
      // serialize never reaches the disk.
      const source = getTabMarkdown(paneId, tab);
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
        auditShrink('close-save', filePath, markdown, tab.originalMarkdown);
        await atomicWriteTextFile(filePath, markdown);

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

    const saved = await saveTabContent(
      currentTabToSave.value.paneId,
      currentTabToSave.value.tab,
    );

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
