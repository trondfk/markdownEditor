// ABOUTME: In-memory ring buffer of recent console/window errors.
// ABOUTME: Feeds the in-app bug report without sending anything off the machine.

const MAX_ERRORS = 30;

export interface CapturedError {
  ts: string;
  source: string;
  message: string;
}

const errors: CapturedError[] = [];

export function recordError(source: string, message: string) {
  const msg = (message || '').slice(0, 500);
  if (!msg) return;
  errors.push({ ts: new Date().toISOString(), source, message: msg });
  if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
}

export function recentErrors(): CapturedError[] {
  return [...errors];
}

export function installErrorLog() {
  const prev = window.onerror;
  window.onerror = (message, _src, _line, _col, err) => {
    recordError('window.onerror', err?.message || String(message));
    if (typeof prev === 'function') prev(message, _src, _line, _col, err);
    return false;
  };
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    recordError('unhandledrejection', msg);
  });
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    try {
      recordError('console.error', args.map(a => (a instanceof Error ? a.message : String(a))).join(' '));
    } catch {
      // never let logging crash the app
    }
    orig.apply(console, args);
  };
}
