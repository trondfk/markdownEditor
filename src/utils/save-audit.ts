// ABOUTME: Detects saves that drop a large part of a document and records them to a log file.
// ABOUTME: The truncation guard only stops writes that end up empty; this leaves evidence of partial loss.

import { appDataDir, join } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs';

/** Fraction of the document that has to vanish before a write looks wrong. */
export const SHRINK_RATIO_THRESHOLD = 0.35;

/** Characters that have to vanish as well, so small notes don't trip the ratio. */
export const SHRINK_MIN_CHARS = 200;

const LOG_FILE_NAME = 'save-audit.jsonl';

/** Keeps the log useful to read by hand and bounded on disk. */
const MAX_ENTRIES = 500;

/** Which save path performed the write, so log lines can be told apart. */
export type SaveTrigger = 'auto-save' | 'manual-save' | 'close-save' | 'tab-transfer';

export interface ShrinkReport {
  previousChars: number;
  nextChars: number;
  lostChars: number;
  /** Share of the previous document that disappeared, 0 to 1. */
  lostFraction: number;
}

export interface SaveAuditEntry extends ShrinkReport {
  ts: string;
  trigger: SaveTrigger;
  filePath: string;
}

/**
 * Describes a write that loses a large part of the document, or null when the
 * change is within normal editing range.
 *
 * Both thresholds have to trip. The ratio on its own would flag deleting most
 * of a three-line note, which is an ordinary edit, and the character count on
 * its own would flag a legitimate large cut from a big file.
 *
 * Line endings are normalised first: rewriting a CRLF file as LF drops one
 * character per line without losing any text, and that is not the kind of
 * shrinking we are hunting.
 */
export function describeShrink(
  next: string,
  previous: string | null | undefined,
): ShrinkReport | null {
  if (typeof previous !== 'string' || previous === '') return null;

  const before = previous.replace(/\r\n/g, '\n');
  const after = next.replace(/\r\n/g, '\n');

  const lostChars = before.length - after.length;
  if (lostChars <= 0) return null;

  const lostFraction = lostChars / before.length;
  if (lostChars < SHRINK_MIN_CHARS || lostFraction < SHRINK_RATIO_THRESHOLD) return null;

  return {
    previousChars: before.length,
    nextChars: after.length,
    lostChars,
    lostFraction,
  };
}

/**
 * Appends one line to `<app data>/save-audit.jsonl`.
 *
 * Deliberately never throws and never blocks the save: this is evidence for
 * after the fact, and losing a log line matters far less than refusing to
 * write the user's document. Entries from `manual-save` include deliberate
 * cuts, which is why the trigger is recorded rather than filtered out here.
 */
export async function recordShrink(
  trigger: SaveTrigger,
  filePath: string,
  report: ShrinkReport,
): Promise<void> {
  try {
    const dir = await appDataDir();
    await mkdir(dir, { recursive: true });
    const path = await join(dir, LOG_FILE_NAME);

    let existing = '';
    try {
      existing = await readTextFile(path);
    } catch {
      /* first entry, no log yet */
    }

    const entry: SaveAuditEntry = {
      ts: new Date().toISOString(),
      trigger,
      filePath,
      ...report,
    };

    const lines = existing.split('\n').filter(line => line.trim() !== '');
    lines.push(JSON.stringify(entry));
    await writeTextFile(path, `${lines.slice(-MAX_ENTRIES).join('\n')}\n`);
  } catch (error) {
    console.error('[save-audit] could not record a shrinking save', error);
  }
}

/** Logs the write when it loses a large part of the document. Fire and forget. */
export function auditShrink(
  trigger: SaveTrigger,
  filePath: string,
  next: string,
  previous: string | null | undefined,
): void {
  const report = describeShrink(next, previous);
  if (!report) return;
  console.warn(
    `[save-audit] ${trigger} dropped ${report.lostChars} of ${report.previousChars} characters in ${filePath}`,
  );
  void recordShrink(trigger, filePath, report);
}
