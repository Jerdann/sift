import type BetterSqlite3 from "better-sqlite3";
import type { AccountIdentitySummary } from "../../shared/contracts/accounts";
import { AccountIdentityRepository } from "../identity/account-identity-repository";
import { outlookIdentityEvidence } from "../identity/ownership-evidence";
import type { OutlookConnectionRepository } from "./outlook-connection-repository";
import { refreshOutlookAccessToken, type OutlookFetch } from "./outlook-oauth";

interface GraphProfile {
  mail?: string;
  userPrincipalName?: string;
  otherMails?: string[];
  proxyAddresses?: string[];
}

const proxyEmail = (value: string): string =>
  value.replace(/^smtp:/i, "").toLowerCase();

export class OutlookIdentityService {
  readonly #database: BetterSqlite3.Database;
  readonly #connections: OutlookConnectionRepository;
  readonly #identities: AccountIdentityRepository;
  readonly #fetch: OutlookFetch;

  constructor(
    database: BetterSqlite3.Database,
    connections: OutlookConnectionRepository,
    profileId: string,
    fetchPort: OutlookFetch = fetch,
  ) {
    this.#database = database;
    this.#connections = connections;
    this.#identities = new AccountIdentityRepository(database, profileId);
    this.#fetch = fetchPort;
  }

  syncLocal(connectionId: string): AccountIdentitySummary[] {
    const connection = this.#connections.getById(connectionId);
    if (!connection) throw new Error("outlook_connection_not_found");
    return this.#identities.sync(
      "outlook",
      connection.id,
      outlookIdentityEvidence(this.#database, connection.id, connection.email),
    );
  }

  async refresh(connectionId: string): Promise<AccountIdentitySummary[]> {
    const credentials = this.#connections.credentials(connectionId);
    if (!credentials) throw new Error("outlook_connection_not_found");
    const token = await refreshOutlookAccessToken(
      credentials.connection.clientId,
      credentials.connection.tenant,
      credentials.refreshToken,
      this.#fetch,
    );
    const response = await this.#fetch(
      "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,otherMails,proxyAddresses",
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error("outlook_profile_aliases_failed");
    const profile = (await response.json()) as GraphProfile;
    const aliases = [
      ...new Set(
        [
          ...(profile.otherMails ?? []),
          ...(profile.proxyAddresses ?? []).map(proxyEmail),
          ...(profile.mail ? [profile.mail] : []),
          ...(profile.userPrincipalName ? [profile.userPrincipalName] : []),
        ].map((value) => value.toLowerCase()),
      ),
    ].filter((value) => value !== credentials.connection.email);
    return this.#identities.sync(
      "outlook",
      credentials.connection.id,
      outlookIdentityEvidence(
        this.#database,
        credentials.connection.id,
        credentials.connection.email,
        aliases,
      ),
    );
  }
}
