import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedBulkMailbox } from "../fixtures/bulk-mailbox";

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
      panel.getByRole("heading", { name: "Choose what happens to your mail" }),
    ).toBeVisible();
    await expect(panel.locator(".handling-sender").first()).toContainText(
      "400",
    );
    const detailed = await panel
      .getByLabel("Group to edit")
      .locator("option")
      .count();
    await panel.getByRole("button", { name: "Fewer", exact: true }).click();
    await expect
      .poll(() => panel.getByLabel("Group to edit").locator("option").count())
      .toBeLessThan(detailed);
    await panel.getByLabel("Group to edit").selectOption("Promotions");
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
    await panel.getByLabel("Group to edit").selectOption("other");
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
      .getByRole("button", { name: "Save choices and rebuild proposal" })
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
      .getByRole("button", { name: "Save choices and rebuild proposal" })
      .click();
    await expect(panel).toContainText("Choices saved. Folder plan updated.");
    // A preview failure must not present old example actions as current.
    await panel.getByLabel("Group to edit").selectOption("Promotions");
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
      panel.getByRole("button", { name: "Save choices and rebuild proposal" }),
    ).toBeDisabled();
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
