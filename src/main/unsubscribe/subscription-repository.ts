import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { MailCategory } from '../../shared/contracts/analysis';
import { type SubscriptionDashboard, subscriptionDashboardSchema } from '../../shared/contracts/unsubscribe';
import type { JobRepository } from '../jobs/job-repository';

interface EvidenceRow {
  analysis_id: string;
  canonical_key: string;
  category: MailCategory;
  sender_domain: string;
  receiving_addresses_json: string;
  subject: string | null;
  received_at: string | null;
  headers_json: string;
}

interface Group {
  senderDomain: string;
  listId: string;
  receivingAddress: string;
  endpoint: string | null;
  oneClick: boolean;
  authenticated: boolean;
  messageCount: number;
  latestAt: string | null;
  categories: Set<MailCategory>;
  subjects: string[];
}

export interface SubscriptionAction {
  id: string;
  endpoint: string;
  eligibility: 'eligible';
}

const httpsEndpoint = (value: string | undefined): string | null => {
  if (!value) return null;
  const values = [...value.matchAll(/<([^>]+)>|([^,\s]+)/g)].map((match) => match[1] ?? match[2] ?? '');
  for (const candidate of values) {
    try {
      const url = new URL(candidate.trim());
      if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
    } catch { /* malformed list endpoint */ }
  }
  return null;
};

