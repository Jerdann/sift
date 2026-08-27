import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rebuildIndexInputSchema } from "../../src/shared/contracts/recovery";

describe("plain-language interface copy", () => {
  const renderer = readFileSync(resolve("src/renderer/App.tsx"), "utf8");
  const applicationCopy = [
    renderer,
    "src/core/classification/mail-classifier.ts",
    "src/main/gmail/gmail-subscription-service.ts",
    "src/main/outlook/outlook-subscription-service.ts",
    "src/main/unsubscribe/subscription-repository.ts",
    "src/main/updates/auto-update.ts",
  ]
    .map((source, index) =>
      index === 0 ? source : readFileSync(resolve(source), "utf8"),
    )
    .join("\n");

  it("states the three existing-folder choices as direct actions", () => {
    expect(renderer).toContain("Create new folders");
    expect(renderer).toContain("Use existing folders");
    expect(renderer).toContain("Replace existing folders");
    expect(renderer).toContain(
      "Keep your existing folders and labels. Create the new folders in this list and move matching mail into them.",
    );
    expect(renderer).toContain(
      "Move matching mail into existing folders. Create a folder only when no existing folder matches the new folder list.",
    );
    expect(renderer).toContain(
      "Move matching mail into the new folders. Then remove old labels and delete old custom folders after they are empty.",
    );
  });

  it("does not use the previous marketing or defensive wording", () => {
    const removedPhrases = [
      "A lighter inbox starts here",
      "Keep everything already there",
      "Reuse exact destination matches",
      "Fresh clean slate",
      "Choose how the new structure takes over",
      "Shape the filing plan",
      "Turn mailbox history into a durable system",
      "No giant sender report in this flow",
      "wider sieve",
      "mailbox map",
      "Clean the Proton inbox",
      "Stop junk at the source",
      "One workspace, every mailbox",
      "Connection diagnostics could not run",
      "Connected locally",
      "Remove local credential",
      "Save encrypted connection",
      "Resume from checkpoint",
      "Pause after this batch",
      "metadata-only evidence is limited",
      "Verified one-click links only",
      "Authenticated RFC 8058 HTTPS one-click endpoint",
      "Manual action queue",
      "Original mailbox state restored",
      "Original Microsoft state restored",
      "Nothing downstream changed",
      "Address evidence could not be refreshed",
      "NEEDS REVIEW",
      "Check local health",
      "portable rule pack",
      "verification mismatch",
      "Updates and rollback",
    ];

    for (const phrase of removedPhrases) {
      expect(applicationCopy).not.toContain(phrase);
    }
  });

  it("names saved-scan deletion directly", () => {
    expect(
      rebuildIndexInputSchema.parse({ confirmation: "DELETE SAVED SCAN" }),
    ).toEqual({ confirmation: "DELETE SAVED SCAN" });
    expect(() =>
      rebuildIndexInputSchema.parse({ confirmation: "REBUILD LOCAL INDEX" }),
    ).toThrow();
  });
});
