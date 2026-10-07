import { beforeEach, describe, expect, it } from 'vitest';
import { useSplitView } from '../../composables/useSplitView';
import { createDefaultSplitViewState } from '../../types/pane';
import { captureSaveState, completeSave } from '../../utils/save-state';

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
});
