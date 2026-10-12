import type { Ref } from 'vue';
import type { Tab } from './useTabs';
import { htmlToMarkdown } from '../utils/markdown-converter';
import { getDocumentSource } from '../utils/save-state';

export interface UseTabSerializerOptions {
  activeTabId: Readonly<Ref<string>>;
  activePaneId: Readonly<Ref<string>>;
  getEditorSource: (paneId: string) => EditorSaveSource | null;
  isMarkdownFirst: (tab: Tab) => boolean;
}

export type EditorSaveSource = { tabId: string; html: string } | { tabId: string; markdown: string };

export interface UseTabSerializerReturn {
  getTabMarkdown: (paneId: string, tab: Tab) => string | null;
}

/** Resolve authoritative document text before consulting a view's cache.
 *  Live fallbacks identify the document actually loaded by the editor.
 *  Callers must treat null as unavailable, never as an empty document. */
export function useTabSerializer(options: UseTabSerializerOptions): UseTabSerializerReturn {
  const {
    activeTabId,
    activePaneId,
    getEditorSource,
    isMarkdownFirst,
  } = options;

  const getTabMarkdown = (paneId: string, tab: Tab): string | null => {
    if (tab.markdown !== undefined) return getDocumentSource(tab);
    const isActive = tab.id === activeTabId.value && paneId === activePaneId.value;
    if (isActive) {
      const source = getEditorSource(paneId);
      if (source) {
        if (source.tabId !== tab.id) return null;
        return 'markdown' in source ? source.markdown : htmlToMarkdown(source.html);
      }
      return isMarkdownFirst(tab) ? tab.pendingMarkdown ?? null : null;
    }

    if (isMarkdownFirst(tab)) return tab.pendingMarkdown ?? null;

    // Inactive tabs are safe to read from cache: EditorPane pushes every
    // keystroke into tab.content.
    return htmlToMarkdown(tab.content);
  };

  return { getTabMarkdown };
}
