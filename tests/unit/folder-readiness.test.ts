import { describe, expect, it } from "vitest";
import { providerHasDestinations } from "../../src/core/rules/folder-readiness";

describe("provider folder readiness", () => {
  it("matches logical Proton destinations against the Folders namespace", () => {
    expect(providerHasDestinations(
      "proton",
      ["Primary/Promotions", "Money/Receipts"],
      [
        { path: "Folders/Primary/Promotions", delimiter: "/" },
        { path: "Folders/Money/Receipts", delimiter: "/" },
      ],
    )).toBe(true);
  });

  it("does not report readiness when any required folder is missing", () => {
    expect(providerHasDestinations(
      "proton",
      ["Primary/Promotions", "Money/Receipts"],
      [{ path: "Folders/Primary/Promotions", delimiter: "/" }],
    )).toBe(false);
  });
});
