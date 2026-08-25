import type BetterSqlite3 from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { MailboxAnalysisSummary } from '../../shared/contracts/analysis';
import {
  CLASSIFIER_VERSION,
  classifyMessage,
} from '../../core/classification/mail-classifier';
import {
  MailboxAnalysisRepository,
} from './mailbox-analysis-repository';
import { AccountIdentityRepository } from '../identity/account-identity-repository';
import { protonIdentityEvidence } from '../identity/ownership-evidence';

interface IndexedRow {
  id: string;
  message_id: string | null;
  uid_validity: string;
  uid: number;
  received_at: string | null;
  subject: string | null;
  sender_json: string;
  recipients_json: string;
  headers_json: string;
  body_text: string | null;
}

const canonicalKey = (row: IndexedRow): string => createHash('sha256')
  .update(row.message_id ?? `${row.uid_validity}:${row.uid}:${row.received_at ?? ''}:${row.subject ?? ''}`)
  .digest('hex');

export const analyzeMailbox = (
  database: BetterSqlite3.Database,
  profileId: string,
  connectionId: string,
  repository = new MailboxAnalysisRepository(database, profileId),
): MailboxAnalysisSummary => {
  const rows = database.prepare(`
    SELECT indexed_messages.* FROM indexed_messages
    JOIN mail_containers ON mail_containers.id = indexed_messages.container_id
    WHERE indexed_messages.connection_id = ?
    ORDER BY indexed_messages.received_at DESC,
      CASE WHEN lower(mail_containers.provider_container_id) = 'inbox' THEN 0
           WHEN lower(COALESCE(mail_containers.special_use, '')) = '\\all' THEN 2
           ELSE 1 END,
      indexed_messages.uid DESC
  `).all(connectionId) as IndexedRow[];
  if (!rows.length) throw new Error('proton_audit_required');
  const ownership = new AccountIdentityRepository(database, profileId).sync(
    'proton',
    connectionId,
    protonIdentityEvidence(database, connectionId),
  );
  const activeOwnership = ownership.filter((identity) => identity.status !== 'rejected');
  const ownedAddresses = new Set(activeOwnership.map((identity) => identity.address));
  const sendingAddresses = new Set(activeOwnership.filter((identity) => identity.sentFromCount > 0).map((identity) => identity.address));
  const seen = new Set<string>();
  const classifications = [];
  for (const row of rows) {
    const key = canonicalKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const senders = JSON.parse(row.sender_json) as string[];
    if (senders.some((sender) => sendingAddresses.has(sender.trim().toLowerCase()))) continue;
    const classified = classifyMessage({
      subject: row.subject,
      bodyText: row.body_text,
      senders,
      recipients: JSON.parse(row.recipients_json) as string[],
      headers: JSON.parse(row.headers_json) as Record<string, string>,
    });
    const matchedAddresses = classified.receivingAddresses.filter((address) => ownedAddresses.has(address));
    classifications.push({
      messageRowId: row.id,
      canonicalKey: key,
      category: classified.category,
      confidence: classified.confidence,
      evidence: classified.evidence,
      senderDomain: classified.senderDomain,
      receivingAddresses: matchedAddresses,
      receivedAt: row.received_at,
    });
  }
  return repository.save(connectionId, CLASSIFIER_VERSION, classifications);
};
