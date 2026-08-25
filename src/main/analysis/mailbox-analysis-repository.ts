import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  type MailCategory,
  type MailboxAnalysisSummary,
  mailboxAnalysisSummarySchema,
} from '../../shared/contracts/analysis';
import { CATEGORY_PRESENTATION } from '../../core/classification/mail-classifier';
import { AccountIdentityRepository } from '../identity/account-identity-repository';
import { protonIdentityEvidence } from '../identity/ownership-evidence';

export interface OwnedAddressEvidence {
  address: string;
  sentFromCount: number;
  deliveredToCount: number;
  lastSeenAt: string | null;
}

export const ownedAddressEvidence = (
  database: BetterSqlite3.Database,
  connectionId: string,
): OwnedAddressEvidence[] => {
  return protonIdentityEvidence(database, connectionId).map((identity) => ({
    address: identity.address,
    sentFromCount: identity.sentFromCount,
    deliveredToCount: identity.deliveredToCount,
    lastSeenAt: identity.lastSeenAt,
  }));
};

export interface StoredClassification {
  messageRowId: string;
  canonicalKey: string;
  category: MailCategory;
  confidence: number;
  evidence: string[];
  senderDomain: string;
  receivingAddresses: string[];
  receivedAt: string | null;
}

interface StreamAggregate {
  senderDomain: string;
  category: MailCategory;
  receivingAddress: string;
  messageCount: number;
  latestAt: string | null;
  confidence: number;
  evidence: string[];
}

