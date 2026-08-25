import { describe, expect, it } from 'vitest';
import { createSafeDiagnosticEvent, redactDiagnosticValue } from '../../src/main/logging/redaction';

describe('diagnostic redaction', () => {
  it('removes secret- and message-shaped values recursively', () => {
    const canaries = [
      'mail-canary@example.test',
      'subject-canary-72b6',
      'body-canary-9db3',
      'token-canary-a11f',
      'password-canary-b208',
    ];
    const redacted = redactDiagnosticValue({
      account: canaries[0],
      subject: canaries[1],
      nested: {
        bodyText: canaries[2],
        authorization: `Bearer ${canaries[3]}`,
        password: canaries[4],
      },
      ordinary: 'connection refused for mail-canary@example.test',
    });
    const serialized = JSON.stringify(redacted);

    for (const canary of canaries) expect(serialized).not.toContain(canary);
    expect(serialized).toContain('[redacted-email]');
    expect(serialized).toContain('connection refused');
  });

  it('preserves safe operational categories and error names', () => {
    const event = createSafeDiagnosticEvent(
      'provider.connection.failed',
      new Error('Authentication failed for owner@example.test'),
      '2026-08-24T12:00:00.000Z',
    );
    expect(event).toEqual({
      category: 'provider.connection.failed',
      detail: {
        name: 'Error',
        message: 'Authentication failed for [redacted-email]',
      },
      occurredAt: '2026-08-24T12:00:00.000Z',
    });
  });

  it('handles circular data without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(redactDiagnosticValue(circular)).toEqual({ self: '[circular]' });
  });
});
