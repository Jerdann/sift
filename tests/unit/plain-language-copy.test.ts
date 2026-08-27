import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("plain-language interface copy", () => {
  const renderer = readFileSync(resolve("src/renderer/App.tsx"), "utf8");

  it("states the three existing-folder choices as direct actions", () => {
    expect(renderer).toContain("Create new folders");
    expect(renderer).toContain("Use existing folders");
    expect(renderer).toContain("Replace existing folders");
    expect(renderer).toContain(
      "Keep your existing folders and labels. Create the folders in this plan and move matching mail into them.",
    );
    expect(renderer).toContain(
      "Move matching mail into existing folders. Create a folder only when no existing folder matches the plan.",
    );
    expect(renderer).toContain(
      "Move matching mail into the folders in this plan. Then remove old labels and delete old custom folders after they are empty.",
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
    ];

    for (const phrase of removedPhrases) {
      expect(renderer).not.toContain(phrase);
    }
  });
});
