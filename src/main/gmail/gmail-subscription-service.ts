import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { MailCategory } from '../../shared/contracts/analysis';
import { type SubscriptionDashboard, subscriptionDashboardSchema } from '../../shared/contracts/unsubscribe';
import { postOneClickUnsubscribe } from '../unsubscribe/unsubscribe-runner';

interface Row { analysis_id: string; category: MailCategory; sender_domain: string; receiving_addresses_json: string; subject: string | null; received_at: string | null; headers_json: string }
interface Group { senderDomain: string; listId: string; address: string; endpoint: string | null; oneClick: boolean; authenticated: boolean; count: number; latest: string | null; categories: Set<MailCategory>; subjects: string[] }
const httpsEndpoint = (value: string | undefined): string | null => {
  if (!value) return null;
  for (const match of value.matchAll(/<([^>]+)>|([^,\s]+)/g)) {
    try { const url = new URL((match[1] ?? match[2] ?? '').trim()); if (url.protocol === 'https:' && !url.username && !url.password) return url.toString(); } catch { /* malformed endpoint */ }
  }
  return null;
};

export class GmailSubscriptionService {
  readonly #database: BetterSqlite3.Database; readonly #profileId: string; readonly #now: () => string; readonly #createId: () => string; readonly #post: (url: string) => Promise<boolean>;
  constructor(database: BetterSqlite3.Database, profileId: string, options: { now?: () => string; createId?: () => string; post?: (url: string) => Promise<boolean> } = {}) {
    this.#database = database; this.#profileId = profileId; this.#now = options.now ?? (() => new Date().toISOString()); this.#createId = options.createId ?? randomUUID; this.#post = options.post ?? postOneClickUnsubscribe;
  }
  scan(connectionId: string): SubscriptionDashboard {
    const rows = this.#database.prepare(`SELECT gmc.analysis_id,gmc.category,gmc.sender_domain,gmc.receiving_addresses_json,gim.subject,gim.received_at,gim.headers_json FROM gmail_message_classifications gmc JOIN gmail_mailbox_analyses gma ON gma.id=gmc.analysis_id JOIN gmail_indexed_messages gim ON gim.id=gmc.message_row_id WHERE gma.connection_id=? AND gma.profile_id=?`).all(connectionId, this.#profileId) as Row[];
    if (!rows.length) throw new Error('gmail_analysis_required');
    const analysisId = rows[0]!.analysis_id; const groups = new Map<string, Group>();
    for (const row of rows) {
      const headers = JSON.parse(row.headers_json) as Record<string, string>;
      if (!headers['list-id'] && !headers['list-unsubscribe'] && !['subscriptions', 'promotions', 'spam', 'suspicious'].includes(row.category)) continue;
      const listId = (headers['list-id'] ?? row.sender_domain).replace(/[<>]/g, '').trim().toLowerCase().slice(0, 320);
      const addresses = JSON.parse(row.receiving_addresses_json) as string[];
      for (const address of addresses.length ? addresses : ['unknown']) {
        const key = `${listId}\0${row.sender_domain}\0${address}`;
        const group = groups.get(key) ?? { senderDomain: row.sender_domain, listId, address, endpoint: null, oneClick: false, authenticated: false, count: 0, latest: null, categories: new Set<MailCategory>(), subjects: [] };
        group.count += 1; group.categories.add(row.category);
        if (row.received_at && (!group.latest || row.received_at > group.latest)) group.latest = row.received_at;
        if (row.subject && group.subjects.length < 3 && !group.subjects.includes(row.subject)) group.subjects.push(row.subject.slice(0, 180));
        group.endpoint ??= httpsEndpoint(headers['list-unsubscribe']);
        group.oneClick ||= /list-unsubscribe\s*=\s*one-click/i.test(headers['list-unsubscribe-post'] ?? '');
        const auth = (headers['authentication-results'] ?? '').toLowerCase(); group.authenticated ||= /dkim=pass/.test(auth) && /(?:dmarc|spf)=pass/.test(auth); groups.set(key, group);
      }
    }
    const scanId = this.#createId(); const generatedAt = this.#now(); const protectedCategories = new Set<MailCategory>(['security', 'accounts', 'transactions', 'finance']);
    this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM gmail_subscription_scans WHERE analysis_id=?').run(analysisId);
      this.#database.prepare('INSERT INTO gmail_subscription_scans(id,analysis_id,profile_id,generated_at) VALUES (?,?,?,?)').run(scanId, analysisId, this.#profileId, generatedAt);
      const add = this.#database.prepare('INSERT INTO gmail_subscription_candidates(id,scan_id,sender_domain,list_id,receiving_address,endpoint,eligibility,authenticated,message_count,latest_at,categories_json,sample_subjects_json,status,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const group of groups.values()) {
        const categories = [...group.categories].sort(); let eligibility: 'eligible' | 'manual' | 'protected' | 'spam_skipped'; let status: 'pending' | 'manual' | 'spam_skipped'; let reason: string;
        if (categories.some((item) => item === 'spam' || item === 'suspicious')) { eligibility = 'spam_skipped'; status = 'spam_skipped'; reason = 'Likely spam is never contacted; use native Spam handling instead.'; }
        else if (categories.some((item) => protectedCategories.has(item))) { eligibility = 'protected'; status = 'manual'; reason = 'Transactional, security, account, or finance mail is protected from bulk unsubscribe.'; }
        else if (group.endpoint && group.oneClick && group.authenticated) { eligibility = 'eligible'; status = 'pending'; reason = 'Authenticated RFC 8058 HTTPS one-click endpoint.'; }
        else { eligibility = 'manual'; status = 'manual'; reason = !group.authenticated ? 'Sender authentication is insufficient for an automated request.' : 'No authenticated RFC 8058 one-click HTTPS endpoint was found.'; }
        add.run(this.#createId(), scanId, group.senderDomain, group.listId, group.address, group.endpoint, eligibility, group.authenticated ? 1 : 0, group.count, group.latest, JSON.stringify(categories), JSON.stringify(group.subjects), status, reason);
      }
    })();
    return this.getByScan(scanId);
  }
  getCurrent(connectionId: string): SubscriptionDashboard | null {
    const row = this.#database.prepare('SELECT gss.id FROM gmail_subscription_scans gss JOIN gmail_mailbox_analyses gma ON gma.id=gss.analysis_id WHERE gma.connection_id=? AND gss.profile_id=? ORDER BY gss.rowid DESC LIMIT 1').get(connectionId, this.#profileId) as { id: string } | undefined;
    return row ? this.getByScan(row.id) : null;
  }
  getByScan(scanId: string): SubscriptionDashboard {
    const scan = this.#database.prepare('SELECT * FROM gmail_subscription_scans WHERE id=? AND profile_id=?').get(scanId, this.#profileId) as { analysis_id: string; generated_at: string } | undefined;
    if (!scan) throw new Error('gmail_subscription_scan_missing');
    const rows = this.#database.prepare('SELECT * FROM gmail_subscription_candidates WHERE scan_id=? ORDER BY message_count DESC,sender_domain').all(scanId) as Array<Record<string, unknown>>;
    return subscriptionDashboardSchema.parse({ analysisId: scan.analysis_id, generatedAt: scan.generated_at, candidates: rows.map((row) => ({ id: row.id, senderDomain: row.sender_domain, listId: row.list_id, receivingAddress: row.receiving_address, eligibility: row.eligibility, authenticated: Boolean(row.authenticated), messageCount: row.message_count, latestAt: row.latest_at, categories: JSON.parse(String(row.categories_json)), sampleSubjects: JSON.parse(String(row.sample_subjects_json)), status: row.status, reason: row.reason })), job: null });
  }
  async start(candidateIds: string[]): Promise<SubscriptionDashboard> {
    if (!candidateIds.length) throw new Error('unsubscribe_selection_invalid'); const placeholders = candidateIds.map(() => '?').join(',');
    const rows = this.#database.prepare(`SELECT * FROM gmail_subscription_candidates WHERE id IN (${placeholders}) AND eligibility='eligible'`).all(...candidateIds) as Array<{ id: string; scan_id: string; endpoint: string }>;
    if (rows.length !== candidateIds.length || new Set(rows.map((row) => row.scan_id)).size !== 1) throw new Error('unsubscribe_selection_invalid');
    for (const row of rows) { try { const ok = await this.#post(row.endpoint); this.#database.prepare('UPDATE gmail_subscription_candidates SET status=? WHERE id=?').run(ok ? 'unsubscribed' : 'failed', row.id); } catch { this.#database.prepare("UPDATE gmail_subscription_candidates SET status='failed' WHERE id=?").run(row.id); } }
    return this.getByScan(rows[0]!.scan_id);
  }
}