export class MailboxAnalysisRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    database: BetterSqlite3.Database,
    profileId: string,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#database = database;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  save(connectionId: string, classifierVersion: string, items: readonly StoredClassification[]): MailboxAnalysisSummary {
    const analysisId = this.#createId();
    const analyzedAt = this.#now();
    const streams = new Map<string, StreamAggregate>();
    for (const item of items) {
      for (const address of item.receivingAddresses.length ? item.receivingAddresses : ['unknown']) {
        const key = `${item.senderDomain}\0${item.category}\0${address}`;
        const current = streams.get(key) ?? {
          senderDomain: item.senderDomain,
          category: item.category,
          receivingAddress: address,
          messageCount: 0,
          latestAt: null,
          confidence: 0,
          evidence: [],
        };
        current.confidence = ((current.confidence * current.messageCount) + item.confidence) / (current.messageCount + 1);
        current.messageCount += 1;
        if (item.receivedAt && (!current.latestAt || item.receivedAt > current.latestAt)) current.latestAt = item.receivedAt;
        current.evidence = [...new Set([...current.evidence, ...item.evidence])].slice(0, 5);
        streams.set(key, current);
      }
    }

    this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM mailbox_analyses WHERE connection_id = ?').run(connectionId);
      this.#database.prepare(`
        INSERT INTO mailbox_analyses(id, connection_id, profile_id, classifier_version, analyzed_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(analysisId, connectionId, this.#profileId, classifierVersion, analyzedAt);
      const addClassification = this.#database.prepare(`
        INSERT INTO message_classifications(
          analysis_id, message_row_id, canonical_key, category, confidence,
          evidence_json, sender_domain, receiving_addresses_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        addClassification.run(
          analysisId, item.messageRowId, item.canonicalKey, item.category, item.confidence,
          JSON.stringify(item.evidence), item.senderDomain, JSON.stringify(item.receivingAddresses),
        );
      }
      const addStream = this.#database.prepare(`
        INSERT INTO analysis_streams(
          id, analysis_id, sender_domain, category, receiving_address,
          message_count, latest_at, confidence, evidence_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const addService = this.#database.prepare(`
        INSERT INTO address_service_evidence(
          id, analysis_id, receiving_address, sender_domain, message_count, latest_at, categories_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const services = new Map<string, { address: string; domain: string; count: number; latestAt: string | null; categories: Set<MailCategory> }>();
      for (const stream of streams.values()) {
        addStream.run(
          this.#createId(), analysisId, stream.senderDomain, stream.category, stream.receivingAddress,
          stream.messageCount, stream.latestAt, stream.confidence, JSON.stringify(stream.evidence),
        );
        if (stream.receivingAddress === 'unknown' || stream.senderDomain === 'unknown-sender') continue;
        const key = `${stream.receivingAddress}\0${stream.senderDomain}`;
        const service = services.get(key) ?? { address: stream.receivingAddress, domain: stream.senderDomain, count: 0, latestAt: null, categories: new Set() };
        service.count += stream.messageCount;
        if (stream.latestAt && (!service.latestAt || stream.latestAt > service.latestAt)) service.latestAt = stream.latestAt;
        service.categories.add(stream.category);
        services.set(key, service);
      }
      for (const service of services.values()) {
        addService.run(
          this.#createId(), analysisId, service.address, service.domain, service.count,
          service.latestAt, JSON.stringify([...service.categories].sort()),
        );
      }
    })();
    return this.get(connectionId)!;
  }

  get(connectionId: string): MailboxAnalysisSummary | null {
    const analysis = this.#database.prepare(`
      SELECT id, classifier_version, analyzed_at FROM mailbox_analyses
      WHERE connection_id = ? AND profile_id = ? ORDER BY rowid DESC LIMIT 1
    `).get(connectionId, this.#profileId) as { id: string; classifier_version: string; analyzed_at: string } | undefined;
    if (!analysis) return null;
    const categories = this.#database.prepare(`
      SELECT mc.category, COUNT(*) AS message_count, AVG(mc.confidence) AS average_confidence,
             (SELECT COUNT(*) FROM analysis_streams s
              WHERE s.analysis_id = mc.analysis_id AND s.category = mc.category) AS stream_count
      FROM message_classifications mc
      WHERE mc.analysis_id = ? GROUP BY mc.category ORDER BY message_count DESC
    `).all(analysis.id) as Array<{ category: MailCategory; message_count: number; average_confidence: number; stream_count: number }>;
    const streams = this.#database.prepare(`
      SELECT * FROM analysis_streams WHERE analysis_id = ?
      ORDER BY message_count DESC, sender_domain
    `).all(analysis.id) as Array<{
      sender_domain: string; category: MailCategory; receiving_address: string; message_count: number;
      latest_at: string | null; confidence: number; evidence_json: string;
    }>;
    const identityRepository = new AccountIdentityRepository(this.#database, this.#profileId);
    let identities = identityRepository.list('proton', connectionId);
    if (!identities.length) {
      identities = identityRepository.sync('proton', connectionId, protonIdentityEvidence(this.#database, connectionId));
    }
    const ownership = identities.filter((identity) => identity.status === 'confirmed');
    const verifiedAddresses = new Set(ownership.map((item) => item.address));
    const serviceRows = (this.#database.prepare(`
      SELECT * FROM address_service_evidence WHERE analysis_id = ?
      ORDER BY receiving_address, message_count DESC, sender_domain
    `).all(analysis.id) as Array<{
      receiving_address: string; sender_domain: string; message_count: number;
      latest_at: string | null; categories_json: string;
    }>).filter((row) => verifiedAddresses.has(row.receiving_address));
    const safeStreams = streams.filter((stream) => verifiedAddresses.has(stream.receiving_address));
    const addresses = ownership.map((identity) => {
      const address = identity.address;
      const rows = serviceRows.filter((row) => row.receiving_address === address);
      const messageCount = rows.reduce((sum, row) => sum + row.message_count, 0);
      const latestAt = rows.map((row) => row.latest_at).filter(Boolean).sort().at(-1) ?? null;
      const importantCount = (this.#database.prepare(`
        SELECT COALESCE(SUM(message_count), 0) AS count FROM analysis_streams
        WHERE analysis_id = ? AND receiving_address = ?
          AND category IN ('security', 'accounts', 'transactions', 'finance')
      `).get(analysis.id, address) as { count: number }).count;
      const ageDays = latestAt ? (Date.parse(this.#now()) - Date.parse(latestAt)) / 86_400_000 : Number.POSITIVE_INFINITY;
      let recommendation: 'retain' | 'migrate' | 'watch' | 'consider_deactivation';
      let rationale: string;
      if (importantCount > 0) {
        recommendation = 'retain';
        rationale = `${importantCount} account, security, transaction, or finance messages make this address important.`;
      } else if (identity.sentFromCount > 0 && (messageCount === 0 || ageDays > 730)) {
        recommendation = 'consider_deactivation';
        rationale = 'This verified sending identity has no recent important service evidence; verify manually before retirement.';
      } else if (rows.some((row) => (JSON.parse(row.categories_json) as MailCategory[]).some((category) => ['games', 'shopping', 'social'].includes(category)))) {
        recommendation = 'migrate';
        rationale = 'Active service identities were found, but no critical account mail; consider consolidating them.';
      } else {
        recommendation = 'watch';
        rationale = 'Recent activity exists, but the evidence is not strong enough for a retain or deactivate decision.';
      }
      return {
        address,
        ownershipEvidence: identity.sentFromCount && identity.deliveredToCount
          ? 'sent_and_received' as const
          : identity.sentFromCount ? 'sent' as const
            : identity.providerEvidence ? 'provider_account' as const : 'received' as const,
        canRetire: identity.sentFromCount > 0,
        sentFromCount: identity.sentFromCount,
        deliveredToCount: identity.deliveredToCount,
        evidence: identity.evidence,
        status: identity.status,
        containerEnabled: identity.containerEnabled,
        containerName: identity.containerName,
        recommendation, messageCount, latestAt, importantCount,
        services: rows.slice(0, 25).map((row) => ({
          domain: row.sender_domain,
          messageCount: row.message_count,
          latestAt: row.latest_at,
          categories: JSON.parse(row.categories_json) as MailCategory[],
        })),
        rationale,
      };
    }).sort((left, right) => right.messageCount - left.messageCount || left.address.localeCompare(right.address));

    return mailboxAnalysisSummarySchema.parse({
      connectionId,
      analyzedAt: analysis.analyzed_at,
      classifierVersion: analysis.classifier_version,
      uniqueMessages: categories.reduce((sum, category) => sum + category.message_count, 0),
      categories: categories.map((category) => ({
        category: category.category,
        label: CATEGORY_PRESENTATION[category.category].label,
        proposedFolder: CATEGORY_PRESENTATION[category.category].folder,
        messageCount: category.message_count,
        streamCount: category.stream_count,
        averageConfidence: category.average_confidence,
      })),
      topStreams: safeStreams.map((stream) => ({
        senderDomain: stream.sender_domain,
        category: stream.category,
        receivingAddress: stream.receiving_address,
        messageCount: stream.message_count,
        latestAt: stream.latest_at,
        confidence: stream.confidence,
        evidence: JSON.parse(stream.evidence_json) as string[],
      })),
      addresses,
    });
  }
}
