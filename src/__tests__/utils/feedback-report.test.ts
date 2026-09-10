import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticText,
  buildEml,
  buildGitHubIssueUrl,
  buildIssueBody,
  buildMailtoUrl,
  encodeRfc2047,
} from '../../utils/feedback-report';

describe('feedback-report', () => {
  it('omits chat and only lists audit action metadata', () => {
    const text = buildDiagnosticText({
      appVersion: '1.0.3',
      os: 'win32',
      cli: 'codex',
      model: 'gpt-5.5',
      lastAiError: 'Cancelled',
      auditTail: [{ ts: '2026-01-01', cli: 'codex', action: 'send', exitCode: 0 }],
      saveAuditTail: [],
      userTitle: 'hang',
      userBody: 'spinner forever',
    });
    expect(text).toContain('Cancelled');
    expect(text).toContain('codex send');
    expect(text).not.toContain('prompt');
  });

  it('builds a github new-issue url', () => {
    const url = buildGitHubIssueUrl('Hang', 'details');
    expect(url).toContain('https://github.com/trondfk/markdownEditor/issues/new');
    expect(url).toContain('Hang');
  });

  it('keeps the issue body short enough to put in a URL', () => {
    const body = buildIssueBody({
      appVersion: '1',
      os: 'win32',
      auditTail: [],
      saveAuditTail: [],
      userTitle: 't',
      userBody: 'stuck',
    }, 'diag');
    expect(body).toContain('stuck');
    expect(body).toContain('diag');
  });

  it('mentions screenshots in the issue body when attached', () => {
    const body = buildIssueBody({
      appVersion: '1',
      os: 'win32',
      auditTail: [],
      saveAuditTail: [],
      userTitle: 't',
      userBody: 'broken',
    }, null, 2);
    expect(body).toContain('2 screenshot');
    expect(body).toContain('Drag them');
  });

  it('builds a mailto url without posting', () => {
    const url = buildMailtoUrl('', 'Hang', 'details');
    expect(url.startsWith('mailto:')).toBe(true);
    expect(url).toContain('Hang');
    expect(url).toContain('details');
  });

  it('encodes non-ascii subjects for eml', () => {
    expect(encodeRfc2047('Hang')).toBe('Hang');
    expect(encodeRfc2047('Feil i nynorsk: æøå')).toMatch(/^=\?UTF-8\?B\?/);
  });

  it('builds an unsent eml with attachments', () => {
    const eml = buildEml({
      to: 'dev@example.com',
      subject: 'Hang',
      body: 'stuck',
      attachments: [{
        filename: 'shot.png',
        mime: 'image/png',
        bytes: new Uint8Array([1, 2, 3]),
      }],
    });
    expect(eml).toContain('X-Unsent: 1');
    expect(eml).toContain('To: dev@example.com');
    expect(eml).toContain('filename="shot.png"');
    expect(eml).toContain('stuck');
  });
});
