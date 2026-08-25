import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { GmailAuditSummary } from '../../shared/contracts/gmail';
import { gmailAuditSummarySchema } from '../../shared/contracts/gmail';
import { refreshGmailAccessToken, type OAuthFetch } from './gmail-oauth';
import type { GmailConnectionRepository } from './gmail-connection-repository';

interface GmailList { messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string; resultSizeEstimate?: number }
interface GmailMessage { id: string; threadId: string; internalDate?: string; labelIds?: string[]; sizeEstimate?: number; payload?: { headers?: Array<{ name: string; value: string }> } }
const wantedHeaders = ['Message-ID', 'Date', 'Subject', 'From', 'To', 'Cc', 'Bcc', 'Delivered-To', 'X-Original-To', 'List-ID', 'List-Unsubscribe', 'List-Unsubscribe-Post', 'Authentication-Results'];
const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const addresses = (value: string | undefined): string[] => [...new Set((value?.match(emailPattern) ?? []).map((item) => item.toLowerCase()))];

export class GmailAuditService {
  readonly #database: BetterSqlite3.Database;
  readonly #connections: GmailConnectionRepository;
  readonly #fetch: OAuthFetch;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(database: BetterSqlite3.Database, connections: GmailConnectionRepository, options: { fetchPort?: OAuthFetch; now?: () => string; createId?: () => string } = {}) {
    this.#database = database; this.#connections = connections; this.#fetch = options.fetchPort ?? fetch;
    this.#now = options.now ?? (() => new Date().toISOString()); this.#createId = options.createId ?? randomUUID;
  }

  get(treatScanningAsPaused = true): GmailAuditSummary | null {
    const connection = this.#connections.get(); if (!connection) return null;
    const row = this.#database.prepare('SELECT * FROM gmail_audit_state WHERE connection_id = ?').get(connection.id) as Record<string, unknown> | undefined;
    if (!row) return gmailAuditSummarySchema.parse({ connectionId: connection.id, state: 'idle', indexedMessages: 0, totalEstimate: 0, earliestAt: null, latestAt: null, updatedAt: connection.connectedAt });
    return gmailAuditSummarySchema.parse({ connectionId: connection.id, state: treatScanningAsPaused && row.state === 'scanning' ? 'paused' : row.state, indexedMessages: row.indexed_messages, totalEstimate: row.total_estimate, earliestAt: row.earliest_at, latestAt: row.latest_at, updatedAt: row.updated_at });
  }

  async run(onProgress: (summary: GmailAuditSummary) => void = () => undefined): Promise<GmailAuditSummary> {
    const credentials = this.#connections.credentials(); if (!credentials) throw new Error('gmail_not_connected');
    const connectionId = credentials.connection.id;
    const existing = this.#database.prepare('SELECT * FROM gmail_audit_state WHERE connection_id = ?').get(connectionId) as { state: string; next_page_token: string | null } | undefined;
    if (!existing || existing.state === 'completed') {
      this.#database.transaction(() => {
        this.#database.prepare('DELETE FROM gmail_indexed_messages WHERE connection_id = ?').run(connectionId);
        this.#database.prepare(`INSERT INTO gmail_audit_state(connection_id,state,next_page_token,indexed_messages,total_estimate,earliest_at,latest_at,updated_at) VALUES (?, 'idle', NULL, 0, 0, NULL, NULL, ?) ON CONFLICT(connection_id) DO UPDATE SET state='idle',next_page_token=NULL,indexed_messages=0,total_estimate=0,earliest_at=NULL,latest_at=NULL,updated_at=excluded.updated_at`).run(connectionId, this.#now());
      })();
    }
    this.#database.prepare("UPDATE gmail_audit_state SET state='scanning', updated_at=? WHERE connection_id=?").run(this.#now(), connectionId);
    let pageToken = (this.#database.prepare('SELECT next_page_token FROM gmail_audit_state WHERE connection_id=?').get(connectionId) as { next_page_token: string | null }).next_page_token;
    try {
      const token = await refreshGmailAccessToken(credentials.connection.clientId, credentials.refreshToken, credentials.clientSecret, this.#fetch);
      do {
        const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
        url.searchParams.set('maxResults', '500'); url.searchParams.set('includeSpamTrash', 'true');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const listResponse = await this.#fetch(url, { headers: { authorization: `Bearer ${token}` } });
        if (!listResponse.ok) throw new Error('gmail_list_failed');
        const list = await listResponse.json() as GmailList;
        const refs = list.messages ?? [];
        for (let offset = 0; offset < refs.length; offset += 10) {
          const batch = refs.slice(offset, offset + 10);
          const messages = await Promise.all(batch.map(async (ref) => {
            const detail = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}`);
            detail.searchParams.set('format', 'metadata'); for (const header of wantedHeaders) detail.searchParams.append('metadataHeaders', header);
            const response = await this.#fetch(detail, { headers: { authorization: `Bearer ${token}` } });
            if (!response.ok) throw new Error('gmail_message_failed'); return await response.json() as GmailMessage;
          }));
          this.#store(connectionId, messages);
        }
        pageToken = list.nextPageToken ?? null;
        const total = Math.max(list.resultSizeEstimate ?? 0, (this.#database.prepare('SELECT COUNT(*) AS count FROM gmail_indexed_messages WHERE connection_id=?').get(connectionId) as { count: number }).count);
        this.#database.prepare(`UPDATE gmail_audit_state SET next_page_token=?, indexed_messages=(SELECT COUNT(*) FROM gmail_indexed_messages WHERE connection_id=?), total_estimate=?, earliest_at=(SELECT MIN(received_at) FROM gmail_indexed_messages WHERE connection_id=?), latest_at=(SELECT MAX(received_at) FROM gmail_indexed_messages WHERE connection_id=?), updated_at=? WHERE connection_id=?`).run(pageToken, connectionId, total, connectionId, connectionId, this.#now(), connectionId);
        onProgress(this.get(false)!);
      } while (pageToken);
      this.#database.prepare("UPDATE gmail_audit_state SET state='completed', updated_at=? WHERE connection_id=?").run(this.#now(), connectionId);
      return this.get()!;
    } catch (error) {
      this.#database.prepare("UPDATE gmail_audit_state SET state='failed', updated_at=? WHERE connection_id=?").run(this.#now(), connectionId);
      throw error;
    }
  }

  #store(connectionId: string, messages: GmailMessage[]): void {
    const insert = this.#database.prepare(`INSERT INTO gmail_indexed_messages(id,connection_id,gmail_message_id,thread_id,received_at,subject,sender_json,recipients_json,headers_json,label_ids_json,size_bytes,indexed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,gmail_message_id) DO UPDATE SET thread_id=excluded.thread_id,received_at=excluded.received_at,subject=excluded.subject,sender_json=excluded.sender_json,recipients_json=excluded.recipients_json,headers_json=excluded.headers_json,label_ids_json=excluded.label_ids_json,size_bytes=excluded.size_bytes,indexed_at=excluded.indexed_at`);
    const now = this.#now();
    this.#database.transaction(() => { for (const message of messages) {
      const headers = Object.fromEntries((message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
      const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
      insert.run(this.#createId(), connectionId, message.id, message.threadId, receivedAt, headers.subject ?? null, JSON.stringify(addresses(headers.from)), JSON.stringify([...new Set(['to','cc','bcc'].flatMap((name) => addresses(headers[name])))]), JSON.stringify(headers), JSON.stringify(message.labelIds ?? []), message.sizeEstimate ?? 0, now);
    } })();
  }
}
