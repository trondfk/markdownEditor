/** Horizontal extent of the container a divider is being dragged inside. */
export interface Bounds {
  left: number;
  right: number;
  width: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Fraction of `bounds` taken by the leading pane when the divider sits at
 * `clientX`. A zero-width container (element not laid out yet) collapses to
 * `min` rather than dividing by zero.
 */
export function ratioFromPointer(
  clientX: number,
  bounds: Bounds,
  min: number,
  max: number,
): number {
  if (bounds.width <= 0) return min;
  return clamp((clientX - bounds.left) / bounds.width, min, max);
}

/**
 * Pixel width of a pane docked to `side` of `bounds` when the divider sits at
 * `clientX`. Callers own the `max` policy, since how much room the rest of the
 * layout needs differs per pane.
 */
export function widthFromPointer(
  clientX: number,
  bounds: Bounds,
  side: 'left' | 'right',
  min: number,
  max: number,
): number {
  const raw = side === 'left' ? clientX - bounds.left : bounds.right - clientX;
  return clamp(raw, min, Math.max(min, max));
}
