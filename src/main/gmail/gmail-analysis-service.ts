import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { CATEGORY_PRESENTATION, CLASSIFIER_VERSION, classifyMessage } from '../../core/classification/mail-classifier';
import type { MailCategory, MailboxAnalysisSummary } from '../../shared/contracts/analysis';
import { mailboxAnalysisSummarySchema } from '../../shared/contracts/analysis';
import type { GmailConnectionSummary } from '../../shared/contracts/gmail';
import { AccountIdentityRepository } from '../identity/account-identity-repository';
import { gmailIdentityEvidence } from '../identity/ownership-evidence';

interface GmailRow {
  id: string;
  received_at: string | null;
  subject: string | null;
  sender_json: string;
  recipients_json: string;
  headers_json: string;
  label_ids_json: string;
}

interface Stream {
  senderDomain: string;
  category: MailCategory;
  receivingAddress: string;
  messageCount: number;
  latestAt: string | null;
  confidence: number;
  evidence: string[];
}

const stringArray = (value: string): string[] => JSON.parse(value) as string[];

export class GmailAnalysisService {
  readonly #database: BetterSqlite3.Database;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(database: BetterSqlite3.Database, profileId: string, options: { now?: () => string; createId?: () => string } = {}) {
    this.#database = database;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  analyze(connection: GmailConnectionSummary): MailboxAnalysisSummary {
    const rows = this.#database.prepare(
      'SELECT * FROM gmail_indexed_messages WHERE connection_id=? ORDER BY received_at DESC',
    ).all(connection.id) as GmailRow[];
    if (!rows.length) throw new Error('gmail_audit_required');

    const identityRepository = new AccountIdentityRepository(this.#database, this.#profileId);
    const identities = identityRepository.sync(
      'gmail',
      connection.id,
      gmailIdentityEvidence(this.#database, connection.id, connection.email),
    );
    const activeAddresses = new Set(
      identities.filter((identity) => identity.status === 'confirmed').map((identity) => identity.address),
    );
    const analysisId = this.#createId();
    const analyzedAt = this.#now();
    const classified = rows
      .filter((row) => !stringArray(row.label_ids_json).some((label) => label.toUpperCase() === 'SENT'))
      .map((row) => ({
        row,
        result: classifyMessage({
          subject: row.subject,
          bodyText: null,
          senders: stringArray(row.sender_json),
          recipients: stringArray(row.recipients_json),
          headers: JSON.parse(row.headers_json) as Record<string, string>,
        }),
      }));
    const streams = new Map<string, Stream>();

    for (const item of classified) {
      const matched = item.result.receivingAddresses.filter((address) => activeAddresses.has(address));
      for (const address of matched.length ? matched : ['unknown']) {
        const key = `${item.result.senderDomain}\0${item.result.category}\0${address}`;
        const stream = streams.get(key) ?? {
          senderDomain: item.result.senderDomain,
          category: item.result.category,
          receivingAddress: address,
          messageCount: 0,
          latestAt: null,
          confidence: 0,
          evidence: [],
        };
        stream.confidence = ((stream.confidence * stream.messageCount) + item.result.confidence) / (stream.messageCount + 1);
        stream.messageCount += 1;
        if (item.row.received_at && (!stream.latestAt || item.row.received_at > stream.latestAt)) stream.latestAt = item.row.received_at;
        stream.evidence = [...new Set([...stream.evidence, ...item.result.evidence])].slice(0, 5);
        streams.set(key, stream);
      }
    }

    this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM gmail_mailbox_analyses WHERE connection_id=?').run(connection.id);
      this.#database.prepare(`
        INSERT INTO gmail_mailbox_analyses(id,connection_id,profile_id,classifier_version,analyzed_at)
        VALUES (?,?,?,?,?)
      `).run(analysisId, connection.id, this.#profileId, CLASSIFIER_VERSION, analyzedAt);
      const addClassification = this.#database.prepare(`
        INSERT INTO gmail_message_classifications(
          analysis_id,message_row_id,category,confidence,evidence_json,sender_domain,receiving_addresses_json
        ) VALUES (?,?,?,?,?,?,?)
      `);
      for (const item of classified) {
        const matched = item.result.receivingAddresses.filter((address) => activeAddresses.has(address));
        addClassification.run(
          analysisId, item.row.id, item.result.category, item.result.confidence,
          JSON.stringify(item.result.evidence), item.result.senderDomain, JSON.stringify(matched),
        );
      }
      const addStream = this.#database.prepare(`
        INSERT INTO gmail_analysis_streams(
          id,analysis_id,sender_domain,category,receiving_address,message_count,latest_at,confidence,evidence_json
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `);
      for (const stream of streams.values()) {
        addStream.run(
          this.#createId(), analysisId, stream.senderDomain, stream.category, stream.receivingAddress,
          stream.messageCount, stream.latestAt, stream.confidence, JSON.stringify(stream.evidence),
        );
      }
    })();
    return this.get(connection)!;
  }

  get(connection: GmailConnectionSummary): MailboxAnalysisSummary | null {
    const analysis = this.#database.prepare(`
      SELECT id,classifier_version,analyzed_at FROM gmail_mailbox_analyses
      WHERE connection_id=? AND profile_id=?
    `).get(connection.id, this.#profileId) as { id: string; classifier_version: string; analyzed_at: string } | undefined;
    if (!analysis) return null;
    const categories = this.#database.prepare(`
      SELECT category,COUNT(*) message_count,AVG(confidence) average_confidence
      FROM gmail_message_classifications WHERE analysis_id=?
      GROUP BY category ORDER BY message_count DESC
    `).all(analysis.id) as Array<{ category: MailCategory; message_count: number; average_confidence: number }>;
    const streams = this.#database.prepare(`
      SELECT * FROM gmail_analysis_streams WHERE analysis_id=?
      ORDER BY message_count DESC,sender_domain
    `).all(analysis.id) as Array<{
      sender_domain: string;
      category: MailCategory;
      receiving_address: string;
      message_count: number;
      latest_at: string | null;
      confidence: number;
      evidence_json: string;
    }>;
    const identityRepository = new AccountIdentityRepository(this.#database, this.#profileId);
    let identities = identityRepository.list('gmail', connection.id);
    if (!identities.length) {
      identities = identityRepository.sync(
        'gmail',
        connection.id,
        gmailIdentityEvidence(this.#database, connection.id, connection.email),
      );
    }
    identities = identities.filter((identity) => identity.status === 'confirmed');
    const safeStreams = streams.filter((stream) => identities.some((identity) => identity.address === stream.receiving_address));
    const addresses = identities.map((identity) => {
      const addressStreams = safeStreams.filter((stream) => stream.receiving_address === identity.address);
      const messageCount = addressStreams.reduce((sum, stream) => sum + stream.message_count, 0);
      const latestAt = addressStreams.map((stream) => stream.latest_at).filter(Boolean).sort().at(-1) ?? null;
      const importantCount = addressStreams
        .filter((stream) => ['security', 'accounts', 'transactions', 'finance'].includes(stream.category))
        .reduce((sum, stream) => sum + stream.message_count, 0);
      const services = new Map<string, { messageCount: number; latestAt: string | null; categories: Set<MailCategory> }>();
      for (const stream of addressStreams) {
        if (stream.sender_domain === 'unknown-sender') continue;
        const current = services.get(stream.sender_domain) ?? { messageCount: 0, latestAt: null, categories: new Set<MailCategory>() };
        current.messageCount += stream.message_count;
        if (stream.latest_at && (!current.latestAt || stream.latest_at > current.latestAt)) current.latestAt = stream.latest_at;
        current.categories.add(stream.category);
        services.set(stream.sender_domain, current);
      }
      return {
        address: identity.address,
        ownershipEvidence: identity.providerEvidence
          ? 'provider_account' as const
          : identity.sentFromCount && identity.deliveredToCount
            ? 'sent_and_received' as const
            : identity.sentFromCount ? 'sent' as const : 'received' as const,
        canRetire: identity.sentFromCount > 0,
        sentFromCount: identity.sentFromCount,
        deliveredToCount: identity.deliveredToCount,
        evidence: identity.evidence,
        status: identity.status,
        containerEnabled: identity.containerEnabled,
        containerName: identity.containerName,
        recommendation: importantCount ? 'retain' as const : 'watch' as const,
        messageCount,
        latestAt,
        importantCount,
        services: [...services.entries()]
          .sort((left, right) => right[1].messageCount - left[1].messageCount)
          .slice(0, 100)
          .map(([domain, value]) => ({
            domain,
            messageCount: value.messageCount,
            latestAt: value.latestAt,
            categories: [...value.categories],
          })),
        rationale: importantCount
          ? `${importantCount} account, security, transaction, or finance messages make this address important.`
          : 'Recent activity exists, but important account evidence was not found.',
      };
    }).sort((left, right) => right.messageCount - left.messageCount || left.address.localeCompare(right.address));

    return mailboxAnalysisSummarySchema.parse({
      connectionId: connection.id,
      analyzedAt: analysis.analyzed_at,
      classifierVersion: analysis.classifier_version,
      uniqueMessages: categories.reduce((sum, item) => sum + item.message_count, 0),
      categories: categories.map((item) => ({
        category: item.category,
        label: CATEGORY_PRESENTATION[item.category].label,
        proposedFolder: CATEGORY_PRESENTATION[item.category].folder,
        messageCount: item.message_count,
        streamCount: safeStreams.filter((stream) => stream.category === item.category).length,
        averageConfidence: item.average_confidence,
      })),
      topStreams: safeStreams.map((stream) => ({
        senderDomain: stream.sender_domain,
        category: stream.category,
        receivingAddress: stream.receiving_address,
        messageCount: stream.message_count,
        latestAt: stream.latest_at,
        confidence: stream.confidence,
        evidence: JSON.parse(stream.evidence_json),
      })),
      addresses,
    });
  }
}
