import type { Tab } from '../composables/useTabs';
import { toRaw } from 'vue';
import { htmlToMarkdown } from './markdown-converter';

const normalize = (markdown: string): string => markdown.replace(/\r\n/g, '\n').trimEnd();
interface CommittedSave {
  sequence: number;
  filePath: string;
  markdown: string;
}

const documentIds = new WeakMap<Tab, string>();

export function getDocumentId(tab: Tab): string {
  const document = toRaw(tab);
  let id = documentIds.get(document);
  if (!id) { id = crypto.randomUUID(); documentIds.set(document, id); }
  return id;
}

export function setDocumentId(tab: Tab, id: string): void {
  documentIds.set(toRaw(tab), id);
}

const saveOperations = new WeakMap<Tab, {
  lastStarted: number;
  lastPublished: number;
  lastCommitted?: CommittedSave;
}>();

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
  const document = toRaw(tab);
  let operations = saveOperations.get(document);
  if (!operations) {
    operations = { lastStarted: 0, lastPublished: 0 };
    saveOperations.set(document, operations);
  }
  return {
    tab,
    sequence: ++operations.lastStarted,
    revision: tab.editRevision ?? 0,
    markdown: getDocumentMarkdown(tab),
    filePath: tab.filePath,
  };
}

export function captureSaveSnapshot(tab: Tab, source: string) {
  const state = captureSaveState(tab);
  return { ...state, markdown: normalize(source), previousMarkdown: state.markdown, previousContent: tab.content };
}

export function syncSaveSnapshot(state: ReturnType<typeof captureSaveSnapshot>): void {
  if ((state.tab.editRevision ?? 0) === state.revision
      && getDocumentMarkdown(state.tab) === state.previousMarkdown && state.tab.content === state.previousContent) {
    setDocumentMarkdown(state.tab, state.markdown);
  }
}

export type SaveState = ReturnType<typeof captureSaveState>;

export function getLastCommittedSave(state: SaveState): Readonly<CommittedSave> | undefined {
  return saveOperations.get(toRaw(state.tab))?.lastCommitted;
}

export function canCommitSave(state: SaveState): boolean {
  const operations = saveOperations.get(toRaw(state.tab));
  return !!operations
    && state.sequence > operations.lastPublished
    && state.sequence > (operations.lastCommitted?.sequence ?? 0)
    && state.tab.filePath === state.filePath;
}

export function recordSaveCommit(state: SaveState, filePath: string, markdown: string): void {
  const operations = saveOperations.get(toRaw(state.tab));
  if (operations && state.sequence > (operations.lastCommitted?.sequence ?? 0)) {
    operations.lastCommitted = { sequence: state.sequence, filePath, markdown };
  }
}

export function isSaveStateCurrent(state: SaveState): boolean {
  const { tab } = state;
  return getDocumentMarkdown(tab) === state.markdown
    && tab.filePath === state.filePath;
}

/** Record what reached disk without ever restoring the captured editor text. */
export function completeSave(state: SaveState, filePath: string, markdown: string): boolean {
  const { tab } = state;
  const operations = saveOperations.get(toRaw(tab));
  // A later start alone cannot invalidate a write. A successful disk commit can,
  // even before its delayed frontend acknowledgement publishes the baseline.
  if (!operations || state.sequence <= operations.lastPublished
      || state.sequence < (operations.lastCommitted?.sequence ?? 0)) return false;
  // A different save-as or reload may have changed the document's path.
  if (tab.filePath !== state.filePath) {
    return false;
  }
  tab.filePath = filePath;
  tab.fileName = filePath.split(/[/\\]/).pop() || tab.fileName;
  tab.originalMarkdown = markdown;
  recordSaveCommit(state, filePath, markdown);
  operations.lastPublished = state.sequence;
  refreshDirtyState(tab);
  return !tab.hasChanges;
}

export function wasSavePublished(state: SaveState): boolean {
  return saveOperations.get(toRaw(state.tab))?.lastPublished === state.sequence;
}
