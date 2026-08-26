import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppSettingsRepository } from "../../src/main/settings/app-settings-repository";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), "sift-settings-"));
  roots.push(root);
  return { root, settings: new AppSettingsRepository(root) };
};

describe("app settings", () => {
  it("requires an explicit opt-in and persists the preference", () => {
    const { root, settings } = setup();
    expect(settings.get()).toEqual({
      version: 1,
      autoUpdateEnabled: false,
    });

    settings.setAutoUpdateEnabled(true);

    expect(new AppSettingsRepository(root).get()).toEqual({
      version: 1,
      autoUpdateEnabled: true,
    });
  });

  it("fails closed when the preference file is damaged", () => {
    const { root, settings } = setup();
    writeFileSync(path.join(root, "settings.json"), "not-json", "utf8");

    expect(settings.get().autoUpdateEnabled).toBe(false);
  });
});
