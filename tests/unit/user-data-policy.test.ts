import { describe, expect, it } from "vitest";
import {
  hasExplicitUserDataDirectory,
  shouldUseLegacyUserData,
} from "../../src/main/profiles/user-data-policy";

describe("user-data directory policy", () => {
  it.each([
    ["--user-data-dir=C:\\Temp\\sift-smoke"],
    ["--disable-gpu", "--user-data-dir", "C:\\Temp\\sift-smoke"],
  ])("recognizes an explicit Chromium user-data directory", (...argv) => {
    expect(hasExplicitUserDataDirectory(argv)).toBe(true);
    expect(shouldUseLegacyUserData({ argv, legacyDirectoryExists: true })).toBe(
      false,
    );
  });

  it("keeps real pre-rename profiles discoverable during normal launches", () => {
    expect(
      shouldUseLegacyUserData({
        argv: ["Sift.exe"],
        legacyDirectoryExists: true,
      }),
    ).toBe(true);
    expect(
      shouldUseLegacyUserData({
        argv: ["Sift.exe"],
        legacyDirectoryExists: false,
      }),
    ).toBe(false);
  });
});
