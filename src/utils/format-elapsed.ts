// ABOUTME: Formats a running AI turn duration for the working indicator.
// ABOUTME: Keeps "AI is working" honest about elapsed time instead of a static spinner.

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${totalSec} s`;
  return `${min} min ${sec} s`;
}
