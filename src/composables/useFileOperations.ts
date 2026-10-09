import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { htmlToMarkdown, markdownToHtml, detectLineEnding, applyLineEnding, generateSlug } from '../utils/markdown-converter';
import { atomicWriteTextFile } from '../utils/atomic-write';
import { auditShrink } from '../utils/save-audit';
import { captureSaveState, completeSave, setDocumentMarkdown, type SaveState } from '../utils/save-state';
import { t } from '../i18n';
import { aiCommands } from '../services/aiCommands';
import type { Tab } from './useTabs';
import { EMPTY_TAB_CONTENT, DEFAULT_FILE_NAME, DOM_SELECTORS, LARGE_FILE_CHAR_THRESHOLD } from '../constants';

export interface UseFileOperationsOptions {
  tabs: Ref<Tab[]>;
  activeTabId: Ref<string>;
  activeTab: ComputedRef<Tab>;
  findTabByFilePath: (filePath: string) => Tab | undefined;
  createNewTab: (filePath?: string | null, fileContent?: string, fileName?: string) => string;
  switchToTab: (tabId: string, preserveHasChanges?: boolean) => Promise<void>;
  getEditorHtml: () => string;
  /** Optional override — when provided, used directly as markdown instead of converting from HTML.
   *  Use this to pass raw codeContent when saving from code view. */
  getMarkdownOverride?: () => string | null;
  /** Resolves the active document's authoritative or verified editor source.
   *  A null result aborts the save without falling back to placeholder HTML. */
  getSaveMarkdown?: () => string | null;
  /** Surfaces a save that had to be abandoned because the text could not be
   *  resolved, so the user is not left believing the file was written. */
  onSaveFailed?: (tab: Tab) => void;
  setEditorContent: (content: string) => void;
  markSaveStart?: (filePath: string) => void;
  markSaveEnd?: (filePath: string, content: string) => void;
  onFileOpened?: (filePath: string, content: string) => void;
  /** Fired when a file above LARGE_FILE_CHAR_THRESHOLD was opened markdown-first
   *  (tab.pendingMarkdown set, no HTML generated) — the host must present it in
   *  code view because the visual editor has nothing to show. */
  onLargeFileOpened?: (filePath: string, markdown: string) => void;
  /** Called after a successful save / save-as so the host can register a
   *  file watcher for new paths. Safe to call repeatedly — the watcher
   *  layer ignores already-watched files. */
  onAfterSave?: (filePath: string, content: string) => void;
  /** Returns 'save' | 'cancel' | mergedMarkdownString (to save the merged version).
   *  localMarkdown is the current editor content (used to compute a local→disk diff). */
  onPreSaveConflict?: (filePath: string, diskContent: string, localMarkdown: string) => Promise<'save' | 'cancel' | string>;
  /** Called when a `#anchor` link matches no heading, so the host can tell the
   *  user instead of leaving the click looking like a no-op. */
  onAnchorNotFound?: (anchor: string) => void;
}

export interface UseFileOperationsReturn {
  currentFile: ComputedRef<string | null>;
  isLoadingFile: Ref<boolean>;
  showExternalLinkDialog: Ref<boolean>;
  pendingExternalUrl: Ref<string>;
  openFile: () => Promise<void>;
  openFileFromPath: (filePath: string) => Promise<boolean>;
  saveFile: (target?: DocumentSaveTarget) => Promise<boolean>;
  saveFileAs: () => Promise<void>;
  handleLinkClick: (href: string) => void;
  confirmExternalLink: () => Promise<void>;
  cancelExternalLink: () => void;
  openFileInNewTab: (relativePath: string) => Promise<void>;
}

export interface DocumentSaveTarget {
  tab: Tab;
  markdown: string | null;
}

