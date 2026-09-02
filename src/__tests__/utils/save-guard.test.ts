import { describe, it, expect } from 'vitest';
import { wouldTruncateDocument } from '../../utils/save-guard';

describe('wouldTruncateDocument', () => {
  it('flags emptying a document that had content', () => {
    expect(wouldTruncateDocument('', '# Title\n\nBody')).toBe(true);
  });

  it('flags whitespace-only output over real content', () => {
    expect(wouldTruncateDocument('\n  \n', '# Title')).toBe(true);
  });

  it('allows a normal write', () => {
    expect(wouldTruncateDocument('# Title', '# Old title')).toBe(false);
  });

  it('allows writing empty over an already-empty document', () => {
    expect(wouldTruncateDocument('', '')).toBe(false);
    expect(wouldTruncateDocument('', '   \n')).toBe(false);
  });

  it('allows the first write of a document with no known previous content', () => {
    expect(wouldTruncateDocument('', null)).toBe(false);
    expect(wouldTruncateDocument('', undefined)).toBe(false);
  });
});
