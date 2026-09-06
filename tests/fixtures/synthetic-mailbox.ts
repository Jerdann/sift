import { randomUUID } from "node:crypto";
import { ProfileRepository } from "../../src/main/profiles/profile-repository";
import { SafeStorageVault } from "../../src/main/secrets/safe-storage-vault";
import { ProtonConnectionRepository } from "../../src/main/proton/proton-connection-repository";
import { ProtonDiscoveryRepository } from "../../src/main/proton/proton-discovery-repository";
import { analyzeMailbox } from "../../src/main/analysis/mailbox-analysis-service";
import { AccountIdentityRepository } from "../../src/main/identity/account-identity-repository";
import { OrganizationProposalRepository } from "../../src/main/organization/organization-proposal-repository";
import { RuleReconciliationRepository } from "../../src/main/rules/rule-reconciliation-repository";
import { ProtonRuleInventoryService } from "../../src/main/rules/proton-rule-inventory-service";
import { JobRepository } from "../../src/main/jobs/job-repository";

// Invented mail, never copied from a user's mailbox. No live provider is contacted.
export function seedSyntheticMailbox(root: string) {
  const profile = new ProfileRepository(root).createProfile(
      "Synthetic test mailbox",
    ),
    db = profile.database,
    id = profile.profile.id;
  const vault = new SafeStorageVault(root, db, {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s).reverse(),
    decryptString: (b) => Buffer.from(b).reverse().toString(),
  });
  const connection = new ProtonConnectionRepository(db, vault, id).save({
    host: "127.0.0.1",
    port: 1143,
    username: "owner@example.test",
    password: "synthetic-unused-credential",
    security: "starttls",
  });
  const now = "2026-09-01T12:00:00.000Z";
  const subjects = [
    "Save up to 50% today",
    "Your verification code",
    "Your order has shipped",
    "Member trip confirmation",
    "Your receipt for payment",
    "Your weekly engineering digest",
    "Your e-transfer was deposited",
    "Please rate your purchase",
    "Scheduled system maintenance",
    "Your password has changed",
    "Your monthly performance report",
    "New products now available",
  ];
  const count = 24;
  const snapshot = new ProtonDiscoveryRepository(db, id).replace(
    connection.id,
    {
      capabilities: ["IMAP4rev1"],
      addresses: [
        {
          address: "owner@example.test",
          occurrenceCount: count,
          lastSeenAt: now,
          sources: ["delivered-to"],
        },
        {
          address: "shared@example.test",
          occurrenceCount: count,
          lastSeenAt: now,
          sources: ["delivered-to"],
        },
      ],
      mailboxes: [
        {
          path: "INBOX",
          name: "Inbox",
          delimiter: "/",
          specialUse: "\\Inbox",
          flags: [],
          messageCount: count,
          unreadCount: count,
          uidValidity: "1",
          uidNext: count + 1,
        },
      ],
    },
  );
  const box = snapshot.mailboxes[0]!;
  const insert = db.prepare(
    "INSERT INTO indexed_messages(id,connection_id,container_id,uid_validity,uid,message_id,received_at,subject,sender_json,recipients_json,headers_json,flags_json,size_bytes,body_text,body_truncated,indexed_at) VALUES(?,?,?,'1',?,?,?,?,?,?,?,'[]',100,NULL,0,?)",
  );
  for (let i = 0; i < count; i++) {
    const address = i < 12 ? "owner@example.test" : "shared@example.test";
    insert.run(
      randomUUID(),
      connection.id,
      box.id,
      i + 1,
      `<synthetic-${i}@example.test>`,
      now,
      subjects[i % subjects.length],
      JSON.stringify(["mail@service.example"]),
      JSON.stringify([address]),
      JSON.stringify({ "delivered-to": address }),
      now,
    );
  }
  analyzeMailbox(db, id, connection.id);
  const identities = new AccountIdentityRepository(db, id);
  identities.update({
    provider: "proton",
    connectionId: connection.id,
    address: "owner@example.test",
    status: "confirmed",
    containerEnabled: false,
    containerName: null,
  });
  identities.update({
    provider: "proton",
    connectionId: connection.id,
    address: "shared@example.test",
    status: "confirmed",
    containerEnabled: true,
    containerName: "Shared home",
  });
  analyzeMailbox(db, id, connection.id);
  const proposal = new OrganizationProposalRepository(db, id).generate(
    "proton",
    connection.id,
  );
  new ProtonRuleInventoryService(
    new RuleReconciliationRepository(db, id),
  ).refresh(connection.id);
  const jobs = new JobRepository(db),
    job = jobs.createJob({
      profileId: id,
      kind: "proton-audit",
      idempotencyKey: "synthetic-audit-complete",
      itemKeys: ["INBOX"],
    });
  const item = jobs.claimNextPending(job.id)!;
  jobs.transitionItem(item.id, "succeeded");
  db.prepare(
    "INSERT INTO proton_audit_runs(job_id,connection_id,extract_bodies,created_at) VALUES(?,?,0,?)",
  ).run(job.id, connection.id, now);
  db.prepare(
    "INSERT INTO proton_folder_checkpoints(connection_id,container_id,uid_validity,last_uid,indexed_count,earliest_at,latest_at,updated_at) VALUES(?,?,?,24,24,?,?,?)",
  ).run(connection.id, box.id, "1", now, now, now);
  db.close();
  return { profileId: id, connectionId: connection.id, proposal };
}
