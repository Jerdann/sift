import type { ImapFlow, ImapFlowOptions, MessageStructureObject } from 'imapflow';
import {
  type BridgeCredentials,
  type BridgeDiagnostic,
  type BridgeDiagnosticCategory,
  bridgeCredentialsSchema,
} from '../../shared/contracts/proton';

export interface DiscoveredMailbox {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  flags: string[];
  messageCount: number;
  unreadCount: number;
  uidValidity: string;
  uidNext: number;
}

export type RecipientHeaderSource = 'delivered-to' | 'x-original-to' | 'to' | 'cc' | 'bcc';

export interface RecipientHeaderEvidence {
  address: string;
  source: RecipientHeaderSource;
  seenAt: string | null;
}

export interface ProtonAuditMessage {
  uid: number;
  messageId: string | null;
  receivedAt: string | null;
  subject: string | null;
  senders: string[];
  recipients: string[];
  headers: Record<string, string>;
  flags: string[];
  sizeBytes: number;
  bodyText: string | null;
  bodyTruncated: boolean;
  bodyError: boolean;
}

export interface ProtonAuditBatch {
  uidValidity: string;
  uidNext: number;
  exists: number;
  messages: readonly ProtonAuditMessage[];
}

export interface BridgeClientPort {
  readonly capabilityCount: number;
  connect(): Promise<void>;
  listMailboxCount(): Promise<number>;
  close(): Promise<void>;
}

export interface ProtonReadClientPort extends BridgeClientPort {
  capabilityNames(): readonly string[];
  listMailboxes(): Promise<readonly DiscoveredMailbox[]>;
  sampleRecipientHeaders(mailboxPath: string, limit: number): Promise<readonly RecipientHeaderEvidence[]>;
}

export interface ProtonAuditClientPort extends ProtonReadClientPort {
  fetchAuditBatch(
    mailboxPath: string,
    fromUid: number,
    limit: number,
    extractBodies: boolean,
  ): Promise<ProtonAuditBatch>;
}

export type BridgeClientFactory = (
  credentials: BridgeCredentials,
) => BridgeClientPort | Promise<BridgeClientPort>;

export type ProtonReadClientFactory = (
  credentials: BridgeCredentials,
) => ProtonReadClientPort | Promise<ProtonReadClientPort>;

export type ProtonAuditClientFactory = (
  credentials: BridgeCredentials,
) => ProtonAuditClientPort | Promise<ProtonAuditClientPort>;

export const bridgeOptionsFor = (credentials: BridgeCredentials): ImapFlowOptions => ({
  host: credentials.host,
  port: credentials.port,
  secure: credentials.security === 'tls',
  doSTARTTLS: credentials.security === 'starttls',
  auth: {
    user: credentials.username,
    pass: credentials.password,
  },
  clientInfo: {
    name: 'Sift',
    version: '0.1.0',
    vendor: 'Sift Contributors',
  },
  disableAutoIdle: true,
  logger: false,
  connectionTimeout: 8_000,
  greetingTimeout: 8_000,
  socketTimeout: 15_000,
  maxLineLength: 1_048_576,
  maxLiteralSize: 8_388_608,
  maxResponseSize: 10_485_760,
  tls: {
    rejectUnauthorized: false,
  },
});

const HEADER_NAMES: readonly RecipientHeaderSource[] = [
  'delivered-to',
  'x-original-to',
  'to',
  'cc',
  'bcc',
];

const AUDIT_HEADER_NAMES = [
  ...HEADER_NAMES,
  'list-id',
  'list-unsubscribe',
  'list-unsubscribe-post',
  'authentication-results',
] as const;
const MAX_TEXT_BYTES = 32_768;

const headerValues = (headers: Buffer | undefined): Record<string, string> => {
  if (!headers?.length) return {};
  const unfolded = headers.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  const result: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    if (!AUDIT_HEADER_NAMES.includes(name as (typeof AUDIT_HEADER_NAMES)[number])) continue;
    const value = line.slice(separator + 1).trim().slice(0, 4_096);
    result[name] = result[name] ? `${result[name]}, ${value}` : value;
  }
  return result;
};

const firstPlainTextPart = (root: MessageStructureObject | undefined): MessageStructureObject | null => {
  if (!root) return null;
  if (
    root.type.toLowerCase() === 'text/plain' &&
    root.part &&
    root.disposition?.toLowerCase() !== 'attachment'
  ) return root;
  for (const child of root.childNodes ?? []) {
    const match = firstPlainTextPart(child);
    if (match) return match;
  }
  return null;
};

