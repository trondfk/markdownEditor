import { describe, it, expect } from 'vitest';
import {
  describeShrink,
  SHRINK_MIN_CHARS,
  SHRINK_RATIO_THRESHOLD,
} from '../../utils/save-audit';

const filler = (chars: number) => 'x'.repeat(chars);

describe('describeShrink', () => {
  it('reports a write that drops most of a long document', () => {
    const previous = filler(4000);
    const report = describeShrink(filler(400), previous);

    expect(report).not.toBeNull();
    expect(report!.previousChars).toBe(4000);
    expect(report!.nextChars).toBe(400);
    expect(report!.lostChars).toBe(3600);
    expect(report!.lostFraction).toBeCloseTo(0.9);
  });

  it('stays quiet when the document grew', () => {
    expect(describeShrink(filler(5000), filler(1000))).toBeNull();
  });

  it('stays quiet when the document is unchanged in length', () => {
    expect(describeShrink(filler(1000), filler(1000))).toBeNull();
  });

  it('stays quiet for an ordinary edit that trims a little', () => {
    // 5% off a long document is editing, not loss.
    expect(describeShrink(filler(9500), filler(10000))).toBeNull();
  });

  // Emptying a short note is a normal thing to do, and flagging it would bury
  // the real signal under noise.
  it('stays quiet when a large fraction of a tiny note disappears', () => {
    expect(describeShrink('', '# A short note')).toBeNull();
  });

  it('needs both the ratio and the character count to trip', () => {
    // Big absolute loss, small fraction: a legitimate cut from a huge file.
    expect(describeShrink(filler(100_000 - SHRINK_MIN_CHARS * 2), filler(100_000))).toBeNull();

    // Big fraction, small absolute loss: a small note being rewritten.
    expect(describeShrink(filler(10), filler(SHRINK_MIN_CHARS - 1))).toBeNull();
  });

  it('reports right at the threshold', () => {
    const previous = filler(1000);
    const lost = Math.ceil(1000 * SHRINK_RATIO_THRESHOLD);
    const report = describeShrink(filler(1000 - lost), previous);

    // 1000 chars at a 0.35 ratio loses 350, which clears SHRINK_MIN_CHARS too.
    expect(report).not.toBeNull();
    expect(report!.lostChars).toBe(lost);
  });

  it('has nothing to compare against on a brand new document', () => {
    expect(describeShrink('', null)).toBeNull();
    expect(describeShrink('', undefined)).toBeNull();
    expect(describeShrink(filler(10), '')).toBeNull();
  });

  // Rewriting a CRLF file as LF drops a character per line without losing any
  // text, and that must not look like a shrinking document.
  it('ignores a pure line-ending conversion', () => {
    const crlf = `${'line\r\n'.repeat(2000)}`;
    const lf = crlf.replace(/\r\n/g, '\n');

    expect(describeShrink(lf, crlf)).toBeNull();
  });
});
