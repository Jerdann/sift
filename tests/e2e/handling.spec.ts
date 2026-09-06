import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedSyntheticMailbox } from "../fixtures/synthetic-mailbox";

test("previews handling choices and separates folder creation from message changes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sift-handling-e2e-"));
  seedSyntheticMailbox(root);
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, MAIL_STEWARD_TEST_DATA_ROOT: root },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Organize", exact: true }).click();
    const panel = page.locator(".mail-handling");
    await expect(
      panel.getByRole("heading", {
        name: "Choose what happens to each kind of mail",
      }),
    ).toBeVisible();
    await panel
      .getByLabel("Message type", { exact: true })
      .selectOption("codes");
    await expect(panel.getByLabel("Read status", { exact: true })).toHaveValue(
      "preserve",
    );
    await expect(panel.locator(".handling-examples")).toContainText(
      "Your verification code",
    );
    await panel
      .getByLabel("Message type", { exact: true })
      .selectOption("promotions");
    await panel.getByLabel("Destination", { exact: true }).selectOption("spam");
    await expect(panel.locator(".handling-examples")).toContainText("Spam");
    await panel
      .getByLabel("Offer to remove old messages", { exact: true })
      .selectOption("30");
    await expect(panel.locator(".handling-preview")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await panel.screenshot({ path: "test-results/handling-desktop.png" });
    await panel
      .getByRole("button", { name: "Save choices and rebuild proposal" })
      .click();
    await expect(panel).toContainText("Choices saved");
    const folders = page.locator(".folder-setup");
    await expect(folders).toContainText("Shared home");
    await expect(
      folders.getByRole("button", { name: "Create or reuse selected folders" }),
    ).toBeDisabled();
    await expect(page.locator(".cleanup-review")).toHaveCount(0);
    await folders.screenshot({ path: "test-results/folders-desktop.png" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(760, 900),
    );
    await expect(panel.locator(".handling-preview")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await panel.screenshot({ path: "test-results/handling-compact.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await panel
      .getByLabel("Destination", { exact: true })
      .selectOption("trash");
    await expect(panel.locator(".handling-examples")).toContainText("Trash");
    await panel
      .getByLabel("Apply these choices to", { exact: true })
      .selectOption("shared@example.test");
    await expect(panel).toContainText("You have unsaved choices");
    await expect(
      panel.getByLabel("Apply these choices to", { exact: true }),
    ).toHaveValue("account");
    await panel
      .getByRole("button", { name: "Discard changes and switch" })
      .click();
    await expect(
      panel.getByLabel("Apply these choices to", { exact: true }),
    ).toHaveValue("shared@example.test");
    await expect(panel.getByLabel("Destination", { exact: true })).toHaveValue(
      "spam",
    );
    await expect(panel.locator(".handling-examples")).toContainText("Spam");
    // Simulate a local preview failure; never expose an old preview as current.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("mail-handling:preview");
      ipcMain.handle("mail-handling:preview", () => {
        throw new Error("synthetic_preview_failure");
      });
    });
    await panel.getByLabel("Destination", { exact: true }).selectOption("file");
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
