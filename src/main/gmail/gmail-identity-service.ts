import type BetterSqlite3 from 'better-sqlite3';
import type { AccountIdentitySummary } from '../../shared/contracts/accounts';
import { AccountIdentityRepository } from '../identity/account-identity-repository';
import { gmailIdentityEvidence } from '../identity/ownership-evidence';
import type { GmailConnectionRepository } from './gmail-connection-repository';
import { refreshGmailAccessToken, type OAuthFetch } from './gmail-oauth';

export class GmailIdentityService {
  readonly #database: BetterSqlite3.Database;
  readonly #connections: GmailConnectionRepository;
  readonly #identities: AccountIdentityRepository;
  readonly #fetch: OAuthFetch;

  constructor(database: BetterSqlite3.Database, connections: GmailConnectionRepository, profileId: string, fetchPort: OAuthFetch = fetch) {
    this.#database = database;
    this.#connections = connections;
    this.#identities = new AccountIdentityRepository(database, profileId);
    this.#fetch = fetchPort;
  }

  syncLocal(connectionId: string): AccountIdentitySummary[] {
    const connection = this.#connections.getById(connectionId);
    if (!connection) throw new Error('gmail_connection_not_found');
    return this.#identities.sync(
      'gmail',
      connection.id,
      gmailIdentityEvidence(this.#database, connection.id, connection.email),
    );
  }

  async refresh(connectionId: string): Promise<AccountIdentitySummary[]> {
    const credentials = this.#connections.credentials(connectionId);
    if (!credentials) throw new Error('gmail_connection_not_found');
    const token = await refreshGmailAccessToken(
      credentials.connection.clientId,
      credentials.refreshToken,
      credentials.clientSecret,
      this.#fetch,
    );
    const response = await this.#fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('gmail_send_as_failed');
    const payload = await response.json() as { sendAs?: Array<{ sendAsEmail?: string }> };
    const aliases = (payload.sendAs ?? [])
      .map((item) => item.sendAsEmail)
      .filter((address): address is string => Boolean(address && address.toLowerCase() !== credentials.connection.email));
    return this.#identities.sync(
      'gmail',
      credentials.connection.id,
      gmailIdentityEvidence(this.#database, credentials.connection.id, credentials.connection.email, aliases),
    );
  }
}
