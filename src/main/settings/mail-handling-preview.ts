import type BetterSqlite3 from "better-sqlite3";
import {
  classifyMessage,
  CLASSIFIER_VERSION,
} from "../../core/classification/mail-classifier";
import {
  handlingDescription,
  handlingEligible,
  handlingTarget,
  retentionEligible,
  handlingFor,
} from "../../core/classification/mail-handling";
import {
  handlingPreviewSchema,
  type HandlingPreview,
  type HandlingPreviewInput,
} from "../../shared/contracts/mail-handling";
import type { MailCategory } from "../../shared/contracts/analysis";
import { MailHandlingRepository } from "./mail-handling-repository";
import {
  applySenderHandling,
  preferencesForEvidence,
  ruleFromEvidence,
} from "../../core/classification/sender-handling";
import type { HandlingPreferences } from "../../shared/contracts/mail-handling";

export const previewMailHandling = (
  db: BetterSqlite3.Database,
  profileId: string,
  input: HandlingPreviewInput,
): HandlingPreview => {
  const repo = new MailHandlingRepository(db, profileId);
  repo.assertScope(input);
  const prefix = input.provider === "proton" ? "" : `${input.provider}_`;
  const body = input.provider === "proton" ? "im.body_text" : "NULL";
  const source =
    input.provider === "proton"
      ? "containers.provider_container_id"
      : input.provider === "gmail"
        ? "im.label_ids_json"
        : "im.parent_folder_id";
  const join =
    input.provider === "proton"
      ? "JOIN mail_containers containers ON containers.id=im.container_id"
      : "";
  const roles =
    input.provider === "proton"
      ? "COALESCE(containers.special_use,'') || ' ' || containers.flags_json"
      : source;
  const rows = db
    .prepare(
      `SELECT mc.category,mc.receiving_addresses_json,im.subject,im.sender_json,im.recipients_json,im.headers_json,${body} body_text,im.received_at,${source} source,${roles} roles
    FROM ${prefix}message_classifications mc JOIN ${prefix}indexed_messages im ON im.id=mc.message_row_id ${join}
    WHERE mc.analysis_id=(SELECT id FROM ${prefix}mailbox_analyses WHERE profile_id=? AND connection_id=? ORDER BY rowid DESC LIMIT 1)
    ORDER BY im.received_at DESC,im.id`,
    )
    .all(profileId, input.connectionId) as Array<{
    category: MailCategory;
    receiving_addresses_json: string;
    subject: string | null;
    sender_json: string;
    recipients_json: string;
    headers_json: string;
    body_text: string | null;
    received_at: string | null;
    source: string;
    roles: string;
  }>;
  const outlookFolders =
    input.provider === "outlook"
      ? (db
          .prepare(
            "SELECT sent_items_id,deleted_items_id,junk_email_id FROM outlook_folder_ids WHERE connection_id=?",
          )
          .get(input.connectionId) as Record<string, string> | undefined)
      : undefined;
  const identities = db
    .prepare(
      "SELECT normalized_address,container_enabled,container_name FROM account_identities WHERE profile_id=? AND provider=? AND connection_id=? AND user_status='confirmed'",
    )
    .all(profileId, input.provider, input.connectionId) as Array<{
    normalized_address: string;
    container_enabled: number;
    container_name: string | null;
  }>;
  const owned = new Map(identities.map((i) => [i.normalized_address, i]));
  const inventory = db
    .prepare(
      "SELECT container_names_json FROM rule_inventories WHERE profile_id=? AND provider=? AND connection_id=? ORDER BY captured_at DESC,rowid DESC LIMIT 1",
    )
    .get(profileId, input.provider, input.connectionId) as
    { container_names_json: string } | undefined;
  const names = JSON.parse(inventory?.container_names_json ?? "{}") as Record<
    string,
    string
  >;
  const systemLabels: Record<string, string> = {
    INBOX: "Inbox",
    SENT: "Sent",
    DRAFT: "Drafts",
    SPAM: "Spam",
    TRASH: "Trash",
    UNREAD: "Unread",
    STARRED: "Starred",
    IMPORTANT: "Important",
  };
  if (input.provider === "outlook") {
    const folders = db
      .prepare("SELECT * FROM outlook_folder_ids WHERE connection_id=?")
      .get(input.connectionId) as Record<string, string> | undefined;
    for (const [key, label] of Object.entries({
      inbox_id: "Inbox",
      sent_items_id: "Sent",
      deleted_items_id: "Deleted Items",
      junk_email_id: "Junk",
      archive_id: "Archive",
    }))
      if (folders?.[key]) names[folders[key]] = label;
  }
  const sourceName = (raw: string): string =>
    input.provider === "proton"
      ? raw
      : input.provider === "gmail"
        ? (JSON.parse(raw) as string[])
            .map(
              (id) =>
                names[id] ??
                systemLabels[id] ??
                "Label name unavailable — scan folders",
            )
            .join(", ") || "No labels"
        : (names[raw] ?? "Folder name unavailable — scan folders");
  const groups = new Map<MailCategory, HandlingPreview["groups"][number]>();
  const examples: HandlingPreview["examples"] = [];
  const senders = new Map<string, HandlingPreview["senders"][number]>();
  const ruleMatches: Record<string, number> = {};
  const preferenceCache = new Map<string | null, HandlingPreferences>();
  let total = 0,
    matched = 0,
    held = 0,
    changed = 0,
    retention = 0,
    withBody = 0;
  for (const row of rows) {
    const addresses = (JSON.parse(row.receiving_addresses_json) as string[])
      .map((a) => a.toLowerCase())
      .filter((a) => owned.has(a));
    if (
      input.level === "alias" &&
      !addresses.includes(input.address!.toLowerCase())
    )
      continue;
    const address = new Set(addresses).size === 1 ? addresses[0]! : null;
    const identity = address ? owned.get(address) : null;
    const basePrefs =
      preferenceCache.get(address) ?? repo.resolveDraft(input, address);
    preferenceCache.set(address, basePrefs);
    const senderList = JSON.parse(row.sender_json) as string[];
    const sender = senderList.length === 1 ? senderList[0]!.toLowerCase() : "";
    const base = classifyMessage({
      subject: row.subject,
      bodyText: row.body_text,
      senders: JSON.parse(row.sender_json),
      recipients: JSON.parse(row.recipients_json),
      headers: JSON.parse(row.headers_json),
    });
    const c = applySenderHandling(
      base,
      basePrefs,
      sender,
      row.subject ?? "",
      address,
    );
    const prefs = preferencesForEvidence(basePrefs, c.evidence);
    const rule = ruleFromEvidence(basePrefs, c.evidence);
    const excluded =
      input.provider === "proton"
        ? /\\(?:all|sent|drafts|trash|junk)/i.test(row.roles)
        : input.provider === "gmail"
          ? JSON.parse(row.roles).some((label: string) =>
              ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label),
            )
          : Object.values(outlookFolders ?? {}).includes(row.roles);
    if (!excluded && address && sender && c.category === "other") {
      const key = sender + "\0" + address;
      const group = senders.get(key) ?? {
        sender,
        address,
        count: 0,
        subject: row.subject ?? "(No subject)",
      };
      group.count++;
      senders.set(key, group);
    }
    if (rule && !excluded && address)
      ruleMatches[rule.id] = (ruleMatches[rule.id] ?? 0) + 1;
    const eligible =
      !excluded &&
      Boolean(address) &&
      handlingEligible(prefs, c.category, c.confidence);
    const target =
      eligible && handlingFor(prefs, c.category).destination !== "inbox"
        ? handlingTarget(
            prefs,
            c.category,
            identity?.container_enabled ? identity.container_name : null,
          )
        : sourceName(row.source);
    const expired =
      eligible &&
      retentionEligible(
        prefs,
        c.category,
        c.confidence,
        row.received_at,
        new Date().toISOString(),
      );
    const action = eligible
      ? handlingDescription(prefs, c.category)
      : "Leave unchanged · review required";
    total++;
    if (row.body_text) withBody++;
    if (eligible) matched++;
    else held++;
    if (c.category !== row.category) changed++;
    if (expired) retention++;
    const group = groups.get(c.category) ?? {
      category: c.category,
      count: 0,
      matched: 0,
      retention: 0,
      target,
      action,
      reasons: c.evidence,
    };
    group.count++;
    if (eligible) group.matched++;
    if (expired) group.retention++;
    if (group.target !== target)
      group.target = "Separate destinations by address";
    if (group.action !== action)
      group.action = "Uses each address’s saved handling";
    groups.set(c.category, group);
    if (
      input.sender
        ? sender === input.sender.toLowerCase() &&
          (!input.receivingAddress ||
            address === input.receivingAddress.toLowerCase())
        : input.categories
          ? input.categories.includes(c.category)
          : !input.category || input.category === c.category
    )
      examples.push({
        subject: row.subject ?? "(No subject)",
        sender: (JSON.parse(row.sender_json) as string[])[0] ?? "",
        address,
        category: c.category,
        priorCategory: row.category,
        source: sourceName(row.source),
        target,
        action,
        held: !eligible,
        ruleId: rule?.id ?? null,
        actionCode: !eligible
          ? "REVIEW"
          : (
              {
                inbox: "KEEP",
                file: "FILE",
                spam: "SPAM",
                trash: "TRASH",
              } as const
            )[handlingFor(prefs, c.category).destination],
        reasons: c.evidence,
      });
  }
  // Put both matches and exclusions on the first page of a sender preview.
  // Otherwise hundreds of identical matches can hide a protected receipt.
  if (input.sender && input.preferences.rules?.length) {
    const matches = examples.filter((e) => e.ruleId),
      others = examples.filter((e) => !e.ruleId);
    examples.splice(
      0,
      examples.length,
      ...matches.slice(0, 3),
      ...others.slice(0, 2),
      ...matches.slice(3),
      ...others.slice(2),
    );
  }
  return handlingPreviewSchema.parse({
    total,
    matched,
    held,
    changed,
    retention,
    withBody,
    classifierVersion: CLASSIFIER_VERSION,
    senders: [...senders.values()]
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.sender.localeCompare(b.sender) ||
          a.address.localeCompare(b.address),
      )
      .slice((input.senderPage ?? 0) * 8, (input.senderPage ?? 0) * 8 + 8),
    senderPages: Math.max(1, Math.ceil(senders.size / 8)),
    ruleMatches,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
    examples: examples.slice(input.page * 5, input.page * 5 + 5),
    page: input.page,
    pages: Math.max(1, Math.ceil(examples.length / 5)),
  });
};
