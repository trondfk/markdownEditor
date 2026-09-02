import type { Ref } from 'vue';
import type { Tab } from './useTabs';
import { htmlToMarkdown } from '../utils/markdown-converter';

export interface UseTabSerializerOptions {
  activeTabId: Readonly<Ref<string>>;
  activePaneId: Readonly<Ref<string>>;
  /**
   * Markdown for the active tab when something other than the WYSIWYG editor
   * owns the text (code view, split editor, large-file mode), else null.
   */
  getActiveMarkdownOverride: () => string | null;
  /** Live HTML from the WYSIWYG editor, or null while it is unmounted. */
  getMountedEditorHtml: () => string | null;
  isMarkdownFirst: (tab: Tab) => boolean;
}

export interface UseTabSerializerReturn {
  getTabMarkdown: (paneId: string, tab: Tab) => string | null;
}

/**
 * The one way to turn a tab into markdown for writing to disk.
 *
 * The editor that owns a document's text changes with the view mode, and the
 * WYSIWYG component is unmounted in three of them. Every write path must go
 * through here and honour a null result by skipping the write — previously each
 * path re-derived the content itself, and the ones that missed a mode wrote an
 * empty document over the user's file.
 */
export function useTabSerializer(options: UseTabSerializerOptions): UseTabSerializerReturn {
  const {
    activeTabId,
    activePaneId,
    getActiveMarkdownOverride,
    getMountedEditorHtml,
    isMarkdownFirst,
  } = options;

  const getTabMarkdown = (paneId: string, tab: Tab): string | null => {
    const isActive = tab.id === activeTabId.value && paneId === activePaneId.value;

    if (isActive) {
      const override = getActiveMarkdownOverride();
      if (override !== null) return override;
    }

    // Markdown-first (large) tabs hold their source in pendingMarkdown; their
    // cached HTML is empty by design.
    if (isMarkdownFirst(tab)) return tab.pendingMarkdown ?? null;

    if (isActive) {
      const html = getMountedEditorHtml();
      // Nothing is mounted to speak for this tab. Callers must skip the write.
      return html === null ? null : htmlToMarkdown(html);
    }

    // Inactive tabs are safe to read from cache: EditorPane pushes every
    // keystroke into tab.content.
    return htmlToMarkdown(tab.content);
  };

  return { getTabMarkdown };
}
