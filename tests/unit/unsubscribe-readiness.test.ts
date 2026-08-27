import { describe, expect, it } from "vitest";
import { unsubscribeAllowsDelete } from "../../src/core/unsubscribe/unsubscribe-readiness";

describe("unsubscribe workflow readiness", () => {
  it("requires a mailing-list scan", () => {
    expect(unsubscribeAllowsDelete(null)).toBe(false);
  });

  it("allows Delete after review even when no requests were sent", () => {
    expect(unsubscribeAllowsDelete({ job: null })).toBe(true);
  });

  it.each(["pending", "running"] as const)(
    "waits while an unsubscribe job is %s",
    (state) => {
      expect(unsubscribeAllowsDelete({ job: { state } })).toBe(false);
    },
  );

  it.each(["succeeded", "failed", "skipped", "verification_mismatch"] as const)(
    "does not block Delete when an unsubscribe job ends as %s",
    (state) => {
      expect(unsubscribeAllowsDelete({ job: { state } })).toBe(true);
    },
  );
});
