/**
 * Guards for the save paths that run without the user asking for that exact
 * write: the auto-save timer, save-on-quit and tab-transfer-to-another-window.
 *
 * Those paths serialize whichever editor is mounted, so a serialization miss
 * shows up as an empty string rather than an error. Writing it would silently
 * destroy the document, so treat "became empty" as a bug and skip the write.
 *
 * Explicit Ctrl+S is deliberately exempt: clearing a file by hand is a real
 * edit, and the user is watching when it happens.
 */
export function wouldTruncateDocument(
  next: string,
  previous: string | null | undefined,
): boolean {
  if (next.trim() !== '') return false;
  return typeof previous === 'string' && previous.trim() !== '';
}
