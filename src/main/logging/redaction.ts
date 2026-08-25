const REDACTED = '[redacted]';
const REDACTED_EMAIL = '[redacted-email]';

const sensitiveKey = /(?:authorization|cookie|credential|password|secret|token|subject|body|content|address|recipient|sender|headers?|messageId)/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const tokenAssignmentPattern = /\b(?:access_token|refresh_token|password|secret)=([^\s&]+)/gi;

const redactString = (value: string): string =>
  value
    .replace(emailPattern, REDACTED_EMAIL)
    .replace(bearerPattern, `Bearer ${REDACTED}`)
    .replace(tokenAssignmentPattern, (match) => `${match.slice(0, match.indexOf('=') + 1)}${REDACTED}`);

export const redactDiagnosticValue = (
  value: unknown,
  key = '',
  seen = new WeakSet<object>(),
): unknown => {
  if (sensitiveKey.test(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item, '', seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactDiagnosticValue(entryValue, entryKey, seen),
    ]),
  );
};

export interface SafeDiagnosticEvent {
  readonly category: string;
  readonly detail: unknown;
  readonly occurredAt: string;
}

export const createSafeDiagnosticEvent = (
  category: string,
  detail: unknown,
  occurredAt = new Date().toISOString(),
): SafeDiagnosticEvent => ({
  category: redactString(category),
  detail: redactDiagnosticValue(detail),
  occurredAt,
});
