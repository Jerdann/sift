import type BetterSqlite3 from 'better-sqlite3';
import type { IdentityEvidenceSource } from '../../shared/contracts/accounts';

const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const exactEmailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export interface IndexedIdentityMessage {
  senders: readonly string[];
  headers: Readonly<Record<string, string>>;
  sent: boolean;
  receivedAt: string | null;
}

export interface OwnedIdentityEvidence {
  address: string;
  evidence: IdentityEvidenceSource[];
  sentFromCount: number;
  deliveredToCount: number;
  providerEvidence: boolean;
  lastSeenAt: string | null;
}

const normalize = (address: string): string | null => {
  const value = address.trim().toLowerCase();
  if (!exactEmailPattern.test(value)) return null;
  if (value.endsWith('@forward.protonmail.ch')) return null;
  return value;
};

const addressesIn = (value: string | undefined): string[] => [
  ...new Set((value?.match(emailPattern) ?? []).map((address) => address.toLowerCase())),
];

export const extractOwnedIdentityEvidence = ({
  primaryAddresses = [],
  providerAliases = [],
  messages,
}: {
  primaryAddresses?: readonly string[];
  providerAliases?: readonly string[];
  messages: readonly IndexedIdentityMessage[];
}): OwnedIdentityEvidence[] => {
  const identities = new Map<string, {
    evidence: Set<IdentityEvidenceSource>;
    sentFromCount: number;
    deliveredToCount: number;
    providerEvidence: boolean;
    lastSeenAt: string | null;
  }>();
  const add = (rawAddress: string, source: IdentityEvidenceSource, seenAt: string | null) => {
    const address = normalize(rawAddress);
    if (!address) return;
    const current = identities.get(address) ?? {
      evidence: new Set<IdentityEvidenceSource>(),
      sentFromCount: 0,
      deliveredToCount: 0,
      providerEvidence: false,
      lastSeenAt: null,
    };
    current.evidence.add(source);
    if (source === 'sent_from') current.sentFromCount += 1;
    if (source === 'delivered_to' || source === 'x_original_to') current.deliveredToCount += 1;
    if (source === 'provider_primary' || source === 'provider_alias') current.providerEvidence = true;
    if (seenAt && (!current.lastSeenAt || seenAt > current.lastSeenAt)) current.lastSeenAt = seenAt;
    identities.set(address, current);
  };

  for (const address of primaryAddresses) add(address, 'provider_primary', null);
  for (const address of providerAliases) add(address, 'provider_alias', null);
  for (const message of messages) {
    if (message.sent) {
      for (const sender of message.senders) add(sender, 'sent_from', message.receivedAt);
      continue;
    }
    for (const address of addressesIn(message.headers['delivered-to'])) add(address, 'delivered_to', message.receivedAt);
    for (const address of addressesIn(message.headers['x-original-to'])) add(address, 'x_original_to', message.receivedAt);
  }

  return [...identities.entries()].map(([address, value]) => ({
    address,
    evidence: [...value.evidence].sort(),
    sentFromCount: value.sentFromCount,
    deliveredToCount: value.deliveredToCount,
    providerEvidence: value.providerEvidence,
    lastSeenAt: value.lastSeenAt,
  })).sort((left, right) => left.address.localeCompare(right.address));
};

const safeArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const safeHeaders = (value: string): Record<string, string> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
};

export const protonIdentityEvidence = (
  database: BetterSqlite3.Database,
  connectionId: string,
): OwnedIdentityEvidence[] => {
  const rows = database.prepare(`
    SELECT indexed_messages.sender_json,indexed_messages.headers_json,indexed_messages.received_at,
      mail_containers.special_use
    FROM indexed_messages
    JOIN mail_containers ON mail_containers.id=indexed_messages.container_id
    WHERE indexed_messages.connection_id=?
  `).all(connectionId) as Array<{ sender_json: string; headers_json: string; received_at: string | null; special_use: string | null }>;
  return extractOwnedIdentityEvidence({
    messages: rows.map((row) => ({
      senders: safeArray(row.sender_json),
      headers: safeHeaders(row.headers_json),
      sent: row.special_use?.toLowerCase() === '\\sent',
      receivedAt: row.received_at,
    })),
  });
};

export const gmailIdentityEvidence = (
  database: BetterSqlite3.Database,
  connectionId: string,
  primaryAddress: string,
  providerAliases: readonly string[] = [],
): OwnedIdentityEvidence[] => {
  const rows = database.prepare(`
    SELECT sender_json,headers_json,label_ids_json,received_at
    FROM gmail_indexed_messages WHERE connection_id=?
  `).all(connectionId) as Array<{ sender_json: string; headers_json: string; label_ids_json: string; received_at: string | null }>;
  return extractOwnedIdentityEvidence({
    primaryAddresses: [primaryAddress],
    providerAliases,
    messages: rows.map((row) => ({
      senders: safeArray(row.sender_json),
      headers: safeHeaders(row.headers_json),
      sent: safeArray(row.label_ids_json).some((label) => label.toUpperCase() === 'SENT'),
      receivedAt: row.received_at,
    })),
  });
};
