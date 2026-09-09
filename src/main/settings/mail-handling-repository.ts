import type BetterSqlite3 from "better-sqlite3";
import { createHash } from "node:crypto";
import { AddressGroupRepository } from "../identity/address-group-repository";
import {
  copyAddressGroupChoicesSchema,
  type CopyAddressGroupChoices,
} from "../../shared/contracts/address-groups";
import { copyGroupChoices } from "../../core/classification/mail-handling";
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
      : `${scope.provider}:${scope.connectionId}:${scope.level === "group" ? `group:${scope.groupId}` : scope.level === "alias" ? (scope.address?.toLowerCase() ?? "") : "*"}`;
  }
  private groupId(
    provider: AccountProvider,
    connectionId: string,
    address: string | null,
  ) {
    return address
      ? ((
          this.db
            .prepare(
              "SELECT group_id FROM account_identities WHERE profile_id=? AND provider=? AND connection_id=? AND normalized_address=? AND user_status='confirmed'",
            )
            .get(
              this.profileId,
              provider,
              connectionId,
              address.toLowerCase(),
            ) as { group_id: string } | undefined
        )?.group_id ?? "main")
      : "main";
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
    ruleId: string | null = null,
  ): HandlingPreferences {
    const base = this.read("*") ?? handlingPreferencesSchema.parse({});
    const account = this.read(`${provider}:${connectionId}:*`);
    const alias = address
      ? this.read(`${provider}:${connectionId}:${address.toLowerCase()}`)
      : null;
    const group = address
      ? this.read(
          `${provider}:${connectionId}:group:${this.groupId(provider, connectionId, address)}`,
        )
      : null;
    const resolved = [account, alias, group].reduce<HandlingPreferences>(
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
    const rule = resolved.rules?.find((r) => r.id === ruleId);
    return rule
      ? {
          ...resolved,
          categories: {
            ...resolved.categories,
            [rule.category]: rule.handling,
          },
        }
      : resolved;
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
      input.level === "group" &&
      input.groupId ===
        this.groupId(input.provider, input.connectionId, address)
        ? input.preferences
        : address
          ? this.read(
              `${input.provider}:${input.connectionId}:group:${this.groupId(input.provider, input.connectionId, address)}`,
            )
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
    const groups = new AddressGroupRepository(this.db, this.profileId).get({
      provider,
      connectionId,
    });
    return createHash("sha256")
      .update(JSON.stringify([rows, groups.revision]))
      .digest("hex");
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
    if (
      scope.level === "group" &&
      !new AddressGroupRepository(this.db, this.profileId)
        .list(scope)
        .some((g) => g.id === scope.groupId)
    )
      throw new Error("address_group_required");
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
    const group =
      scope.level === "group"
        ? new AddressGroupRepository(this.db, this.profileId)
            .list(scope)
            .find((g) => g.id === scope.groupId)!
        : null;
    const groupPrefs = group
      ? (this.read(this.key(scope)) ??
        this.resolve(
          scope.provider,
          scope.connectionId,
          group.addresses[0] ?? null,
        ))
      : null;
    return {
      preferences:
        groupPrefs && group
          ? {
              ...groupPrefs,
              rules: groupPrefs.rules?.filter((r) =>
                group.addresses.includes(r.address),
              ),
            }
          : scope.level === "profile"
            ? (this.read("*") ?? handlingPreferencesSchema.parse({}))
            : this.resolve(
                scope.provider,
                scope.connectionId,
                scope.level === "alias" ? scope.address : null,
              ),
      inherited: this.read(this.key(scope)) === null,
      revision: this.revision(scope.provider, scope.connectionId),
      aliases: this.aliases(scope),
      draft: this.readDraft(scope),
    };
  }
  private readDraft(scope: HandlingScope): HandlingPreferences | null {
    const row = this.db
      .prepare(
        "SELECT preferences_json FROM mail_handling_drafts WHERE profile_id=? AND scope_key=?",
      )
      .get(this.profileId, this.key(scope)) as
      { preferences_json: string } | undefined;
    return row
      ? handlingPreferencesSchema.parse(JSON.parse(row.preferences_json))
      : null;
  }
  copyGroups(raw: CopyAddressGroupChoices): void {
    const input = copyAddressGroupChoicesSchema.parse(raw);
    const state = new AddressGroupRepository(this.db, this.profileId).get(
      input,
    );
    if (state.revision !== input.revision)
      throw new Error("address_groups_changed");
    const scope = (id: string): HandlingScope => ({
      provider: input.provider,
      connectionId: input.connectionId,
      level: "group",
      groupId: id,
      address: null,
    });
    const source = this.get(scope(input.sourceId));
    this.db.transaction(() => {
      for (const id of new Set(input.targetIds)) {
        if (id === input.sourceId) continue;
        const targetGroup = state.groups.find((g) => g.id === id);
        if (!targetGroup) throw new Error("address_group_required");
        const target = this.get(scope(id));
        this.saveDraft({
          ...scope(id),
          preferences: copyGroupChoices(
            source.draft ?? source.preferences,
            target.draft ?? target.preferences,
            targetGroup.addresses,
          ),
        });
      }
    })();
  }
  saveGroupDrafts(raw: HandlingSave): HandlingState {
    const input = handlingSaveSchema.parse(raw);
    this.assertScope(input);
    return this.db.transaction(() => {
      this.saveDraft(input);
      for (const group of new AddressGroupRepository(
        this.db,
        this.profileId,
      ).list(input)) {
        const scope: HandlingScope = {
          provider: input.provider,
          connectionId: input.connectionId,
          level: "group",
          groupId: group.id,
          address: null,
        };
        const draft = this.readDraft(scope);
        if (draft) this.save({ ...scope, preferences: draft });
      }
      return this.get(input);
    })();
  }
  saveDraft(raw: HandlingSave): void {
    const input = handlingSaveSchema.parse(raw);
    this.assertScope(input);
    if (input.reset) {
      this.db
        .prepare(
          "DELETE FROM mail_handling_drafts WHERE profile_id=? AND scope_key=?",
        )
        .run(this.profileId, this.key(input));
      return;
    }
    this.validateRules(input);
    this.db
      .prepare(
        "INSERT INTO mail_handling_drafts(profile_id,scope_key,preferences_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(profile_id,scope_key) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at",
      )
      .run(
        this.profileId,
        this.key(input),
        JSON.stringify(input.preferences),
        new Date().toISOString(),
      );
  }
  private validateRules(input: HandlingSave): void {
    const aliases = this.aliases(input),
      seen = new Set<string>();
    for (const rule of input.preferences.rules ?? []) {
      const key = rule.sender.toLowerCase() + "\0" + rule.address.toLowerCase();
      if (
        input.level === "profile" ||
        !aliases.includes(rule.address.toLowerCase()) ||
        seen.has(key) ||
        ["other", "suspicious", "spam"].includes(rule.category) ||
        /[\r\n*?]/.test(rule.subjectContains ?? "")
      )
        throw new Error("sender_rule_invalid");
      seen.add(key);
      if (
        input.level === "group" &&
        !new AddressGroupRepository(this.db, this.profileId)
          .list(input)
          .find((g) => g.id === input.groupId)
          ?.addresses.includes(rule.address)
      )
        throw new Error("sender_rule_outside_group");
    }
  }
  save(raw: HandlingSave): HandlingState {
    const input = handlingSaveSchema.parse(raw);
    this.assertScope(input);
    this.validateRules(input);
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
      this.saveDraft({ ...input, reset: true });
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
    this.saveDraft({ ...input, reset: true });
    return this.get(input);
  }
}
