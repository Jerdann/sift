import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { subscriptionPriorityScore } from '../../core/pruning/subscription-ranking';
import type { MailCategory } from '../../shared/contracts/analysis';
import { type SubscriptionDashboard, subscriptionDashboardSchema } from '../../shared/contracts/unsubscribe';
import type { JobRepository } from '../jobs/job-repository';

interface Row {
  analysis_id: string;
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
  address: string;
  endpoint: string | null;
  oneClick: boolean;
  authenticated: boolean;
  count: number;
  latest: string | null;
  categories: Set<MailCategory>;
  subjects: string[];
}

const httpsEndpoint = (value: string | undefined): string | null => {
  if (!value) return null;
  for (const match of value.matchAll(/<([^>]+)>|([^,\s]+)/g)) {
    try {
      const url = new URL((match[1] ?? match[2] ?? '').trim());
      if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
    } catch { /* malformed endpoint */ }
  }
  return null;
};

export class GmailSubscriptionService {
  readonly #database: BetterSqlite3.Database;
  readonly #jobs: JobRepository;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(database: BetterSqlite3.Database, jobs: JobRepository, profileId: string, options: { now?: () => string; createId?: () => string } = {}) {
    this.#database = database;
    this.#jobs = jobs;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  get profileId(): string { return this.#profileId; }

