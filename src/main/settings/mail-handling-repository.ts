import type BetterSqlite3 from "better-sqlite3";
import { createHash } from "node:crypto";
import type { AccountProvider } from "../../shared/contracts/accounts";
import {
  handlingPreferencesSchema,
  handlingSaveSchema,
  type HandlingPreferences,
  type HandlingSave,
  type HandlingScope,
  type HandlingState,
} from "../../shared/contracts/mail-handling";

export class MailHandlingRepository {
  constructor(
    private db: BetterSqlite3.Database,
    private profileId: string,
  ) {}
  private key(scope: HandlingScope): string {
    return scope.level === "profile"
      ? "*"
      : `${scope.provider}:${scope.connectionId}:${scope.level === "alias" ? (scope.address?.toLowerCase() ?? "") : "*"}`;
  }
  private read(key: string): HandlingPreferences | null {
    const row = this.db
      .prepare(
        "SELECT preferences_json FROM mail_handling_preferences WHERE profile_id=? AND scope_key=?",
      )
      .get(this.profileId, key) as { preferences_json: string } | undefined;
    return row
      ? handlingPreferencesSchema.parse(JSON.parse(row.preferences_json))
      : null;
  }
  resolve(
    provider: AccountProvider,
    connectionId: string,
    address: string | null = null,
  ): HandlingPreferences {
    const base = this.read("*") ?? handlingPreferencesSchema.parse({});
    const account = this.read(`${provider}:${connectionId}:*`);
    const alias = address
      ? this.read(`${provider}:${connectionId}:${address.toLowerCase()}`)
      : null;
    return [account, alias].reduce<HandlingPreferences>(
      (current, next) =>
        next
          ? {
              ...current,
              ...next,
              categories: { ...current.categories, ...next.categories },
            }
          : current,
      base,
    );
  }
  resolveDraft(
    input: HandlingSave,
    address: string | null,
  ): HandlingPreferences {
    const layers = [
      input.level === "profile" ? input.preferences : this.read("*"),
      input.level === "account"
        ? input.preferences
        : this.read(`${input.provider}:${input.connectionId}:*`),
      input.level === "alias" && input.address?.toLowerCase() === address
        ? input.preferences
        : address
          ? this.read(`${input.provider}:${input.connectionId}:${address}`)
          : null,
    ];
    return layers.reduce<HandlingPreferences>(
      (current, next) =>
        next
          ? {
              ...current,
              ...next,
              categories: { ...current.categories, ...next.categories },
            }
          : current,
      handlingPreferencesSchema.parse({}),
    );
  }
  revision(provider: AccountProvider, connectionId: string): string {
    const rows = this.db
      .prepare(
        "SELECT scope_key,revision FROM mail_handling_preferences WHERE profile_id=? AND (scope_key='*' OR scope_key LIKE ?) ORDER BY scope_key",
      )
      .all(this.profileId, `${provider}:${connectionId}:%`);
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
  stampPlan(
    table:
      | "cleanup_plans"
      | "gmail_organization_plans"
      | "outlook_history_plans"
      | "rule_reconciliation_plans",
    id: string,
    provider: AccountProvider,
    connectionId: string,
  ): void {
    this.db
      .prepare(`UPDATE ${table} SET handling_revision=? WHERE id=?`)
      .run(this.revision(provider, connectionId), id);
  }
  assertPlan(
    table:
      | "cleanup_plans"
      | "gmail_organization_plans"
      | "outlook_history_plans"
      | "rule_reconciliation_plans",
    id: string,
    provider: AccountProvider,
    connectionId: string,
  ): void {
    const row = this.db
      .prepare(`SELECT handling_revision FROM ${table} WHERE id=?`)
      .get(id) as { handling_revision: string | null } | undefined;
    if (
      !row?.handling_revision ||
      row.handling_revision !== this.revision(provider, connectionId)
    )
      throw new Error("mail_handling_changed_rebuild_plan");
  }
  assertScope(scope: HandlingScope): void {
    const table =
      scope.provider === "proton"
        ? "provider_connections"
        : `${scope.provider}_connections`;
    if (
      !this.db
        .prepare(`SELECT id FROM ${table} WHERE id=? AND profile_id=?`)
        .get(scope.connectionId, this.profileId)
    )
      throw new Error("account_not_found");
    if (
      scope.level === "alias" &&
      (!scope.address ||
        !this.aliases(scope).includes(scope.address.toLowerCase()))
    )
      throw new Error("confirmed_alias_required");
  }
  aliases(scope: Pick<HandlingScope, "provider" | "connectionId">): string[] {
    return (
      this.db
        .prepare(
          "SELECT normalized_address FROM account_identities WHERE profile_id=? AND provider=? AND connection_id=? AND user_status='confirmed' ORDER BY normalized_address",
        )
        .all(this.profileId, scope.provider, scope.connectionId) as Array<{
        normalized_address: string;
      }>
    ).map((row) => row.normalized_address);
  }
  get(scope: HandlingScope): HandlingState {
    this.assertScope(scope);
    return {
      preferences:
        scope.level === "profile"
          ? (this.read("*") ?? handlingPreferencesSchema.parse({}))
          : this.resolve(
              scope.provider,
              scope.connectionId,
              scope.level === "alias" ? scope.address : null,
            ),
      inherited: this.read(this.key(scope)) === null,
      revision: this.revision(scope.provider, scope.connectionId),
      aliases: this.aliases(scope),
    };
  }
  save(raw: HandlingSave): HandlingState {
    const input = handlingSaveSchema.parse(raw);
    this.assertScope(input);
    const running = this.db
      .prepare(
        "SELECT 1 FROM jobs WHERE profile_id=? AND state IN ('pending','running') LIMIT 1",
      )
      .get(this.profileId);
    if (running) throw new Error("mail_job_running");
    if (input.reset) {
      this.db
        .prepare(
          "DELETE FROM mail_handling_preferences WHERE profile_id=? AND scope_key=?",
        )
        .run(this.profileId, this.key(input));
      return this.get(input);
    }
    const json = JSON.stringify(input.preferences);
    this.db
      .prepare(
        "INSERT INTO mail_handling_preferences(profile_id,scope_key,preferences_json,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,scope_key) DO UPDATE SET preferences_json=excluded.preferences_json,revision=excluded.revision,updated_at=excluded.updated_at",
      )
      .run(
        this.profileId,
        this.key(input),
        json,
        createHash("sha256").update(json).digest("hex"),
        new Date().toISOString(),
      );
    return this.get(input);
  }
}
