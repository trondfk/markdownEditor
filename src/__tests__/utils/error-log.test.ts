import { describe, expect, it } from 'vitest';
import { recentErrors, recordError } from '../../utils/error-log';

describe('error-log', () => {
  it('keeps a ring of recent errors', () => {
    recordError('test', 'boom');
    const rows = recentErrors();
    expect(rows[rows.length - 1].message).toBe('boom');
    expect(rows[rows.length - 1].source).toBe('test');
  });
});
