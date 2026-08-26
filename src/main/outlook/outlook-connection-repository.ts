import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  outlookConnectionSummarySchema,
  type OutlookConnectionSummary,
  type OutlookOAuthInput,
} from "../../shared/contracts/outlook";
import type { SecretVault } from "../secrets/secret-vault";
interface Row {
  id: string;
  profile_id: string;
  email: string;
  client_id: string;
  tenant: string;
  secret_ref_id: string;
  state: "connected" | "attention";
  connected_at: string;
  updated_at: string;
}
export class OutlookConnectionRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #vault: SecretVault;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;
  constructor(
    database: BetterSqlite3.Database,
    vault: SecretVault,
    profileId: string,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#database = database;
    this.#vault = vault;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }
  get() {
    const row = this.#row();
    return row ? this.#summary(row) : null;
  }
  list() {
    return (
      this.#database
        .prepare(
          "SELECT * FROM outlook_connections WHERE profile_id=? ORDER BY updated_at DESC,email",
        )
        .all(this.#profileId) as Row[]
    ).map((row) => this.#summary(row));
  }
  getById(id: string) {
    const row = this.#row(id);
    return row ? this.#summary(row) : null;
  }
  credentials(id?: string) {
    const row = this.#row(id);
    if (!row) return null;
    const secret = JSON.parse(
      this.#vault.read(this.#profileId, row.secret_ref_id),
    ) as { refreshToken: string };
    return {
      connection: this.#summary(row),
      refreshToken: secret.refreshToken,
    };
  }
  save(input: OutlookOAuthInput, email: string, refreshToken: string) {
    const normalized = email.toLowerCase();
    const previous = this.#database
      .prepare(
        "SELECT * FROM outlook_connections WHERE profile_id=? AND email=?",
      )
      .get(this.#profileId, normalized) as Row | undefined;
    const secret = this.#vault.store(
      this.#profileId,
      "outlook.oauth.refresh",
      JSON.stringify({ refreshToken }),
    );
    const id = previous?.id ?? this.#createId();
    const now = this.#now();
    try {
      this.#database
        .prepare(
          "INSERT INTO outlook_connections(id,profile_id,email,client_id,tenant,secret_ref_id,state,connected_at,updated_at)VALUES(?,?,?,?,?,?,'connected',?,?) ON CONFLICT(profile_id,email)DO UPDATE SET client_id=excluded.client_id,tenant=excluded.tenant,secret_ref_id=excluded.secret_ref_id,state='connected',connected_at=excluded.connected_at,updated_at=excluded.updated_at",
        )
        .run(
          id,
          this.#profileId,
          normalized,
          input.clientId,
          input.tenant,
          secret.id,
          now,
          now,
        );
    } catch (error) {
      this.#vault.delete(this.#profileId, secret.id);
      throw error;
    }
    if (previous) this.#vault.delete(this.#profileId, previous.secret_ref_id);
    this.select(id);
    return this.getById(id)!;
  }
  select(id: string) {
    const row = this.#row(id);
    if (!row) throw new Error("outlook_connection_not_found");
    this.#database
      .prepare(
        "INSERT INTO account_selections(profile_id,provider,connection_id,updated_at)VALUES(?,'outlook',?,?)ON CONFLICT(profile_id,provider)DO UPDATE SET connection_id=excluded.connection_id,updated_at=excluded.updated_at",
      )
      .run(this.#profileId, id, this.#now());
    return this.#summary(row);
  }
  disconnect(id: string) {
    const row = this.#row(id);
    if (!row) throw new Error("outlook_connection_not_found");
    this.#database
      .prepare("DELETE FROM outlook_connections WHERE id=? AND profile_id=?")
      .run(id, this.#profileId);
    this.#vault.delete(this.#profileId, row.secret_ref_id);
    this.#database
      .prepare(
        "DELETE FROM account_selections WHERE profile_id=? AND provider='outlook' AND connection_id=?",
      )
      .run(this.#profileId, id);
  }
  #row(id?: string): Row | null {
    if (id)
      return (
        (this.#database
          .prepare(
            "SELECT * FROM outlook_connections WHERE id=? AND profile_id=?",
          )
          .get(id, this.#profileId) as Row | undefined) ?? null
      );
    return (
      (this.#database
        .prepare(
          "SELECT oc.* FROM outlook_connections oc LEFT JOIN account_selections s ON s.profile_id=oc.profile_id AND s.provider='outlook' AND s.connection_id=oc.id WHERE oc.profile_id=? ORDER BY CASE WHEN s.connection_id IS NULL THEN 1 ELSE 0 END,oc.updated_at DESC LIMIT 1",
        )
        .get(this.#profileId) as Row | undefined) ?? null
    );
  }
  #summary(row: Row): OutlookConnectionSummary {
    return outlookConnectionSummarySchema.parse({
      id: row.id,
      email: row.email,
      clientId: row.client_id,
      tenant: row.tenant,
      connectedAt: row.connected_at,
      state: row.state,
    });
  }
}
