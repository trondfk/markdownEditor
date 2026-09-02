import { describe, it, expect } from 'vitest';
import { clamp, ratioFromPointer, widthFromPointer } from '../../utils/resize';

const row = { left: 0, right: 1000, width: 1000 };
const offsetRow = { left: 200, right: 1200, width: 1000 };

describe('clamp', () => {
  it('passes through a value inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps below and above', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('ratioFromPointer', () => {
  it('maps the pointer to a fraction of the container', () => {
    expect(ratioFromPointer(250, row, 0.2, 0.8)).toBe(0.25);
  });

  it('accounts for a container that does not start at the viewport edge', () => {
    expect(ratioFromPointer(450, offsetRow, 0.2, 0.8)).toBe(0.25);
  });

  it('clamps to the allowed range at both ends', () => {
    expect(ratioFromPointer(10, row, 0.2, 0.8)).toBe(0.2);
    expect(ratioFromPointer(990, row, 0.2, 0.8)).toBe(0.8);
  });

  it('falls back to the minimum when the container has no width', () => {
    expect(ratioFromPointer(500, { left: 0, right: 0, width: 0 }, 0.2, 0.8)).toBe(0.2);
  });
});

describe('widthFromPointer', () => {
  it('measures a left-docked pane from the container start', () => {
    expect(widthFromPointer(300, row, 'left', 100, 900)).toBe(300);
    expect(widthFromPointer(500, offsetRow, 'left', 100, 900)).toBe(300);
  });

  it('measures a right-docked pane from the container end', () => {
    expect(widthFromPointer(700, row, 'right', 100, 900)).toBe(300);
    expect(widthFromPointer(900, offsetRow, 'right', 100, 900)).toBe(300);
  });

  it('clamps to the min and max width', () => {
    expect(widthFromPointer(10, row, 'left', 100, 900)).toBe(100);
    expect(widthFromPointer(990, row, 'left', 100, 900)).toBe(900);
  });

  it('keeps the minimum when the max would fall below it', () => {
    expect(widthFromPointer(500, row, 'left', 400, 200)).toBe(400);
  });
});
