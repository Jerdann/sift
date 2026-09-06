import { randomUUID } from "node:crypto";
import { seedSyntheticMailbox } from "./synthetic-mailbox";
import { ProfileRepository } from "../../src/main/profiles/profile-repository";
import { analyzeMailbox } from "../../src/main/analysis/mailbox-analysis-service";

export function seedBulkMailbox(root: string) {
  const fixture = seedSyntheticMailbox(root);
  const db = new ProfileRepository(root).openProfile(
    fixture.profileId,
  ).database;
  const row = db
    .prepare("SELECT * FROM indexed_messages LIMIT 1")
    .get() as Record<string, unknown>;
  const insert = db.prepare(
    "INSERT INTO indexed_messages(id,connection_id,container_id,uid_validity,uid,message_id,received_at,subject,sender_json,recipients_json,headers_json,flags_json,size_bytes,body_text,body_truncated,indexed_at) VALUES(?,?,?,'1',?,?,?,?,?,?,?,'[]',100,?,0,?)",
  );
  let uid = 100;
  const add = (
    sender: string,
    address: string,
    subject: string,
    body: string | null = null,
  ) =>
    insert.run(
      randomUUID(),
      fixture.connectionId,
      row.container_id,
      uid++,
      randomUUID() + "@example.test",
      "2026-09-02T00:00:00.000Z",
      subject,
      JSON.stringify([sender]),
      JSON.stringify([address]),
      JSON.stringify({ "delivered-to": address }),
      body,
      "2026-09-02T00:00:00.000Z",
    );
  db.transaction(() => {
    for (let i = 0; i < 400; i++)
      add(
        "updates@vendor.example",
        "owner@example.test",
        i < 250 ? "Blue bulletin " + i : "Red bulletin " + i,
      );
    for (let i = 0; i < 80; i++)
      add(
        "updates@small.example",
        "owner@example.test",
        "Another bulletin " + i,
      );
    for (let i = 0; i < 30; i++)
      add(
        "updates@vendor.example",
        "shared@example.test",
        "Shared bulletin " + i,
      );
    add(
      "updates@vendor.example",
      "owner@example.test",
      "Your receipt for payment",
    );
    add(
      "updates@vendor.example",
      "owner@example.test",
      "Your verification code",
    );
    add("updates@vendor.example", "owner@example.test", "Re: Blue bulletin");
    add(
      "updates@vendor.example",
      "owner@example.test",
      "Monthly notes",
      "Your payment is due tomorrow",
    );
    add("test@mixed.example", "owner@example.test", "Payment—confirmed");
    add(
      "test@mixed.example",
      "owner@example.test",
      "Something to read",
      "Save up to 50% today",
    );
  })();
  analyzeMailbox(db, fixture.profileId, fixture.connectionId);
  db.close();
  return fixture;
}
