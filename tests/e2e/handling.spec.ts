import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedBulkMailbox } from "../fixtures/bulk-mailbox";
import { ProfileRepository } from "../../src/main/profiles/profile-repository";
import { analyzeMailbox } from "../../src/main/analysis/mailbox-analysis-service";

test("live group controls, bulk sender rules, and drafts survive a failed rebuild and restart", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sift-handling-e2e-"));
  seedBulkMailbox(root);
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, MAIL_STEWARD_TEST_DATA_ROOT: root },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const open = async () => {
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await page.getByRole("button", { name: "Organize", exact: true }).click();
    };
    await open();
    let panel = page.locator(".mail-handling");
    await expect(
      panel.getByRole("heading", { name: "Main: mail rules" }),
    ).toBeVisible();
    await expect(panel.locator(".handling-sender").first()).toContainText(
      "400",
    );
    const detailed = await panel
      .getByRole("navigation", { name: "Mail groups" })
      .locator("button")
      .count();
    await panel.getByRole("button", { name: "Fewer", exact: true }).click();
    await expect
      .poll(() =>
        panel
          .getByRole("navigation", { name: "Mail groups" })
          .locator("button")
          .count(),
      )
      .toBeLessThan(detailed);
    await panel
      .getByRole("navigation", { name: "Mail groups" })
      .getByRole("button", { name: /^Promotions/ })
      .click();
    await panel
      .getByRole("group", { name: "Action", exact: true })
      .getByRole("button", { name: "Spam", exact: true })
      .click();
    await expect(panel.locator(".handling-examples")).toContainText("SPAM");
    await panel
      .getByRole("group", { name: "Action", exact: true })
      .getByRole("button", { name: "Trash", exact: true })
      .click();
    await expect(panel.locator(".handling-examples")).toContainText("TRASH");
    await panel.getByText("Show the rule", { exact: true }).click();
    await expect(panel.locator(".handling-formula code")).toContainText(
      "THEN TRASH",
    );
    await panel
      .getByRole("group", { name: "Action", exact: true })
      .getByRole("button", { name: "File", exact: true })
      .click();
    await panel.getByLabel("Match strictness").fill("2");
    await expect(panel.locator(".handling-preview")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await panel.screenshot({ path: "test-results/handling-groups.png" });
    await panel
      .getByRole("navigation", { name: "Mail groups" })
      .getByRole("button", { name: /^Needs sorting/ })
      .click();
    await panel.locator(".handling-sender").first().click();
    await expect(panel.locator(".handling-summary")).toContainText(
      "400 matches",
    );
    await panel
      .getByRole("group", { name: "Action", exact: true })
      .getByRole("button", { name: "Spam", exact: true })
      .click();
    await expect(panel.locator(".handling-examples")).toContainText("SPAM");
    await panel.getByLabel("Subject must contain").fill("Blue");
    await expect(
      panel.getByRole("button", { name: "Use this rule for 250 messages" }),
    ).toBeEnabled();
    await panel.getByLabel("Subject must contain").fill("");
    await expect(
      panel.getByRole("button", { name: "Use this rule for 400 messages" }),
    ).toBeEnabled();
    await panel.screenshot({ path: "test-results/handling-bulk.png" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(760, 900),
    );
    await panel.screenshot({ path: "test-results/handling-bulk-compact.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await panel
      .getByRole("button", { name: "Use this rule for 400 messages" })
      .click();
    await expect(panel.locator(".handling-sender").first()).toContainText("80");
    await expect(panel).toContainText("Draft saved on this computer.");
    // Close without saving: the local draft must survive.
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await open();
    panel = page.locator(".mail-handling");
    await expect(panel).toContainText("Restored your saved draft.");
    await expect(panel.locator(".handling-sender").first()).toContainText("80");
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("organization-proposal:generate");
      ipcMain.handle("organization-proposal:generate", () => {
        throw Error("synthetic_rebuild_failure");
      });
    });
    await panel
      .getByRole("button", { name: "Save all group choices and rebuild" })
      .click();
    await expect(panel).toContainText(
      "Choices saved. The folder plan could not be rebuilt.",
    );
    await expect(
      panel.getByRole("button", { name: "Retry building folders" }),
    ).toBeEnabled();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await open();
    panel = page.locator(".mail-handling");
    await expect(panel.locator(".handling-sender").first()).toContainText("80");
    await panel
      .getByRole("button", { name: "Save all group choices and rebuild" })
      .click();
    await expect(panel).toContainText("Choices saved. Folder plan updated.");
    // A preview failure must not present old example actions as current.
    await panel
      .getByRole("navigation", { name: "Mail groups" })
      .getByRole("button", { name: /^Promotions/ })
      .click();
    await expect(panel.locator(".handling-examples")).toContainText("SPAM");
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("mail-handling:preview");
      ipcMain.handle("mail-handling:preview", () => {
        throw Error("synthetic_preview_failure");
      });
    });
    await panel
      .getByRole("group", { name: "Action", exact: true })
      .getByRole("button", { name: "Trash", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "Could not preview these choices",
    );
    await expect(panel.locator(".handling-examples")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Save all group choices and rebuild" }),
    ).toBeDisabled();
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("separate trees stay visible and copy main choices without sharing future edits", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sift-trees-e2e-"));
  const f = seedBulkMailbox(root);
  const db = new ProfileRepository(root).openProfile(f.profileId).database;
  db.prepare("UPDATE indexed_messages SET body_text=NULL").run();
  db.prepare(
    "UPDATE indexed_messages SET headers_json=json_set(headers_json,'$.\"list-id\"','<letters.example.test>') WHERE sender_json=?",
  ).run(JSON.stringify(["updates@small.example"]));
  analyzeMailbox(db, f.profileId, f.connectionId);
  db.close();
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, MAIL_STEWARD_TEST_DATA_ROOT: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Organize", exact: true }).click();
    const panel = page.locator(".mail-handling"),
      trees = page.getByRole("region", { name: "Address groups" });
    await expect(
      trees.getByRole("checkbox", { name: /^shared@example.test/ }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Fewer", exact: true }).click();
    const selectGroup = (name: RegExp) =>
      panel
        .getByRole("navigation", { name: "Mail groups" })
        .getByRole("button", { name })
        .click();
    await selectGroup(/^Other mailing-list mail/);
    await expect(panel.locator(".handling-summary")).toContainText(
      "80 matches",
    );
    await expect(
      panel.getByRole("switch", { name: "Mark as read" }),
    ).not.toBeChecked();
    await expect(
      panel
        .getByRole("group", { name: "Action", exact: true })
        .getByRole("button", { name: "Spam", exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Set a rule for this sender" }).first(),
    ).toBeVisible();
    await selectGroup(/^Promotions/);
    await expect(panel.getByLabel("Match strictness")).toHaveAttribute(
      "max",
      "1",
    );
    await panel
      .getByRole("group", { name: "Action", exact: true })
      .getByRole("button", { name: "Spam", exact: true })
      .click();
    await expect(panel.locator(".handling-examples")).toContainText("SPAM");
    await panel
      .getByRole("button", { name: "Save all group choices and rebuild" })
      .click();
    await expect(panel).toContainText("Choices saved. Folder plan updated.");
    await trees.getByRole("button", { name: /^Shared home/ }).click();
    await expect(
      panel.getByRole("heading", { name: "Shared home: mail rules" }),
    ).toBeVisible();
    await panel.getByLabel("Copy settings from").selectOption("main");
    await panel
      .getByRole("group", { name: "Copy settings to" })
      .getByLabel("Shared home", { exact: true })
      .check();
    await panel
      .getByRole("button", { name: "Copy to selected groups" })
      .click();
    await expect(panel).toContainText("Restored your saved draft.");
    await selectGroup(/^Promotions/);
    await panel
      .getByRole("group", { name: "Action", exact: true })
      .getByRole("button", { name: "File", exact: true })
      .click();
    await expect(panel.locator(".handling-examples")).toContainText(
      "Shared home/Promotions",
    );
    await expect(panel.locator(".handling-examples")).not.toContainText(
      "owner@example.test",
    );
    await panel
      .getByRole("button", { name: "Save all group choices and rebuild" })
      .click();
    await expect(panel).toContainText("Choices saved. Folder plan updated.");
    await selectGroup(/^Needs sorting/);
    await expect(panel.locator(".handling-sender").first()).toContainText("30");
    await trees.getByRole("button", { name: /^Main/ }).click();
    await selectGroup(/^Promotions/);
    await expect(panel.locator(".handling-examples")).toContainText("SPAM");
    await expect(panel.locator(".handling-examples")).not.toContainText(
      "shared@example.test",
    );
    await trees.getByRole("button", { name: /^Shared home/ }).click();
    await expect(panel.locator(".handling-examples")).toContainText("FILE");
    await page.getByLabel("Group name").fill("Home mail");
    await trees
      .getByRole("button", { name: "Save groups", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Home mail: mail rules" }),
    ).toBeVisible();
    await expect(panel.locator(".handling-examples")).toContainText(
      "Home mail/Promotions",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "test-results/organize-trees-desktop.png" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(760, 900),
    );
    await page.screenshot({ path: "test-results/organize-trees-compact.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    // Multiple receiving addresses can be assigned together, not just renamed
    // individual trees. Run this in the isolated test mailbox only.
    await trees.getByRole("button", { name: "Add group", exact: true }).click();
    await trees.getByLabel("Group name").fill("Projects");
    await trees
      .getByRole("group", { name: "Group color" })
      .getByRole("button", { name: "Red", exact: true })
      .click();
    await trees.getByRole("checkbox", { name: /^owner@example.test/ }).check();
    await trees.getByRole("checkbox", { name: /^shared@example.test/ }).check();
    await trees
      .getByRole("button", { name: "Save groups", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Projects: mail rules" }),
    ).toBeVisible();
    await expect(panel.locator(".handling-note").first()).toContainText(
      "2 addresses in this group",
    );
    await expect(trees).toContainText(
      "One group: category folders go directly in your mailbox",
    );
    await expect(
      trees.getByRole("button", { name: "Red", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const source = panel.getByLabel("Copy settings from");
    await source.selectOption({ label: "Projects" });
    await trees
      .getByRole("button", { name: "Remove group", exact: true })
      .click();
    await trees
      .getByRole("button", { name: "Save groups", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Main: mail rules" }),
    ).toBeVisible();
    await expect(source).toHaveValue("main");
    await expect(panel.locator(".handling-note").first()).toContainText(
      "2 addresses in this group",
    );
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