export class SubscriptionRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #jobs: JobRepository;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    database: BetterSqlite3.Database,
    jobs: JobRepository,
    profileId: string,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#database = database;
    this.#jobs = jobs;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  get profileId(): string { return this.#profileId; }

  scan(connectionId: string): SubscriptionDashboard {
    const rows = this.#database.prepare(`
      SELECT mc.analysis_id, mc.canonical_key, mc.category, mc.sender_domain,
             mc.receiving_addresses_json, im.subject, im.received_at, im.headers_json
      FROM message_classifications mc
      JOIN mailbox_analyses ma ON ma.id = mc.analysis_id
      JOIN indexed_messages im ON im.id = mc.message_row_id
      WHERE ma.connection_id = ? AND ma.profile_id = ?
    `).all(connectionId, this.#profileId) as EvidenceRow[];
    if (!rows.length) throw new Error('mailbox_analysis_required');
    const analysisId = rows[0]!.analysis_id;
    const activeRun = this.#database.prepare(`
      SELECT 1
      FROM subscription_scans ss
      JOIN unsubscribe_runs ur ON ur.scan_id = ss.id
      JOIN jobs j ON j.id = ur.job_id
      WHERE ss.analysis_id = ? AND ss.profile_id = ? AND j.state IN ('pending', 'running')
      LIMIT 1
    `).get(analysisId, this.#profileId);
    if (activeRun) throw new Error('unsubscribe_run_active');
    const groups = new Map<string, Group>();
    for (const row of rows) {
      const headers = JSON.parse(row.headers_json) as Record<string, string>;
      if (
        !headers['list-id'] &&
        !headers['list-unsubscribe'] &&
        !['subscriptions', 'promotions', 'spam', 'suspicious'].includes(row.category)
      ) continue;
      const listId = (headers['list-id'] ?? row.sender_domain).replace(/[<>]/g, '').trim().toLowerCase().slice(0, 320);
      const addresses = JSON.parse(row.receiving_addresses_json) as string[];
      for (const address of addresses.length ? addresses : ['unknown']) {
        const key = `${listId}\0${row.sender_domain}\0${address}`;
        const current = groups.get(key) ?? {
          senderDomain: row.sender_domain,
          listId,
          receivingAddress: address,
          endpoint: null,
          oneClick: false,
          authenticated: false,
          messageCount: 0,
          latestAt: null,
          categories: new Set(),
          subjects: [],
        };
        current.messageCount += 1;
        current.categories.add(row.category);
        if (row.received_at && (!current.latestAt || row.received_at > current.latestAt)) current.latestAt = row.received_at;
        if (row.subject && current.subjects.length < 3 && !current.subjects.includes(row.subject)) current.subjects.push(row.subject.slice(0, 180));
        current.endpoint ??= httpsEndpoint(headers['list-unsubscribe']);
        current.oneClick ||= /list-unsubscribe\s*=\s*one-click/i.test(headers['list-unsubscribe-post'] ?? '');
        const auth = (headers['authentication-results'] ?? '').toLowerCase();
        current.authenticated ||= /dkim=pass/.test(auth) && /(?:dmarc|spf)=pass/.test(auth);
        groups.set(key, current);
      }
    }
    const scanId = this.#createId();
    const generatedAt = this.#now();
    this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM subscription_scans WHERE analysis_id = ?').run(analysisId);
      this.#database.prepare('INSERT INTO subscription_scans(id, analysis_id, profile_id, generated_at) VALUES (?, ?, ?, ?)')
        .run(scanId, analysisId, this.#profileId, generatedAt);
      const insert = this.#database.prepare(`
        INSERT INTO subscription_candidates(
          id, scan_id, sender_domain, list_id, receiving_address, endpoint,
          eligibility, authenticated, message_count, latest_at, categories_json,
          sample_subjects_json, status, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const protectedCategories = new Set<MailCategory>(['security', 'accounts', 'transactions', 'finance']);
      for (const group of groups.values()) {
        const categories = [...group.categories].sort();
        let eligibility: 'eligible' | 'manual' | 'protected' | 'spam_skipped';
        let status: 'pending' | 'manual' | 'spam_skipped';
        let reason: string;
        if (categories.some((category) => category === 'spam' || category === 'suspicious')) {
          eligibility = 'spam_skipped'; status = 'spam_skipped'; reason = 'Likely spam is never contacted; use native Spam handling instead.';
        } else if (categories.some((category) => protectedCategories.has(category))) {
          eligibility = 'protected'; status = 'manual'; reason = 'Transactional, security, account, or finance mail is protected from bulk unsubscribe.';
        } else if (group.endpoint && group.oneClick && group.authenticated) {
          eligibility = 'eligible'; status = 'pending'; reason = 'Authenticated RFC 8058 HTTPS one-click endpoint.';
        } else {
          eligibility = 'manual'; status = 'manual'; reason = !group.authenticated
            ? 'Sender authentication is insufficient for an automated request.'
            : 'No authenticated RFC 8058 one-click HTTPS endpoint was found.';
        }
        insert.run(
          this.#createId(), scanId, group.senderDomain, group.listId, group.receivingAddress,
          group.endpoint, eligibility, group.authenticated ? 1 : 0, group.messageCount,
          group.latestAt, JSON.stringify(categories), JSON.stringify(group.subjects), status, reason,
        );
      }
    })();
    return this.getByScan(scanId);
  }

  getCurrent(connectionId: string): SubscriptionDashboard | null {
    const row = this.#database.prepare(`
      SELECT ss.id FROM subscription_scans ss
      JOIN mailbox_analyses ma ON ma.id = ss.analysis_id
      WHERE ma.connection_id = ? AND ss.profile_id = ? ORDER BY ss.rowid DESC LIMIT 1
    `).get(connectionId, this.#profileId) as { id: string } | undefined;
    return row ? this.getByScan(row.id) : null;
  }

  getByScan(scanId: string): SubscriptionDashboard {
    const scan = this.#database.prepare('SELECT * FROM subscription_scans WHERE id = ? AND profile_id = ?').get(scanId, this.#profileId) as { id: string; analysis_id: string; generated_at: string } | undefined;
    if (!scan) throw new Error('Subscription scan was not found');
    const rows = this.#database.prepare('SELECT * FROM subscription_candidates WHERE scan_id = ? ORDER BY message_count DESC, sender_domain').all(scanId) as Array<Record<string, unknown>>;
    const jobRow = this.#database.prepare('SELECT job_id FROM unsubscribe_runs WHERE scan_id = ? ORDER BY rowid DESC LIMIT 1').get(scanId) as { job_id: string } | undefined;
    return subscriptionDashboardSchema.parse({
      analysisId: scan.analysis_id,
      generatedAt: scan.generated_at,
      candidates: rows.map((row) => ({
        id: row.id,
        senderDomain: row.sender_domain,
        listId: row.list_id,
        receivingAddress: row.receiving_address,
        eligibility: row.eligibility,
        authenticated: Boolean(row.authenticated),
        messageCount: row.message_count,
        latestAt: row.latest_at,
        categories: JSON.parse(String(row.categories_json)),
        sampleSubjects: JSON.parse(String(row.sample_subjects_json)),
        status: row.status,
        reason: row.reason,
      })),
      job: jobRow ? this.#jobs.getProgress(jobRow.job_id) : null,
    });
  }

  start(candidateIds: readonly string[]): SubscriptionDashboard {
    const placeholders = candidateIds.map(() => '?').join(',');
    const rows = this.#database.prepare(`
      SELECT sc.id, sc.scan_id FROM subscription_candidates sc
      JOIN subscription_scans ss ON ss.id = sc.scan_id
      WHERE sc.id IN (${placeholders}) AND sc.eligibility = 'eligible' AND ss.profile_id = ?
    `).all(...candidateIds, this.#profileId) as Array<{ id: string; scan_id: string }>;
    if (rows.length !== candidateIds.length || new Set(rows.map((row) => row.scan_id)).size !== 1) {
      throw new Error('unsubscribe_selection_invalid');
    }
    const scanId = rows[0]!.scan_id;
    const job = this.#jobs.createJob({
      profileId: this.#profileId,
      kind: 'bulk-unsubscribe',
      idempotencyKey: `unsubscribe:${scanId}:${[...candidateIds].sort().join(',')}`,
      itemKeys: rows.map((row) => row.id),
    });
    this.#database.prepare('INSERT OR IGNORE INTO unsubscribe_runs(job_id, scan_id, created_at) VALUES (?, ?, ?)')
      .run(job.id, scanId, this.#now());
    return this.getByScan(scanId);
  }

  action(candidateId: string): SubscriptionAction {
    const row = this.#database.prepare(`
      SELECT sc.id, sc.endpoint, sc.eligibility FROM subscription_candidates sc
      JOIN subscription_scans ss ON ss.id = sc.scan_id
      WHERE sc.id = ? AND ss.profile_id = ?
    `).get(candidateId, this.#profileId) as { id: string; endpoint: string | null; eligibility: string } | undefined;
    if (!row || row.eligibility !== 'eligible' || !row.endpoint) throw new Error('unsubscribe_candidate_ineligible');
    return { id: row.id, endpoint: row.endpoint, eligibility: 'eligible' };
  }

  mark(candidateId: string, status: 'unsubscribed' | 'failed'): void {
    this.#database.prepare('UPDATE subscription_candidates SET status = ? WHERE id = ?').run(status, candidateId);
  }

  scanIdForJob(jobId: string): string {
    const row = this.#database.prepare('SELECT scan_id FROM unsubscribe_runs WHERE job_id = ?').get(jobId) as { scan_id: string } | undefined;
    if (!row) throw new Error('Unsubscribe run was not found');
    return row.scan_id;
  }
}
