import { describe, expect, it } from 'vitest';
import { isLeftMarginClick, visualLineRange, type EditorViewLike } from '../../utils/visual-line-select';

describe('isLeftMarginClick', () => {
  it('is true only left of the content box', () => {
    expect(isLeftMarginClick(40, 80)).toBe(true);
    expect(isLeftMarginClick(80, 80)).toBe(false);
    expect(isLeftMarginClick(120, 80)).toBe(false);
  });
});

describe('visualLineRange', () => {
  function viewForRows(rows: Array<{ from: number; to: number; top: number }>): EditorViewLike {
    const size = Math.max(...rows.map((r) => r.to));
    const posOf = (pos: number) => rows.find((r) => pos >= r.from && pos <= r.to);
    return {
      state: { doc: { content: { size } } },
      posAtCoords: ({ top }) => {
        const row = rows.find((r) => top >= r.top && top < r.top + 20);
        return row ? { pos: row.from } : null;
      },
      coordsAtPos: (pos) => {
        const row = posOf(pos);
        if (!row) throw new Error('bad pos');
        return { top: row.top, bottom: row.top + 20 };
      },
    };
  }

  it('selects the whole visual row under the pointer', () => {
    const view = viewForRows([
      { from: 0, to: 10, top: 0 },
      { from: 11, to: 20, top: 20 },
    ]);
    expect(visualLineRange(view, 8, 90)).toEqual({ from: 0, to: 10 });
    expect(visualLineRange(view, 28, 90)).toEqual({ from: 11, to: 20 });
  });

  it('returns null when the pointer misses every row', () => {
    const view = viewForRows([{ from: 0, to: 5, top: 0 }]);
    expect(visualLineRange(view, 400, 90)).toBeNull();
  });
});
