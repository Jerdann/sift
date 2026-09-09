import type BetterSqlite3 from "better-sqlite3";
import { createHash } from "node:crypto";
import type { AccountSelectionInput } from "../../shared/contracts/accounts";
import {
  saveAddressGroupsSchema,
  type AddressGroup,
  type SaveAddressGroups,
} from "../../shared/contracts/address-groups";
import { MailHandlingRepository } from "../settings/mail-handling-repository";
import type {
  HandlingScope,
  SenderHandlingRule,
} from "../../shared/contracts/mail-handling";

// Groups select receiving addresses. They never classify senders or change mail.
export class AddressGroupRepository {
  constructor(
    readonly db: BetterSqlite3.Database,
    readonly profileId: string,
  ) {}
  private assertAccount(scope: AccountSelectionInput) {
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
  }
  list(scope: AccountSelectionInput): AddressGroup[] {
    this.assertAccount(scope);
    const saved = this.db
      .prepare(
        "SELECT id,name,color FROM address_groups WHERE profile_id=? AND provider=? AND connection_id=? ORDER BY rowid",
      )
      .all(this.profileId, scope.provider, scope.connectionId) as Omit<
      AddressGroup,
      "addresses"
    >[];
    const identities = this.db
      .prepare(
        "SELECT normalized_address,group_id FROM account_identities WHERE profile_id=? AND provider=? AND connection_id=? AND user_status='confirmed' ORDER BY normalized_address",
      )
      .all(this.profileId, scope.provider, scope.connectionId) as {
      normalized_address: string;
      group_id: string;
    }[];
    let mainName = "Main";
    for (
      let n = 2;
      saved.some((g) => g.name.toLowerCase() === mainName.toLowerCase());
      n++
    )
      mainName = `Main ${n}`;
    const groups = saved.some((g) => g.id === "main")
      ? saved
      : [{ id: "main", name: mainName, color: "blue" as const }, ...saved];
    return groups.map((g) => ({
      ...g,
      addresses: identities
        .filter(
          (i) =>
            i.group_id === g.id ||
            (g.id === "main" && !groups.some((v) => v.id === i.group_id)),
        )
        .map((i) => i.normalized_address),
    }));
  }
  get(scope: AccountSelectionInput) {
    const groups = this.list(scope);
    return {
      groups,
      revision: createHash("sha256")
        .update(JSON.stringify(groups))
        .digest("hex"),
    };
  }
  routing(scope: AccountSelectionInput) {
    const groups = this.list(scope),
      multiple = groups.filter((g) => g.addresses.length).length > 1;
    return new Map(
      groups.flatMap((g) =>
        g.addresses.map(
          (address) =>
            [address, { ...g, parent: multiple ? g.name : null }] as const,
        ),
      ),
    );
  }
  save(raw: SaveAddressGroups) {
    const input = saveAddressGroupsSchema.parse(raw),
      current = this.get(input);
    if (current.revision !== input.revision)
      throw new Error("address_groups_changed");
    if (
      this.db
        .prepare(
          "SELECT 1 FROM jobs WHERE profile_id=? AND state IN ('pending','running') LIMIT 1",
        )
        .get(this.profileId)
    )
      throw new Error("mail_job_running");
    if (input.groups.filter((g) => g.id === "main").length !== 1)
      throw new Error("main_group_required");
    const owned = new Set(current.groups.flatMap((g) => g.addresses)),
      seen = new Set<string>(),
      ids = new Set<string>(),
      names = new Set<string>();
    for (const g of input.groups) {
      if (ids.has(g.id) || names.has(g.name.toLowerCase()))
        throw new Error("group_names_must_be_unique");
      ids.add(g.id);
      names.add(g.name.toLowerCase());
      for (const address of g.addresses) {
        if (!owned.has(address)) throw new Error("confirmed_address_required");
        if (seen.has(address)) throw new Error("address_in_multiple_groups");
        seen.add(address);
      }
    }
    const main = input.groups.find((g) => g.id === "main")!;
    main.addresses.push(...[...owned].filter((a) => !seen.has(a)));
    const multiple = input.groups.filter((g) => g.addresses.length).length > 1;
    if (
      multiple &&
      input.groups.some((g) =>
        /^(inbox|spam|junk|trash|sent|drafts|archive|all mail|\[gmail\])$/i.test(
          g.name,
        ),
      )
    )
      throw new Error("group_name_reserved");
    const handling = new MailHandlingRepository(this.db, this.profileId);
    const scope = (id: string): HandlingScope => ({
      provider: input.provider,
      connectionId: input.connectionId,
      level: "group",
      groupId: id,
      address: null,
    });
    // Sender exceptions belong to a receiving address. Moving that address must
    // neither lose its exceptions nor leave them active in the former group.
    const savedRules = new Map<string, SenderHandlingRule[]>(),
      draftRules = new Map<string, SenderHandlingRule[]>();
    const oldStates = new Map(
      current.groups.map((g) => [g.id, handling.get(scope(g.id))]),
    );
    for (const g of current.groups)
      for (const address of g.addresses) {
        const rules =
          handling.resolve(input.provider, input.connectionId, address).rules ??
          [];
        savedRules.set(
          address,
          rules.filter((r) => r.address === address),
        );
        const draft = oldStates.get(g.id)!.draft;
        draftRules.set(
          address,
          (draft?.rules ?? rules).filter((r) => r.address === address),
        );
      }
    this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM address_groups WHERE profile_id=? AND provider=? AND connection_id=?",
        )
        .run(this.profileId, input.provider, input.connectionId);
      const insert = this.db.prepare(
        "INSERT INTO address_groups(profile_id,provider,connection_id,id,name,color) VALUES(?,?,?,?,?,?)",
      );
      const update = this.db.prepare(
        "UPDATE account_identities SET group_id=?,container_enabled=?,container_name=? WHERE profile_id=? AND provider=? AND connection_id=? AND normalized_address=? AND user_status='confirmed'",
      );
      for (const g of input.groups) {
        insert.run(
          this.profileId,
          input.provider,
          input.connectionId,
          g.id,
          g.name,
          g.color,
        );
        for (const address of g.addresses)
          update.run(
            g.id,
            multiple ? 1 : 0,
            multiple ? g.name : null,
            this.profileId,
            input.provider,
            input.connectionId,
            address,
          );
      }
      for (const g of input.groups) {
        const key = `${input.provider}:${input.connectionId}:group:${g.id}`;
        const saved = g.addresses.flatMap((a) => savedRules.get(a) ?? []);
        const draft = g.addresses.flatMap((a) => draftRules.get(a) ?? []);
        const old = oldStates.get(g.id);
        const base = old?.preferences ?? handling.get(scope(g.id)).preferences;
        if ((old && !old.inherited) || saved.length) {
          const json = JSON.stringify({ ...base, rules: saved });
          this.db
            .prepare(
              "INSERT INTO mail_handling_preferences(profile_id,scope_key,preferences_json,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,scope_key) DO UPDATE SET preferences_json=excluded.preferences_json,revision=excluded.revision,updated_at=excluded.updated_at",
            )
            .run(
              this.profileId,
              key,
              json,
              createHash("sha256").update(json).digest("hex"),
              new Date().toISOString(),
            );
        }
        if (old?.draft || JSON.stringify(draft) !== JSON.stringify(saved))
          handling.saveDraft({
            ...scope(g.id),
            preferences: { ...(old?.draft ?? base), rules: draft },
          });
      }
      // Deleted groups cannot leave a hidden draft which could be revived by a reused id.
      for (const old of current.groups.filter((g) => !ids.has(g.id))) {
        const key = `${input.provider}:${input.connectionId}:group:${old.id}`;
        for (const table of [
          "mail_handling_preferences",
          "mail_handling_drafts",
        ])
          this.db
            .prepare(`DELETE FROM ${table} WHERE profile_id=? AND scope_key=?`)
            .run(this.profileId, key);
      }
    })();
    return this.get(input);
  }
}