  scan(connectionId: string): SubscriptionDashboard {
    const rows = this.#database.prepare(`
      SELECT gmc.analysis_id,gmc.category,gmc.sender_domain,gmc.receiving_addresses_json,
        gim.subject,gim.received_at,gim.headers_json
      FROM gmail_message_classifications gmc
      JOIN gmail_mailbox_analyses gma ON gma.id=gmc.analysis_id
      JOIN gmail_indexed_messages gim ON gim.id=gmc.message_row_id
      WHERE gma.connection_id=? AND gma.profile_id=?
    `).all(connectionId, this.#profileId) as Row[];
    if (!rows.length) throw new Error('gmail_analysis_required');
    const analysisId = rows[0]!.analysis_id;
    const active = this.#database.prepare(`
      SELECT 1 FROM gmail_subscription_scans gss JOIN gmail_unsubscribe_runs gur ON gur.scan_id=gss.id
      JOIN jobs j ON j.id=gur.job_id WHERE gss.analysis_id=? AND gss.profile_id=? AND j.state IN ('pending','running') LIMIT 1
    `).get(analysisId, this.#profileId);
    if (active) throw new Error('unsubscribe_run_active');
    const groups = new Map<string, Group>();
    for (const row of rows) {
      const headers = JSON.parse(row.headers_json) as Record<string, string>;
      if (!headers['list-id'] && !headers['list-unsubscribe'] && !['subscriptions', 'promotions', 'spam', 'suspicious'].includes(row.category)) continue;
      const listId = (headers['list-id'] ?? row.sender_domain).replace(/[<>]/g, '').trim().toLowerCase().slice(0, 320);
      const addresses = JSON.parse(row.receiving_addresses_json) as string[];
      for (const address of addresses.length ? addresses : ['unknown']) {
        const key = `${listId}\0${row.sender_domain}\0${address}`;
        const group = groups.get(key) ?? { senderDomain: row.sender_domain, listId, address, endpoint: null, oneClick: false, authenticated: false, count: 0, latest: null, categories: new Set<MailCategory>(), subjects: [] };
        group.count += 1;
        group.categories.add(row.category);
        if (row.received_at && (!group.latest || row.received_at > group.latest)) group.latest = row.received_at;
        if (row.subject && group.subjects.length < 3 && !group.subjects.includes(row.subject)) group.subjects.push(row.subject.slice(0, 180));
        group.endpoint ??= httpsEndpoint(headers['list-unsubscribe']);
        group.oneClick ||= /list-unsubscribe\s*=\s*one-click/i.test(headers['list-unsubscribe-post'] ?? '');
        const auth = (headers['authentication-results'] ?? '').toLowerCase();
        group.authenticated ||= /dkim=pass/.test(auth) && /(?:dmarc|spf)=pass/.test(auth);
        groups.set(key, group);
      }
    }
    const scanId = this.#createId();
    const generatedAt = this.#now();
    const protectedCategories = new Set<MailCategory>(['security', 'accounts', 'transactions', 'finance']);
    this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM gmail_subscription_scans WHERE analysis_id=?').run(analysisId);
      this.#database.prepare('INSERT INTO gmail_subscription_scans(id,analysis_id,profile_id,generated_at) VALUES (?,?,?,?)').run(scanId, analysisId, this.#profileId, generatedAt);
      const add = this.#database.prepare('INSERT INTO gmail_subscription_candidates(id,scan_id,sender_domain,list_id,receiving_address,endpoint,eligibility,authenticated,message_count,latest_at,categories_json,sample_subjects_json,status,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const group of groups.values()) {
        const categories = [...group.categories].sort();
        let eligibility: 'eligible' | 'manual' | 'protected' | 'spam_skipped';
        let status: 'pending' | 'manual' | 'spam_skipped';
        let reason: string;
        if (categories.some((item) => item === 'spam' || item === 'suspicious')) {
          eligibility = 'spam_skipped'; status = 'spam_skipped'; reason = 'Likely spam is never contacted; use native Spam handling instead.';
        } else if (categories.some((item) => protectedCategories.has(item))) {
          eligibility = 'protected'; status = 'manual'; reason = 'Transactional, security, account, or finance mail is protected from bulk unsubscribe.';
        } else if (group.endpoint && group.oneClick && group.authenticated) {
          eligibility = 'eligible'; status = 'pending'; reason = 'Authenticated RFC 8058 HTTPS one-click endpoint.';
        } else {
          eligibility = 'manual'; status = 'manual'; reason = !group.authenticated
            ? 'Sender authentication is insufficient for an automated request.'
            : 'No authenticated RFC 8058 one-click HTTPS endpoint was found.';
        }
        add.run(this.#createId(), scanId, group.senderDomain, group.listId, group.address, group.endpoint, eligibility, group.authenticated ? 1 : 0, group.count, group.latest, JSON.stringify(categories), JSON.stringify(group.subjects), status, reason);
      }
    })();
    return this.getByScan(scanId);
  }

  getCurrent(connectionId: string): SubscriptionDashboard | null {
    const row = this.#database.prepare('SELECT gss.id FROM gmail_subscription_scans gss JOIN gmail_mailbox_analyses gma ON gma.id=gss.analysis_id WHERE gma.connection_id=? AND gss.profile_id=? ORDER BY gss.rowid DESC LIMIT 1')
      .get(connectionId, this.#profileId) as { id: string } | undefined;
    return row ? this.getByScan(row.id) : null;
  }

  getByScan(scanId: string): SubscriptionDashboard {
    const scan = this.#database.prepare('SELECT * FROM gmail_subscription_scans WHERE id=? AND profile_id=?').get(scanId, this.#profileId) as { analysis_id: string; generated_at: string } | undefined;
    if (!scan) throw new Error('gmail_subscription_scan_missing');
    const connection = this.#database.prepare('SELECT gma.connection_id FROM gmail_subscription_scans gss JOIN gmail_mailbox_analyses gma ON gma.id=gss.analysis_id WHERE gss.id=?').get(scanId) as { connection_id: string };
    const rows = this.#database.prepare('SELECT * FROM gmail_subscription_candidates WHERE scan_id=?').all(scanId) as Array<Record<string, unknown>>;
    const ledgerRows = this.#database.prepare("SELECT list_id,receiving_address,requested_at FROM unsubscribe_ledger WHERE profile_id=? AND provider='gmail' AND connection_id=?")
      .all(this.#profileId, connection.connection_id) as Array<{ list_id: string; receiving_address: string; requested_at: string }>;
    const ledger = new Map(ledgerRows.map((row) => [`${row.list_id}\0${row.receiving_address}`, row]));
    const jobRow = this.#database.prepare('SELECT job_id FROM gmail_unsubscribe_runs WHERE scan_id=? ORDER BY rowid DESC LIMIT 1').get(scanId) as { job_id: string } | undefined;
    return subscriptionDashboardSchema.parse({
      analysisId: scan.analysis_id,
      generatedAt: scan.generated_at,
      candidates: rows.map((row) => {
        const categories = JSON.parse(String(row.categories_json)) as MailCategory[];
        const prior = ledger.get(`${row.list_id}\0${row.receiving_address}`);
        const recurrence = prior ? row.latest_at && String(row.latest_at) > prior.requested_at ? 'recurring' : 'quiet' : 'never_requested';
        return {
          id: String(row.id), senderDomain: String(row.sender_domain), listId: String(row.list_id), receivingAddress: String(row.receiving_address),
          eligibility: row.eligibility, authenticated: Boolean(row.authenticated), messageCount: Number(row.message_count),
          latestAt: row.latest_at ? String(row.latest_at) : null,
          priorityScore: subscriptionPriorityScore(Number(row.message_count), row.latest_at ? String(row.latest_at) : null, categories),
          requestedAt: prior?.requested_at ?? null, recurrence, categories,
          sampleSubjects: JSON.parse(String(row.sample_subjects_json)), status: row.status,
          reason: recurrence === 'recurring' ? `${row.reason} New mail arrived after the last verified request.` : row.reason,
        };
      }).sort((left, right) => right.priorityScore - left.priorityScore || right.messageCount - left.messageCount || left.senderDomain.localeCompare(right.senderDomain)),
      job: jobRow ? this.#jobs.getProgress(jobRow.job_id) : null,
    });
  }

  start(candidateIds: readonly string[]): SubscriptionDashboard {
    if (!candidateIds.length) throw new Error('unsubscribe_selection_invalid');
    const placeholders = candidateIds.map(() => '?').join(',');
    const rows = this.#database.prepare(`
      SELECT gsc.id,gsc.scan_id FROM gmail_subscription_candidates gsc
      JOIN gmail_subscription_scans gss ON gss.id=gsc.scan_id
      WHERE gsc.id IN (${placeholders}) AND gsc.eligibility='eligible' AND gss.profile_id=?
    `).all(...candidateIds, this.#profileId) as Array<{ id: string; scan_id: string }>;
    if (rows.length !== candidateIds.length || new Set(rows.map((row) => row.scan_id)).size !== 1) throw new Error('unsubscribe_selection_invalid');
    const scanId = rows[0]!.scan_id;
    const job = this.#jobs.createJob({ profileId: this.#profileId, kind: 'bulk-unsubscribe', idempotencyKey: `gmail-unsubscribe:${scanId}:${[...candidateIds].sort().join(',')}`, itemKeys: rows.map((row) => row.id) });
    this.#database.prepare('INSERT OR IGNORE INTO gmail_unsubscribe_runs(job_id,scan_id,created_at) VALUES (?,?,?)').run(job.id, scanId, this.#now());
    return this.getByScan(scanId);
  }

  action(candidateId: string): { id: string; endpoint: string; eligibility: 'eligible' } {
    const row = this.#database.prepare(`
      SELECT gsc.id,gsc.endpoint,gsc.eligibility FROM gmail_subscription_candidates gsc
      JOIN gmail_subscription_scans gss ON gss.id=gsc.scan_id WHERE gsc.id=? AND gss.profile_id=?
    `).get(candidateId, this.#profileId) as { id: string; endpoint: string | null; eligibility: string } | undefined;
    if (!row || row.eligibility !== 'eligible' || !row.endpoint) throw new Error('unsubscribe_candidate_ineligible');
    return { id: row.id, endpoint: row.endpoint, eligibility: 'eligible' };
  }

  mark(candidateId: string, status: 'unsubscribed' | 'failed'): void {
    this.#database.transaction(() => {
      this.#database.prepare('UPDATE gmail_subscription_candidates SET status=? WHERE id=?').run(status, candidateId);
      if (status !== 'unsubscribed') return;
      const row = this.#database.prepare(`
        SELECT gsc.list_id,gsc.receiving_address,gsc.latest_at,gma.connection_id
        FROM gmail_subscription_candidates gsc JOIN gmail_subscription_scans gss ON gss.id=gsc.scan_id
        JOIN gmail_mailbox_analyses gma ON gma.id=gss.analysis_id WHERE gsc.id=? AND gss.profile_id=?
      `).get(candidateId, this.#profileId) as { list_id: string; receiving_address: string; latest_at: string | null; connection_id: string } | undefined;
      if (!row) throw new Error('unsubscribe_candidate_missing');
      this.#database.prepare(`
        INSERT INTO unsubscribe_ledger(id,profile_id,provider,connection_id,list_id,receiving_address,requested_at,latest_seen_at_request,updated_at)
        VALUES (?,?,'gmail',?,?,?,?,?,?)
        ON CONFLICT(profile_id,provider,connection_id,list_id,receiving_address) DO UPDATE SET
          recurrence_count=unsubscribe_ledger.recurrence_count + CASE WHEN excluded.latest_seen_at_request > unsubscribe_ledger.requested_at THEN 1 ELSE 0 END,
          requested_at=excluded.requested_at,latest_seen_at_request=excluded.latest_seen_at_request,updated_at=excluded.updated_at
      `).run(this.#createId(), this.#profileId, row.connection_id, row.list_id, row.receiving_address, this.#now(), row.latest_at, this.#now());
    })();
  }

  retry(jobId: string, candidateIds: readonly string[]): SubscriptionDashboard {
    const scanId = this.scanIdForJob(jobId);
    this.#jobs.retryItems(jobId, candidateIds);
    const placeholders = candidateIds.map(() => '?').join(',');
    this.#database.prepare(`UPDATE gmail_subscription_candidates SET status='pending' WHERE scan_id=? AND id IN (${placeholders})`).run(scanId, ...candidateIds);
    return this.getByScan(scanId);
  }

  scanIdForJob(jobId: string): string {
    const row = this.#database.prepare('SELECT scan_id FROM gmail_unsubscribe_runs WHERE job_id=?').get(jobId) as { scan_id: string } | undefined;
    if (!row) throw new Error('unsubscribe_run_missing');
    return row.scan_id;
  }
}
