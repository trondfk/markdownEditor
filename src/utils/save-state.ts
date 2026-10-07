import type { Tab } from '../composables/useTabs';
import { htmlToMarkdown } from './markdown-converter';

const normalize = (markdown: string): string => markdown.replace(/\r\n/g, '\n').trimEnd();

export function getDocumentMarkdown(tab: Tab): string {
  return tab.markdown ?? normalize(tab.originalMarkdown ?? tab.pendingMarkdown ?? htmlToMarkdown(tab.content));
}

export function refreshDirtyState(tab: Tab): void {
  tab.hasChanges = getDocumentMarkdown(tab) !== normalize(tab.originalMarkdown ?? '');
}

/** Only authoritative source changes advance the revision; status events do not. */
export function setDocumentMarkdown(tab: Tab, markdown: string): void {
  const source = normalize(markdown);
  if (source !== getDocumentMarkdown(tab)) tab.editRevision = (tab.editRevision ?? 0) + 1;
  tab.markdown = source;
  refreshDirtyState(tab);
}

/** Keep the document object, not its position in the currently focused pane. */
export function captureSaveState(tab: Tab, markdown?: string) {
  if (markdown !== undefined) setDocumentMarkdown(tab, markdown);
  return {
    tab,
    revision: tab.editRevision ?? 0,
    markdown: getDocumentMarkdown(tab),
    filePath: tab.filePath,
  };
}

export type SaveState = ReturnType<typeof captureSaveState>;

export function isSaveStateCurrent(state: SaveState): boolean {
  const { tab } = state;
  return getDocumentMarkdown(tab) === state.markdown
    && tab.filePath === state.filePath;
}

/** Record what reached disk without ever restoring the captured editor text. */
export function completeSave(state: SaveState, filePath: string, markdown: string): boolean {
  const { tab } = state;
  // A different save-as or reload may have changed the document's path.
  if (tab.filePath !== state.filePath) {
    return false;
  }
  tab.filePath = filePath;
  tab.fileName = filePath.split(/[/\\]/).pop() || tab.fileName;
  tab.originalMarkdown = markdown;
  refreshDirtyState(tab);
  return !tab.hasChanges;
}
