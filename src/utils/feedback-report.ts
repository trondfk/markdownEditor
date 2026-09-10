// ABOUTME: Builds a privacy-safe diagnostic blob, GitHub issue URL, mailto, and .eml draft.
// ABOUTME: The user reviews and submits; the app never posts with a token.

import { recentErrors } from './error-log';

export const FEEDBACK_GITHUB_REPO = 'trondfk/markdownEditor';

export interface FeedbackContext {
  appVersion: string;
  os: string;
  cli?: string | null;
  model?: string | null;
  lastAiError?: string | null;
  auditTail: Array<{ ts: string; cli: string; action: string; exitCode: number | null }>;
  saveAuditTail: Array<{ ts: string; trigger: string; lostChars: number }>;
  userTitle: string;
  userBody: string;
}

export function buildDiagnosticText(ctx: FeedbackContext): string {
  const lines: string[] = [
    `App version: ${ctx.appVersion}`,
    `OS: ${ctx.os}`,
    `CLI: ${ctx.cli || '(none)'}`,
    `Model: ${ctx.model || '(none)'}`,
    `Last AI error: ${ctx.lastAiError || '(none)'}`,
    '',
    'Recent console errors:',
  ];
  const errs = recentErrors();
  if (errs.length === 0) lines.push('(none)');
  else for (const e of errs.slice(-10)) lines.push(`- ${e.ts} [${e.source}] ${e.message}`);
  lines.push('', 'AI audit (action/cli only):');
  if (ctx.auditTail.length === 0) lines.push('(none)');
  else for (const a of ctx.auditTail.slice(-20)) {
    lines.push(`- ${a.ts} ${a.cli} ${a.action} exit=${a.exitCode ?? 'n/a'}`);
  }
  lines.push('', 'Save shrink audit:');
  if (ctx.saveAuditTail.length === 0) lines.push('(none)');
  else for (const s of ctx.saveAuditTail.slice(-10)) {
    lines.push(`- ${s.ts} ${s.trigger} lost=${s.lostChars}`);
  }
  return lines.join('\n');
}

export function buildIssueBody(
  ctx: FeedbackContext,
  diagnostics: string | null,
  screenshotCount = 0,
): string {
  const parts = [
    '## What happened',
    ctx.userBody.trim() || '(not filled in)',
    '',
  ];
  if (diagnostics) {
    parts.push(
      '## Diagnostics',
      '',
      'If this box is empty, paste the copied report below.',
      '',
      '```',
      diagnostics.slice(0, 3500),
      '```',
      '',
    );
  }
  if (screenshotCount > 0) {
    parts.push(
      '## Screenshots',
      `${screenshotCount} screenshot(s) were saved next to this report.`,
      'Drag them onto the issue from the folder that opened.',
      '',
    );
  }
  parts.push('_Submitted from MerMark. Review before posting._');
  return parts.join('\n');
}

export function buildGitHubIssueUrl(title: string, body: string): string {
  const t = title.trim() || 'Bug report from MerMark';
  const params = new URLSearchParams({ title: t, body });
  return `https://github.com/${FEEDBACK_GITHUB_REPO}/issues/new?${params.toString()}`;
}

/** Empty To lets the mail client prompt. Set this if the team has a shared inbox. */
export const FEEDBACK_EMAIL = '';

/** mailto: cannot carry attachments; keep the body short and rely on the clipboard. */
const MAILTO_BODY_MAX = 1800;

export function buildMailtoUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({
    subject: subject.trim() || 'Bug report from MerMark',
    body: body.slice(0, MAILTO_BODY_MAX),
  });
  return `mailto:${to}?${params.toString()}`;
}

export interface EmlAttachment {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

/** RFC 2047 encoded-word so Outlook keeps æ/ø/å in the subject. */
export function encodeRfc2047(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const bytes = new TextEncoder().encode(text);
  return `=?UTF-8?B?${bytesToBase64(bytes)}?=`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function wrapBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

/**
 * Outlook/Thunderbird draft. `X-Unsent: 1` opens it as unsent so the user can
 * still edit To/body. mailto: cannot attach files, so this is the path that
 * carries screenshots.
 */
export function buildEml(opts: {
  to: string;
  subject: string;
  body: string;
  attachments: EmlAttachment[];
}): string {
  const boundary = '=_mermark_feedback_boundary';
  const subject = encodeRfc2047(opts.subject.trim() || 'Bug report from MerMark');
  const parts: string[] = [
    'X-Unsent: 1',
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    opts.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'),
  ];
  for (const att of opts.attachments) {
    const name = att.filename.replace(/[\r\n"]/g, '_');
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mime}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      wrapBase64(bytesToBase64(att.bytes)),
    );
  }
  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}
