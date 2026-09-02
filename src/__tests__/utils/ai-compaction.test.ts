import { describe, it, expect } from 'vitest';
import {
  COMPACT_MIN_MESSAGES,
  COMPACT_THRESHOLD,
  SUMMARY_MAX_CHARS,
  buildSummaryPrompt,
  clampSummary,
  compactionTurnText,
  lastCompactionIndex,
  messagesSinceCompaction,
  shouldCompact,
} from '../../utils/ai-compaction';
import type { AiMessage } from '../../composables/useAi';

function msg(role: AiMessage['role'], text = 'x'): AiMessage {
  return { role, text, done: true };
}

/** A thread long enough that the min-messages guard never gets in the way. */
function longThread(): AiMessage[] {
  return Array.from({ length: COMPACT_MIN_MESSAGES }, (_, i) =>
    msg(i % 2 === 0 ? 'user' : 'assistant'),
  );
}

describe('lastCompactionIndex', () => {
  it('reports -1 for a thread that has never been compacted', () => {
    expect(lastCompactionIndex([msg('user'), msg('assistant')])).toBe(-1);
  });

  it('finds the newest marker when there are several', () => {
    const msgs = [msg('compaction'), msg('user'), msg('compaction'), msg('assistant')];
    expect(lastCompactionIndex(msgs)).toBe(2);
  });
});

describe('messagesSinceCompaction', () => {
  it('counts the whole thread when nothing has been compacted', () => {
    expect(messagesSinceCompaction([msg('user'), msg('assistant')])).toBe(2);
  });

  it('counts only what came after the marker', () => {
    const msgs = [msg('user'), msg('compaction'), msg('user'), msg('assistant')];
    expect(messagesSinceCompaction(msgs)).toBe(2);
  });
});

describe('shouldCompact', () => {
  it('fires once the window crosses the threshold', () => {
    expect(shouldCompact({ fraction: COMPACT_THRESHOLD, empty: false, messages: longThread() })).toBe(true);
  });

  it('leaves a window with room to spare alone', () => {
    expect(shouldCompact({ fraction: COMPACT_THRESHOLD - 0.01, empty: false, messages: longThread() })).toBe(false);
  });

  it('does nothing before any usage has been reported', () => {
    expect(shouldCompact({ fraction: 1, empty: true, messages: longThread() })).toBe(false);
  });

  it('waits for new turns rather than re-compacting a thread that is still full', () => {
    // One oversized turn can keep the window full on its own; without this
    // guard every subsequent send would summarise nothing new.
    const justCompacted = [...longThread(), msg('compaction'), msg('user')];
    expect(shouldCompact({ fraction: 1, empty: false, messages: justCompacted })).toBe(false);
  });

  it('compacts again once enough turns have accumulated since the last one', () => {
    const msgs = [msg('compaction'), ...longThread()];
    expect(shouldCompact({ fraction: 1, empty: false, messages: msgs })).toBe(true);
  });
});

describe('buildSummaryPrompt', () => {
  it('tells the model to answer rather than act', () => {
    const prompt = buildSummaryPrompt();
    expect(prompt).toContain('Do not call any tools');
    expect(prompt).toContain('do not edit any file');
  });
});

describe('compactionTurnText', () => {
  it('frames the summary as settled history and carries it verbatim', () => {
    const out = compactionTurnText('Fixed the save path.');
    expect(out).toContain('compacted');
    expect(out).toContain('Fixed the save path.');
  });
});

describe('clampSummary', () => {
  it('passes a normal summary through, trimmed', () => {
    expect(clampSummary('  done  ')).toBe('done');
  });

  it('cuts an oversized summary on a line boundary and marks the cut', () => {
    const line = 'a'.repeat(100) + '\n';
    const out = clampSummary(line.repeat(200));
    expect(out.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 2);
    expect(out.endsWith('…')).toBe(true);
    // Cutting on the boundary means no half-line survives.
    expect(out.split('\n').filter(l => l && l !== '…').every(l => l.length === 100)).toBe(true);
  });

  it('falls back to a hard cut when there is no usable line break', () => {
    const out = clampSummary('b'.repeat(SUMMARY_MAX_CHARS + 500));
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 2);
  });
});
