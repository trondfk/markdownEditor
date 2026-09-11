// ABOUTME: Word-style left-margin line selection for the visual editor.
// ABOUTME: Click left of the text to select the visual line at that height.

export interface Coords {
  top: number;
  bottom: number;
}

export interface EditorViewLike {
  posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null;
  coordsAtPos: (pos: number) => Coords;
  state: { doc: { content: { size: number } } };
}

const ROW_SLOP_PX = 2;

/** True when the pointer is in the page/gutter strip left of the ProseMirror box. */
export function isLeftMarginClick(clientX: number, contentLeft: number): boolean {
  return clientX < contentLeft;
}

function coordsOrNull(view: EditorViewLike, pos: number): Coords | null {
  try {
    return view.coordsAtPos(pos);
  } catch {
    return null;
  }
}

function sameVisualRow(a: Coords, b: Coords): boolean {
  return Math.abs(a.top - b.top) <= ROW_SLOP_PX;
}

/**
 * Document range covering the visual line under `y`. `hitLeft` should be just
 * inside the text box so posAtCoords lands on that line, not the margin.
 */
export function visualLineRange(
  view: EditorViewLike,
  y: number,
  hitLeft: number,
): { from: number; to: number } | null {
  const hit = view.posAtCoords({ left: hitLeft, top: y });
  if (!hit) return null;
  const start = coordsOrNull(view, hit.pos);
  if (!start) return { from: hit.pos, to: hit.pos };

  const size = view.state.doc.content.size;
  let from = hit.pos;
  while (from > 0) {
    const prev = coordsOrNull(view, from - 1);
    if (!prev || !sameVisualRow(start, prev)) break;
    from -= 1;
  }
  let to = hit.pos;
  while (to < size) {
    const next = coordsOrNull(view, to + 1);
    if (!next || !sameVisualRow(start, next)) break;
    to += 1;
  }
  if (to < from) return { from: hit.pos, to: hit.pos };
  return { from, to };
}