export function useFileOperations(options: UseFileOperationsOptions): UseFileOperationsReturn {
  const {
    tabs,
    activeTabId,
    activeTab,
    findTabByFilePath,
    createNewTab,
    switchToTab,
    getEditorHtml,
    getMarkdownOverride,
    getSaveMarkdown,
    onSaveFailed,
    setEditorContent,
    markSaveStart,
    markSaveEnd,
    onAfterSave,
    onFileOpened,
    onLargeFileOpened,
    onPreSaveConflict,
    onAnchorNotFound,
  } = options;

  const currentFile = computed(() => activeTab.value?.filePath || null);
  const isLoadingFile = ref(false);

  // External link confirmation state
  const showExternalLinkDialog = ref(false);
  const pendingExternalUrl = ref('');

  // Get directory from file path
  const getDirectoryFromPath = (filePath: string): string => {
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return lastSlash > 0 ? filePath.substring(0, lastSlash) : '';
  };

  const extractFileName = (filePath: string): string =>
    filePath.split(/[/\\]/).pop() || DEFAULT_FILE_NAME;

  const isActiveTabEmpty = (): boolean =>
    !activeTab.value?.filePath && !activeTab.value?.hasChanges && activeTab.value?.content === EMPTY_TAB_CONTENT;

  const findActiveTabIndex = (): number =>
    tabs.value.findIndex(t => t.id === activeTabId.value);

  const loadFileIntoTab = async (filePath: string): Promise<boolean> => {
    // Check if file is already open
    const existingTab = findTabByFilePath(filePath);
    if (existingTab) {
      await switchToTab(existingTab.id);
      return true;
    }

    const fileContent = await readTextFile(filePath);
    const isLarge = fileContent.length > LARGE_FILE_CHAR_THRESHOLD;
    const htmlContent = isLarge ? '' : markdownToHtml(fileContent);
    const fileName = extractFileName(filePath);

    const activeIdx = findActiveTabIndex();
    if (isActiveTabEmpty() && activeIdx !== -1) {
      tabs.value[activeIdx].filePath = filePath;
      tabs.value[activeIdx].fileName = fileName;
      tabs.value[activeIdx].content = htmlContent;
      tabs.value[activeIdx].hasChanges = false;
      tabs.value[activeIdx].originalMarkdown = fileContent;
      setDocumentMarkdown(tabs.value[activeIdx], fileContent);
      tabs.value[activeIdx].largeFile = isLarge || undefined;
      tabs.value[activeIdx].pendingMarkdown = isLarge ? fileContent : undefined;
      if (!isLarge) setEditorContent(htmlContent);
    } else {
      const newTabId = createNewTab(filePath, htmlContent, fileName);
      if (!newTabId) return false;
      const newTab = tabs.value.find(t => t.id === newTabId);
      if (newTab) {
        newTab.originalMarkdown = fileContent;
        setDocumentMarkdown(newTab, fileContent);
        newTab.largeFile = isLarge || undefined;
        newTab.pendingMarkdown = isLarge ? fileContent : undefined;
      }
      await switchToTab(newTabId);
    }

    if (isLarge) onLargeFileOpened?.(filePath, fileContent);
    onFileOpened?.(filePath, fileContent);
    return true;
  };

  const openFile = async (): Promise<void> => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: t.value.markdownFiles, extensions: ['md', 'markdown'] },
          { name: t.value.allFiles, extensions: ['*'] },
        ],
      });

      if (selected) {
        await loadFileIntoTab(selected as string);
      }
    } catch (error) {
      console.error('Error opening file:', error);
    }
  };

  const openFileFromPath = async (filePath: string): Promise<boolean> => {
    try {
      return await loadFileIntoTab(filePath);
    } catch (error) {
      console.error('Error opening file from path:', error);
      return false;
    }
  };

  // Returns disk content if a conflict is detected, null otherwise.
  const checkPreSaveConflict = async (filePath: string, originalMarkdown: string | null): Promise<string | null> => {
    if (!originalMarkdown || !onPreSaveConflict) return null;
    try {
      const currentDiskContent = await readTextFile(filePath);
      // Normalize line endings for comparison
      const normalizedDisk = currentDiskContent.replace(/\r\n/g, '\n');
      const normalizedOriginal = originalMarkdown.replace(/\r\n/g, '\n');
      return normalizedDisk !== normalizedOriginal ? currentDiskContent : null;
    } catch {
      return null; // File might not exist yet (new file)
    }
  };

  const atomicWriteFile = async (filePath: string, content: string): Promise<void> => {
    try {
      markSaveStart?.(filePath);
      await atomicWriteTextFile(filePath, content);
    } finally {
      // Release the watcher guard whether or not the write landed, otherwise a
      // failed save leaves the file looking permanently mid-write.
      markSaveEnd?.(filePath, content);
    }
  };

  const prepareSave = (tab: Tab, sourceOverride?: string | null) => {
    let source = sourceOverride;
    if (source === undefined) {
      source = getSaveMarkdown
        ? getSaveMarkdown()
        : (getMarkdownOverride?.() ?? htmlToMarkdown(getEditorHtml()));
    }
    if (source === null) {
      console.error('[save] no editor could supply content for', tab.fileName);
      onSaveFailed?.(tab);
      return null;
    }

    let markdown = source.trimEnd();

    // Preserve original line endings if we have the original content
    if (tab.originalMarkdown) {
      const originalLineEnding = detectLineEnding(tab.originalMarkdown);
      markdown = applyLineEnding(markdown, originalLineEnding);
    }
    return { state: captureSaveState(tab, markdown), markdown: markdown.trimEnd() };
  };

  const writeAndUpdateTab = async (filePath: string, prepared: { state: SaveState; markdown: string }): Promise<boolean> => {
    let { state } = prepared;
    const { tab } = state;
    let { markdown } = prepared;

    // Pre-save conflict check
    if (onPreSaveConflict) {
      const diskContent = await checkPreSaveConflict(filePath, tab.originalMarkdown);
      if (diskContent !== null) {
        const decision = await onPreSaveConflict(filePath, diskContent, markdown);
        if (decision === 'cancel') return false;
        if (tab.filePath !== state.filePath) return false;
        // If user applied a manual merge, use the merged content instead.
        // The merged source becomes the snapshot actually written to disk.
        if (decision !== 'save') {
          markdown = decision;
          state = captureSaveState(tab, markdown);
        }
      }
    }

    auditShrink('manual-save', filePath, markdown, tab.originalMarkdown);

    await atomicWriteFile(filePath, markdown);

    const saved = completeSave(state, filePath, markdown);

    // Tell host to start watching this path (no-op if already watched).
    onAfterSave?.(filePath, markdown);
    return saved;
  };

  const saveFile = async (target?: DocumentSaveTarget): Promise<boolean> => {
    try {
      const tab = target?.tab ?? tabs.value.find(t => t.id === activeTabId.value);
      if (!tab) return false;
      if (target?.markdown === null) {
        onSaveFailed?.(tab);
        return false;
      }
      let filePath = tab.filePath;

      // Skip save if file exists and has no changes
      if (filePath && !tab.hasChanges) {
        return true;
      }
      const prepared = prepareSave(tab, target?.markdown);
      if (!prepared) return false;

      if (!filePath) {
        filePath = await save({
          filters: [{ name: 'Markdown', extensions: ['md'] }],
          defaultPath: 'dokument.md',
        });
      }

      if (filePath) {
        return await writeAndUpdateTab(filePath, prepared);
      }
    } catch (error) {
      console.error('Error saving file:', error);
    }
    return false;
  };

  const saveFileAs = async (): Promise<void> => {
    try {
      const tab = tabs.value.find(t => t.id === activeTabId.value);
      if (!tab) return;
      const prepared = prepareSave(tab);
      if (!prepared) return;
      const oldPath = prepared.state.filePath;
      const filePath = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: oldPath?.split(/[/\\]/).pop() || 'dokument.md',
      });

      if (filePath) {
        await writeAndUpdateTab(filePath, prepared);
        // Migrate AI metadata (sessions, access map, snapshots) to the new path.
        if (oldPath && oldPath !== filePath) {
          await Promise.all([
            aiCommands.sessionMigrate(oldPath, filePath),
            aiCommands.accessMigrate(oldPath, filePath),
            aiCommands.snapshotMigrate(oldPath, filePath),
          ]).catch(() => {}); // best-effort; don't fail save on AI metadata errors
        }
      }
    } catch (error) {
      console.error('Error saving file:', error);
    }
  };

  const openFileInNewTab = async (relativePath: string): Promise<void> => {
    try {
      // Save current scroll position before navigating
      const editorContainer = document.querySelector(DOM_SELECTORS.EDITOR_CONTAINER);
      if (editorContainer && activeTab.value) {
        const tabIndex = findActiveTabIndex();
        if (tabIndex !== -1) {
          tabs.value[tabIndex].scrollTop = editorContainer.scrollTop;
        }
      }

      isLoadingFile.value = true;

      // Get current file's directory as base
      const baseDir = currentFile.value ? getDirectoryFromPath(currentFile.value) : '';

      // Resolve the relative path
      let fullPath = relativePath;
      if (baseDir && !relativePath.match(/^[a-zA-Z]:/)) {
        fullPath = `${baseDir}/${relativePath}`.replace(/\\/g, '/');
        const parts = fullPath.split('/');
        const normalized: string[] = [];
        for (const part of parts) {
          if (part === '..') {
            normalized.pop();
          } else if (part !== '.' && part !== '') {
            normalized.push(part);
          }
        }
        fullPath = normalized.join('/');
        if (fullPath.match(/^[a-zA-Z]\//)) {
          fullPath = fullPath.replace(/^([a-zA-Z])\//, '$1:/');
        }
      }

      // Check if file is already open
      const existingTab = findTabByFilePath(fullPath);
      if (existingTab) {
        await switchToTab(existingTab.id);
        isLoadingFile.value = false;
        return;
      }

      // Read the file
      const fileContent = await readTextFile(fullPath);
      const isLarge = fileContent.length > LARGE_FILE_CHAR_THRESHOLD;
      const htmlContent = isLarge ? '' : markdownToHtml(fileContent);
      const fileName = extractFileName(fullPath);

      // Create new tab and switch to it
      const newTabId = createNewTab(fullPath, htmlContent, fileName);
      const newTab = tabs.value.find(t => t.id === newTabId);
      if (newTab) {
        newTab.originalMarkdown = fileContent;
        newTab.largeFile = isLarge || undefined;
        newTab.pendingMarkdown = isLarge ? fileContent : undefined;
      }
      await switchToTab(newTabId);
      if (isLarge) onLargeFileOpened?.(fullPath, fileContent);
      onFileOpened?.(fullPath, fileContent);
      isLoadingFile.value = false;
    } catch (error) {
      console.error('Error opening file in new tab:', error);
      isLoadingFile.value = false;
    }
  };

  /**
   * The pane the user is actually looking at. Split view puts several
   * `.editor-container` elements in the document and taking the first in DOM
   * order searched the wrong pane.
   *
   * The fallback covers layouts with no `.editor-pane` ancestor — code+preview
   * replaces the whole SplitContainer. Note that mode's preview pane does not
   * currently bind `@link-click` at all, so clicks there never reach this
   * function; the fallback is for robustness, not for that mode. Same order as
   * usePdfExport and App.vue's scroll helpers.
   */
  const findEditorContainer = (): Element | null =>
    document.querySelector(DOM_SELECTORS.ACTIVE_EDITOR_CONTAINER) ??
    document.querySelector(DOM_SELECTORS.EDITOR_CONTAINER);

  /** Ignore differences that only come from a slugger disagreeing about separators. */
  const looseAnchorKey = (value: string): string =>
    value.toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');

  /**
   * Exact id first, then a tolerant match against heading TEXT.
   *
   * The fallback matters because ids are recomputed from heading text on every
   * open while `[](#anchor)` links are stored verbatim in the file, so anchors
   * written against another renderer — or against MerMark's own older slug
   * rules — would otherwise be dead forever. It also covers headings renamed in
   * WYSIWYG, whose id stays stale until the next save.
   *
   * Two deliberate restrictions keep it from guessing:
   *
   * Heading *ids* are not compared loosely. Doing so let an unrelated heading
   * that merely happens to carry a stale double-hyphen id win on DOM order over
   * the heading the link actually names, silently scrolling to the wrong
   * section. Text is the thing the author wrote the anchor against, so text is
   * what gets matched.
   *
   * An ambiguous match resolves to nothing. If two headings both normalise to
   * the target, picking the first is a coin flip; reporting it as unresolved is
   * honest and the user sees a toast rather than a plausible wrong jump.
   */
  const findAnchorTarget = (container: Element, targetId: string): HTMLElement | null => {
    const exact = Array.from(container.querySelectorAll<HTMLElement>('[id]'))
      .find((el) => el.id === targetId);
    if (exact) return exact;

    const wanted = looseAnchorKey(targetId);
    if (!wanted) return null;

    const matches = Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
      .filter((heading) => looseAnchorKey(generateSlug(heading.textContent ?? '')) === wanted);

    return matches.length === 1 ? matches[0] : null;
  };

  const handleLinkClick = (href: string): void => {
    // Anchor link (internal navigation)
    if (href.startsWith('#')) {
      // decodeURIComponent throws on a lone '%' — '#100%-coverage' is a real
      // anchor, and an uncaught throw here would skip the not-found toast and
      // restore exactly the silent no-op this whole change removes.
      const raw = href.slice(1);
      let targetId = raw;
      try {
        targetId = decodeURIComponent(raw);
      } catch {
        targetId = raw;
      }
      const editorContainer = findEditorContainer();
      const targetElement = editorContainer ? findAnchorTarget(editorContainer, targetId) : null;
      if (targetElement && editorContainer) {
        const containerRect = editorContainer.getBoundingClientRect();
        const elementRect = targetElement.getBoundingClientRect();
        const scrollOffset = elementRect.top - containerRect.top + editorContainer.scrollTop - 20;
        editorContainer.scrollTo({ top: scrollOffset, behavior: 'smooth' });
      } else {
        // Used to return silently, which is indistinguishable from a dead app.
        onAnchorNotFound?.(targetId);
      }
      return;
    }

    // Relative markdown link
    if (href.endsWith('.md') || href.endsWith('.markdown')) {
      openFileInNewTab(href);
    } else if (href.startsWith('http://') || href.startsWith('https://') || (href.includes('.') && !href.includes('/'))) {
      // External link
      pendingExternalUrl.value = href.startsWith('http') ? href : `https://${href}`;
      showExternalLinkDialog.value = true;
    } else {
      // Could be a relative link to any file
      openFileInNewTab(href);
    }
  };

  const confirmExternalLink = async (): Promise<void> => {
    if (pendingExternalUrl.value) {
      try {
        await openExternal(pendingExternalUrl.value);
      } catch (error) {
        console.error('Error opening external link:', error);
      }
    }
    showExternalLinkDialog.value = false;
    pendingExternalUrl.value = '';
  };

  const cancelExternalLink = (): void => {
    showExternalLinkDialog.value = false;
    pendingExternalUrl.value = '';
  };

  return {
    currentFile,
    isLoadingFile,
    showExternalLinkDialog,
    pendingExternalUrl,
    openFile,
    openFileFromPath,
    saveFile,
    saveFileAs,
    handleLinkClick,
    confirmExternalLink,
    cancelExternalLink,
    openFileInNewTab,
  };
}
