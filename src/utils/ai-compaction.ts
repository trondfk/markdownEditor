/**
 * Conversation compaction: replacing the earlier part of a chat with a summary
 * so a long session survives the model's context window instead of dead-ending
 * in "start a new chat".
 *
 * Everything here is pure so the thresholds and prompt wording can be tested
 * without a provider. Orchestration lives in the AI panel, thread mutation in
 * useAi.
 */
import type { AiMessage } from '../composables/useAi';

/**
 * Fraction of the context window at which we compact. Deliberately above the
 * amber warning (0.8) and below the red one (0.95): late enough that short
 * chats never pay for a summarization round-trip, early enough that the
 * summarizing turn itself still fits.
 */
export const COMPACT_THRESHOLD = 0.85;

/**
 * Turns that must accumulate after a compaction before the next one may fire.
 * Without this, a single oversized turn (a large attached document, say) that
 * keeps the window full on its own would compact on every send and grind the
 * chat to a halt while summarizing nothing new.
 */
export const COMPACT_MIN_MESSAGES = 4;

/** Summaries longer than this are truncated before they enter the thread. */
export const SUMMARY_MAX_CHARS = 8000;

/** Index of the newest compaction marker, or -1 when the thread has none. */
export function lastCompactionIndex(messages: AiMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'compaction') return i;
  }
  return -1;
}

/** Messages added since the newest compaction, or the whole thread if none. */
export function messagesSinceCompaction(messages: AiMessage[]): number {
  return messages.length - 1 - lastCompactionIndex(messages);
}

export interface CompactionCheck {
  /** Share of the context window consumed by the turn that just finished. */
  fraction: number;
  /** True when no usage has been reported yet, so there is nothing to judge. */
  empty: boolean;
  messages: AiMessage[];
}

export function shouldCompact(check: CompactionCheck): boolean {
  if (check.empty) return false;
  if (messagesSinceCompaction(check.messages) < COMPACT_MIN_MESSAGES) return false;
  return check.fraction >= COMPACT_THRESHOLD;
}

/**
 * The instruction sent to the model to produce the summary. Asks for the
 * things a successor turn actually needs and warns off the things that cannot
 * be reconstructed once the raw turns are gone.
 */
export function buildSummaryPrompt(): string {
  return [
    'Summarise this conversation so the summary can replace the full history without losing anything a later turn needs.',
    '',
    'Use compact Markdown under these headings, skipping any that do not apply:',
    '- Goal: what the user is trying to achieve, in their own words.',
    '- Decisions: what was settled and why, including options that were rejected.',
    '- Files: paths read or changed, and what changed in each.',
    '- State: what is finished, what is verified, what is still broken.',
    '- Next: the immediate next step.',
    '',
    'Keep exact paths, identifiers, commands, numbers and quoted user wording, since those cannot be recovered once the raw turns are gone. Drop greetings, restatements and tool chatter.',
    'Do not call any tools and do not edit any file. Reply with the summary and nothing else.',
  ].join('\n');
}

/**
 * How the summary is reintroduced to the model on later turns: as a user turn
 * for the local providers replaying history, and as turn context for the CLIs
 * once their session has been reset.
 */
export function compactionTurnText(summary: string): string {
  return [
    'Summary of the earlier part of this conversation, which was compacted to free context. Treat it as established fact and carry on from it rather than repeating work it describes.',
    '',
    summary,
  ].join('\n');
}

/** Trim a model-produced summary to the storage cap, on a line boundary. */
export function clampSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= SUMMARY_MAX_CHARS) return trimmed;
  const cut = trimmed.slice(0, SUMMARY_MAX_CHARS);
  const lastBreak = cut.lastIndexOf('\n');
  return (lastBreak > SUMMARY_MAX_CHARS / 2 ? cut.slice(0, lastBreak) : cut).trimEnd() + '\n…';
}
