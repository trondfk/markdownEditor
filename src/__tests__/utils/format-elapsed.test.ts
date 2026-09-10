import { describe, expect, it } from 'vitest';
import { formatElapsed } from '../../utils/format-elapsed';

describe('formatElapsed', () => {
  it('shows seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0 s');
    expect(formatElapsed(12_400)).toBe('12 s');
  });

  it('shows minutes and leftover seconds', () => {
    expect(formatElapsed(72_000)).toBe('1 min 12 s');
  });
});