const decodeTextPart = (value: Buffer, encoding: string | undefined): string => {
  let decoded = value;
  if (encoding?.toLowerCase() === 'base64') {
    decoded = Buffer.from(value.toString('ascii').replace(/\s/g, ''), 'base64');
  } else if (encoding?.toLowerCase() === 'quoted-printable') {
    const text = value.toString('latin1').replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '=' && /^[0-9a-f]{2}$/i.test(text.slice(index + 1, index + 3))) {
        bytes.push(Number.parseInt(text.slice(index + 1, index + 3), 16));
        index += 2;
      } else bytes.push(text.charCodeAt(index) & 0xff);
    }
    decoded = Buffer.from(bytes);
  }
  return decoded.toString('utf8').replace(/\0/g, '').slice(0, MAX_TEXT_BYTES);
};

export const extractRecipientEvidence = (
  headers: Buffer | undefined,
  seenAt: string | null,
): RecipientHeaderEvidence[] => {
  if (!headers?.length) return [];
  const unfolded = headers.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  const evidence: RecipientHeaderEvidence[] = [];
  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const source = line.slice(0, separator).trim().toLowerCase() as RecipientHeaderSource;
    if (!HEADER_NAMES.includes(source)) continue;
    const matches = line
      .slice(separator + 1)
      .match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi);
    for (const address of new Set(matches ?? [])) {
      evidence.push({ address: address.toLowerCase(), source, seenAt });
    }
  }
  return evidence;
};

class ImapFlowBridgeClient implements ProtonReadClientPort {
  readonly #client: ImapFlow;

  constructor(client: ImapFlow) {
    this.#client = client;
  }

  get capabilityCount(): number {
    return this.#client.capabilities.size;
  }

  async connect(): Promise<void> {
    await this.#client.connect();
  }

  async listMailboxCount(): Promise<number> {
    return (await this.#client.list()).length;
  }

  capabilityNames(): readonly string[] {
    return [...this.#client.capabilities.keys()].sort();
  }

  async listMailboxes(): Promise<readonly DiscoveredMailbox[]> {
    const listed = await this.#client.list({
      statusQuery: { messages: true, unseen: true, uidNext: true, uidValidity: true },
    });
    return listed.map((mailbox) => ({
      path: mailbox.path,
      name: mailbox.name,
      delimiter: mailbox.delimiter,
      specialUse: mailbox.specialUse ?? null,
      flags: [...mailbox.flags].sort(),
      messageCount: mailbox.status?.messages ?? 0,
      unreadCount: mailbox.status?.unseen ?? 0,
      uidValidity: String(mailbox.status?.uidValidity ?? 0),
      uidNext: mailbox.status?.uidNext ?? 0,
    }));
  }

  async sampleRecipientHeaders(
    mailboxPath: string,
    limit: number,
  ): Promise<readonly RecipientHeaderEvidence[]> {
    const mailbox = await this.#client.mailboxOpen(mailboxPath, { readOnly: true });
    try {
      if (mailbox.exists === 0 || limit <= 0) return [];
      const first = Math.max(1, mailbox.exists - limit + 1);
      const evidence: RecipientHeaderEvidence[] = [];
      for await (const message of this.#client.fetch(
        `${first}:*`,
        { headers: [...HEADER_NAMES], internalDate: true, uid: true },
      )) {
        const value = message.internalDate;
        const seenAt = value ? new Date(value).toISOString() : null;
        evidence.push(...extractRecipientEvidence(message.headers, seenAt));
      }
      return evidence;
    } finally {
      await this.#client.mailboxClose().catch(() => undefined);
    }
  }

  async fetchAuditBatch(
    mailboxPath: string,
    fromUid: number,
    limit: number,
    extractBodies: boolean,
  ): Promise<ProtonAuditBatch> {
    const mailbox = await this.#client.mailboxOpen(mailboxPath, { readOnly: true });
    try {
      const found = await this.#client.search({ uid: `${Math.max(1, fromUid)}:*` }, { uid: true });
      const uids = (found || []).slice(0, Math.max(1, Math.min(limit, 250)));
      const messages: ProtonAuditMessage[] = [];
      const textParts = new Map<number, MessageStructureObject>();
      if (uids.length) {
        for await (const message of this.#client.fetch(
          uids,
          {
            uid: true,
            flags: true,
            envelope: true,
            internalDate: true,
            size: true,
            headers: [...AUDIT_HEADER_NAMES],
            bodyStructure: extractBodies,
          },
          { uid: true },
        )) {
          if (extractBodies) {
            const part = firstPlainTextPart(message.bodyStructure);
            if (part?.part) textParts.set(message.uid, part);
          }
          const address = (items: Array<{ address?: string }> | undefined) =>
            [...new Set((items ?? []).flatMap((item) => item.address ? [item.address.toLowerCase()] : []))];
          messages.push({
            uid: message.uid,
            messageId: message.envelope?.messageId ?? null,
            receivedAt: message.internalDate ? new Date(message.internalDate).toISOString() : null,
            subject: message.envelope?.subject?.slice(0, 2_048) ?? null,
            senders: address(message.envelope?.from),
            recipients: [...new Set([
              ...address(message.envelope?.to),
              ...address(message.envelope?.cc),
              ...address(message.envelope?.bcc),
            ])],
            headers: headerValues(message.headers),
            flags: [...(message.flags ?? [])].sort(),
            sizeBytes: message.size ?? 0,
            bodyText: null,
            bodyTruncated: false,
            bodyError: false,
          });
        }
        // ImapFlow serializes commands. Drain the metadata FETCH completely
        // before issuing per-message body-part FETCH commands.
        for (const message of messages) {
          const part = textParts.get(message.uid);
          if (!part?.part) continue;
          try {
            const body = await this.#client.fetchOne(
              message.uid,
              { bodyParts: [{ key: part.part, maxLength: MAX_TEXT_BYTES }] },
              { uid: true },
            );
            const buffer = body && body.bodyParts?.get(part.part);
            if (buffer) message.bodyText = decodeTextPart(buffer, part.encoding);
            message.bodyTruncated = (part.size ?? 0) > MAX_TEXT_BYTES;
          } catch {
            message.bodyError = true;
          }
        }
      }
      return {
        uidValidity: String(mailbox.uidValidity),
        uidNext: mailbox.uidNext,
        exists: mailbox.exists,
        messages: messages.sort((left, right) => left.uid - right.uid),
      };
    } finally {
      await this.#client.mailboxClose().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.#client.usable) await this.#client.logout();
    else this.#client.close();
  }
}

