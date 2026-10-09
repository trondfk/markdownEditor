import { beforeEach, describe, expect, it } from 'vitest';
import { reactive, toRaw } from 'vue';
import { useSplitView } from '../../composables/useSplitView';
import { createDefaultSplitViewState } from '../../types/pane';
import { canCommitSave, captureSaveState, completeSave, getLastCommittedSave, recordSaveCommit, setDocumentMarkdown } from '../../utils/save-state';

describe('document save state', () => {
  beforeEach(() => {
    useSplitView().splitState.value = createDefaultSplitViewState();
  });

  const openA = () => {
    const split = useSplitView();
    const tab = split.splitState.value.panes[0].tabs[0];
    tab.filePath = '/a.md';
    tab.content = '<p>A</p>';
    tab.originalMarkdown = 'A';
    return { split, tab };
  };

  it('keeps undo to the originally opened text dirty after saving a different version', () => {
    const { split, tab } = openA();
    split.updateTabContent('left', tab.id, '<p>B</p>');
    completeSave(captureSaveState(tab, 'B'), '/a.md', 'B');
    expect(tab.hasChanges).toBe(false);

    split.updateTabContent('left', tab.id, '<p>A</p>');
    split.updateTabChanges('left', tab.id, false);
    expect(tab.hasChanges).toBe(true);
    expect(split.getAllUnsavedTabs().map(entry => entry.tab.id)).toContain(tab.id);
    completeSave(captureSaveState(tab, 'A'), '/a.md', 'A');
    expect(tab.hasChanges).toBe(false);
    expect(tab.originalMarkdown).toBe('A');
  });

  it('does not advance revisions for repeated or delayed dirty-status notifications', () => {
    const { split, tab } = openA();
    split.updateTabContent('left', tab.id, '<p>B</p>');
    const state = captureSaveState(tab, 'B');
    const revision = tab.editRevision;
    split.updateTabChanges('left', tab.id, true);
    split.updateTabChanges('left', tab.id, true);
    expect(tab.editRevision).toBe(revision);
    expect(completeSave(state, '/a.md', 'B')).toBe(true);
    expect(tab.hasChanges).toBe(false);
    split.updateTabChanges('left', tab.id, true);
    expect(tab.hasChanges).toBe(false);
  });

  it('ignores publication of a delayed lazy cache containing the already-written source', () => {
    const { tab } = openA();
    tab.content = '';
    tab.largeFile = true;
    tab.pendingMarkdown = 'A';
    Object.assign(tab, { markdown: 'B', editRevision: 1, hasChanges: true });
    const state = captureSaveState(tab, 'B');
    tab.pendingMarkdown = 'B';
    expect(completeSave(state, '/a.md', 'B')).toBe(true);
    expect(tab.hasChanges).toBe(false);
  });

  it('leaves a newer successfully saved Save As untouched when an older save completes', () => {
    const { split, tab } = openA();
    const older = captureSaveState(tab, 'A');
    split.updateTabContent('left', tab.id, '<p>B</p>');
    completeSave(captureSaveState(tab, 'B'), '/b.md', 'B');
    expect(tab.hasChanges).toBe(false);
    const newer = { ...tab };
    expect(completeSave(older, '/a.md', 'A')).toBe(false);
    expect({ ...tab }).toEqual(newer);
  });

  it.each(['A', 'B'])('rejects an older completion after a newer same-path save while the editor contains %s', currentText => {
    const { tab } = openA();
    const older = captureSaveState(tab, 'A');
    const newer = captureSaveState(tab, 'B');
    expect(completeSave(newer, '/a.md', 'B')).toBe(true);
    setDocumentMarkdown(tab, currentText);
    const current = { ...tab };

    expect.soft(completeSave(older, '/a.md', 'A')).toBe(false);
    expect.soft({ ...tab }).toEqual(current);
    expect.soft(tab.originalMarkdown).toBe('B');
    expect.soft(tab.hasChanges).toBe(currentText !== 'B');
  });

  it('records a successful write as newer even if edits keep that save dirty', () => {
    const { tab } = openA();
    const older = captureSaveState(tab, 'A');
    const newer = captureSaveState(tab, 'B');
    setDocumentMarkdown(tab, 'C');
    expect(completeSave(newer, '/a.md', 'B')).toBe(false);
    expect(tab.originalMarkdown).toBe('B');

    expect(completeSave(older, '/a.md', 'A')).toBe(false);
    expect.soft(tab.originalMarkdown).toBe('B');
    expect(tab.markdown).toBe('C');
    expect(tab.hasChanges).toBe(true);
  });

  it('does not invalidate an older successful write merely because another save started', () => {
    const { tab } = openA();
    const older = captureSaveState(tab, 'A');
    captureSaveState(tab, 'B');

    expect(completeSave(older, '/a.md', 'A')).toBe(false);
    expect(tab.originalMarkdown).toBe('A');
    expect(tab.markdown).toBe('B');
    expect(tab.hasChanges).toBe(true);
  });

  it('shares save ordering between a document and its Vue proxy', () => {
    const { tab } = openA();
    const raw = toRaw(tab);
    const older = captureSaveState(raw, 'A');
    const newer = captureSaveState(reactive(raw), 'B');
    expect(completeSave(newer, '/a.md', 'B')).toBe(true);
    setDocumentMarkdown(raw, 'A');

    expect.soft(completeSave(older, '/a.md', 'A')).toBe(false);
    expect.soft(tab.originalMarkdown).toBe('B');
    expect.soft(tab.hasChanges).toBe(true);
  });

  it('keeps save ordering independent for different document objects with the same tab ID', () => {
    const { tab } = openA();
    const other = reactive({ ...toRaw(tab), filePath: '/other.md' });
    const first = captureSaveState(tab, 'A');
    const second = captureSaveState(other, 'B');

    expect(completeSave(second, '/other.md', 'B')).toBe(true);
    expect(completeSave(first, '/a.md', 'A')).toBe(true);
    expect(tab.originalMarkdown).toBe('A');
    expect(other.originalMarkdown).toBe('B');
  });

  it('rejects older writes and acknowledgements after a newer commit before baseline publication', () => {
    const { tab } = openA();
    const older = captureSaveState(tab, 'A');
    const newer = captureSaveState(tab, 'B');
    recordSaveCommit(newer, '/a.md', 'B');
    expect(tab.originalMarkdown).toBe('A');
    expect(canCommitSave(older)).toBe(false);
    expect(completeSave(older, '/a.md', 'A')).toBe(false);
    expect(tab.originalMarkdown).toBe('A');
    expect(tab.markdown).toBe('B');
    expect(tab.hasChanges).toBe(true);
    expect(completeSave(newer, '/a.md', 'B')).toBe(true);
    expect(tab.originalMarkdown).toBe('B');
  });

  it('allows the older write when a newer operation started but never committed', () => {
    const { tab } = openA();
    const older = captureSaveState(tab, 'A');
    const newer = captureSaveState(tab, 'B');
    expect(canCommitSave(older)).toBe(true);
    recordSaveCommit(older, '/a.md', 'A');
    expect(completeSave(older, '/a.md', 'A')).toBe(false);
    expect(tab.originalMarkdown).toBe('A');
    expect(tab.hasChanges).toBe(true);
    expect(canCommitSave(newer)).toBe(true);
  });

  it('keeps the newest successful commit when an older write to another destination finishes later', () => {
    const { tab } = openA();
    const older = captureSaveState(tab, 'A');
    const newer = captureSaveState(tab, 'B');
    recordSaveCommit(newer, '/b.md', 'B');
    recordSaveCommit(older, '/a.md', 'A');
    expect(getLastCommittedSave(older)).toEqual({ sequence: newer.sequence, filePath: '/b.md', markdown: 'B' });
    expect(canCommitSave(older)).toBe(false);
    expect(completeSave(newer, '/b.md', 'B')).toBe(true);
    expect(completeSave(older, '/a.md', 'A')).toBe(false);
    expect(tab.filePath).toBe('/b.md');
    expect(tab.hasChanges).toBe(false);
  });
});