export const createBridgeClient: BridgeClientFactory = async (credentials) => {
  const { ImapFlow: RuntimeImapFlow } = await import('imapflow');
  return new ImapFlowBridgeClient(new RuntimeImapFlow(bridgeOptionsFor(credentials)));
};

export const createProtonReadClient: ProtonReadClientFactory = async (credentials) => {
  const { ImapFlow: RuntimeImapFlow } = await import('imapflow');
  return new ImapFlowBridgeClient(new RuntimeImapFlow(bridgeOptionsFor(credentials)));
};

export const createProtonAuditClient: ProtonAuditClientFactory = async (credentials) => {
  const { ImapFlow: RuntimeImapFlow } = await import('imapflow');
  return new ImapFlowBridgeClient(new RuntimeImapFlow(bridgeOptionsFor(credentials)));
};

const categoryForError = (error: unknown): BridgeDiagnosticCategory => {
  const candidate = error as { code?: unknown; authenticationFailed?: unknown; message?: unknown };
  const code = String(candidate?.code ?? '').toUpperCase();
  const message = String(candidate?.message ?? '').toLowerCase();

  if (candidate?.authenticationFailed || /auth|login|credential/.test(message)) {
    return 'authentication_failed';
  }
  if (/CERT|TLS|SSL/.test(code) || /certificate|tls|ssl/.test(message)) {
    return 'tls_failed';
  }
  if (
    ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'CONNECT_TIMEOUT'].includes(code) ||
    /refused|not found|unreachable|connect timeout/.test(message)
  ) {
    return 'bridge_unavailable';
  }
  return 'connection_interrupted';
};

const messageForCategory = (category: BridgeDiagnosticCategory): string => {
  switch (category) {
    case 'connected':
      return 'Bridge accepted the local connection. No mailbox changes were made.';
    case 'bridge_unavailable':
      return 'Sift could not reach Proton Bridge on this computer.';
    case 'authentication_failed':
      return 'Bridge rejected these credentials. Use the IMAP username and password shown by Bridge.';
    case 'tls_failed':
      return 'Bridge connection security does not match this setting.';
    case 'configuration_invalid':
      return 'The Bridge connection settings are invalid.';
    case 'connection_interrupted':
      return 'The local Bridge connection ended before diagnostics completed.';
  }
};

export const diagnoseBridge = async (
  rawCredentials: BridgeCredentials,
  createClient: BridgeClientFactory = createBridgeClient,
): Promise<BridgeDiagnostic> => {
  const parsed = bridgeCredentialsSchema.safeParse(rawCredentials);
  if (!parsed.success) {
    return {
      ok: false,
      category: 'configuration_invalid',
      message: messageForCategory('configuration_invalid'),
      capabilityCount: 0,
      mailboxCount: 0,
    };
  }

  const client = await createClient(parsed.data);
  try {
    await client.connect();
    const mailboxCount = await client.listMailboxCount();
    return {
      ok: true,
      category: 'connected',
      message: messageForCategory('connected'),
      capabilityCount: client.capabilityCount,
      mailboxCount,
    };
  } catch (error) {
    const category = categoryForError(error);
    return {
      ok: false,
      category,
      message: messageForCategory(category),
      capabilityCount: 0,
      mailboxCount: 0,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
};
