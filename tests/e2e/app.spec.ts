import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("creates isolated profiles and resumes interrupted work after relaunch", async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), "mail-steward-e2e-"));
  let electronApp = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, MAIL_STEWARD_TEST_DATA_ROOT: dataRoot },
  });

  try {
    let page = await electronApp.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Organize email accounts on this computer." }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Privacy & update settings" })
      .click();
    const automaticUpdates = page.getByRole("switch", {
      name: "Download updates automatically",
    });
    await expect(automaticUpdates).not.toBeChecked();
    await page.screenshot({
      path: "test-results/settings-workspace.png",
      fullPage: true,
    });
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(700, 800),
    );
    await page.screenshot({
      path: "test-results/settings-workspace-compact.png",
      fullPage: true,
    });
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 800),
    );
    await automaticUpdates.click();
    await expect(automaticUpdates).toBeChecked();
    await expect(
      page.getByText("Automatic update checks are enabled."),
    ).toBeVisible();
    await automaticUpdates.click();
    await expect(automaticUpdates).not.toBeChecked();
    await expect(
      page.getByText("Automatic update checks are disabled."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back to local profiles" })
      .click();

    await page.getByRole("button", { name: "Create local profile" }).click();
    await page.getByLabel("Profile name").fill("Owner");
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Scan, organize, filter, unsubscribe, and delete.",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Settings",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Download updates automatically" }),
    ).not.toBeChecked();
    await page.getByRole("button", { name: "Accounts", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Connect through Google’s consent screen",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Connect through Microsoft sign-in" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Connect Proton Bridge" }),
    ).toBeVisible();
    await expect(page.getByLabel("OAuth client ID")).toBeVisible();
    await expect(page.getByLabel("Application (client) ID")).toBeVisible();
    await expect(page.getByLabel("Bridge local host")).toHaveValue("127.0.0.1");
    await expect(
      page.getByRole("button", { name: "Open Google sign-in" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Open Microsoft sign-in" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Test connection" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/accounts-workspace.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Recovery", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Back up or repair local Sift data.",
      }),
    ).toBeVisible();
    await expect(page.getByText("Counts only—no mail content")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose backup and restore" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Rebuild local index" }),
    ).toBeDisabled();
    await page.screenshot({
      path: "test-results/recovery-workspace.png",
      fullPage: true,
    });
    const accessibleControls = await page.evaluate(() =>
      [...document.querySelectorAll("button,input,select")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .every((element) => {
          if (element instanceof HTMLButtonElement) {
            return Boolean(
              element.getAttribute("aria-label") ||
                element.title ||
                element.textContent?.trim(),
            );
          }
          return Boolean(
            element.getAttribute("aria-label") ||
              element.getAttribute("aria-labelledby") ||
              element.closest("label"),
          );
        }),
    );
    expect(accessibleControls).toBe(true);
    await expect(
      page.getByRole("button", { name: "Organize", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Addresses", exact: true }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 700, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.screenshot({
      path: "test-results/guided-flow-compact.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("button", { name: /Owner.*Switch profile/ }).click();
    await page.getByRole("button", { name: "Create local profile" }).click();
    await page.getByLabel("Profile name").fill("Second user");
    await page.getByRole("button", { name: "Create profile" }).click();

    const rendererBoundary = await page.evaluate(() => ({
      hasNodeRequire:
        typeof (globalThis as { require?: unknown }).require !== "undefined",
      popupBlocked: window.open("https://attacker.example.test") === null,
      bridgeMethods: Object.keys(window.emailOrganizer).sort(),
    }));
    expect(rendererBoundary).toEqual({
      hasNodeRequire: false,
      popupBlocked: true,
      bridgeMethods: [
        "analyzeGmail",
        "analyzeMailbox",
        "analyzeOutlook",
        "approveCleanupPlan",
        "approveGmailOrganizationPlan",
        "approveOutlookOrganizationPlan",
        "approveRulePlan",
        "confirmProtonRuleImport",
        "connectGmail",
        "connectOutlook",
        "connectProtonBridge",
        "createEncryptedBackup",
        "createProfile",
        "diagnoseProtonBridge",
        "disconnectGmail",
        "disconnectOutlook",
        "disconnectProtonBridge",
        "discoverProtonMailbox",
        "editOrganizationProposal",
        "exportDiagnostics",
        "exportProtonRulePlan",
        "exportRulePack",
        "generateCleanupPlan",
        "generateGmailDeletionPlan",
        "generateGmailOrganizationPlan",
        "generateOrganizationProposal",
        "generateOutlookDeletionPlan",
        "generateOutlookOrganizationPlan",
        "generateRulePlan",
        "getAppSettings",
        "getCleanupPlan",
        "getCurrentProtonAudit",
        "getDiagnostics",
        "getGmailAnalysis",
        "getGmailAudit",
        "getGmailConnection",
        "getGmailDeletionPlan",
        "getGmailOrganizationPlan",
        "getGmailSubscriptionDashboard",
        "getJob",
        "getMailboxAnalysis",
        "getOrganizationProposal",
        "getOutlookAnalysis",
        "getOutlookAudit",
        "getOutlookConnection",
        "getOutlookDeletionPlan",
        "getOutlookOrganizationPlan",
        "getOutlookSubscriptionDashboard",
        "getProtonConnection",
        "getProtonDiscovery",
        "getRuleInventory",
        "getRulePlan",
        "getSubscriptionDashboard",
        "getVersion",
        "listAccountIdentities",
        "listMailAccounts",
        "listProfiles",
        "onCleanupProgress",
        "onGmailAuditProgress",
        "onGmailOrganizationProgress",
        "onGmailUnsubscribeProgress",
        "onJobProgress",
        "onOutlookAuditProgress",
        "onOutlookOrganizationProgress",
        "onOutlookUnsubscribeProgress",
        "onProtonAuditProgress",
        "onUnsubscribeProgress",
        "pauseProtonAudit",
        "rebuildLocalIndex",
        "refreshAccountIdentities",
        "refreshRuleInventory",
        "restoreEncryptedBackup",
        "resumeBulkUnsubscribe",
        "resumeCleanupPlan",
        "resumeGmailBulkUnsubscribe",
        "resumeJob",
        "resumeOutlookBulkUnsubscribe",
        "resumeProtonAudit",
        "retryBulkUnsubscribe",
        "retryCleanupPlan",
        "retryGmailBulkUnsubscribe",
        "retryGmailOrganizationPlan",
        "retryOutlookBulkUnsubscribe",
        "retryOutlookOrganizationPlan",
        "retryRulePlan",
        "scanGmailSubscriptions",
        "scanOutlookSubscriptions",
        "scanSubscriptions",
        "selectMailAccount",
        "selectProfile",
        "startBulkUnsubscribe",
        "startGmailAudit",
        "startGmailBulkUnsubscribe",
        "startOutlookAudit",
        "startOutlookBulkUnsubscribe",
        "startProtonAudit",
        "startSyntheticJob",
        "undoCleanupPlan",
        "undoGmailOrganizationPlan",
        "undoOutlookOrganizationPlan",
        "undoRulePlan",
        "updateAccountIdentity",
        "updateAppSettings",
      ],
    });

    const blockedRemoteFetch = await page.evaluate(async () => {
      try {
        await fetch("https://attacker.example.test/tracker");
        return false;
      } catch {
        return true;
      }
    });
    expect(blockedRemoteFetch).toBe(true);

    const job = await page.evaluate(() =>
      window.emailOrganizer.startSyntheticJob({ totalItems: 100 }),
    );
    await page.waitForTimeout(120);
    await electronApp.close();

    electronApp = await electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, MAIL_STEWARD_TEST_DATA_ROOT: dataRoot },
    });
    page = await electronApp.firstWindow();
    await expect(page.getByText("Owner", { exact: true })).toBeVisible();
    await expect(page.getByText("Second user", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open" }).nth(1).click();

    expect(
      await page.evaluate(() => window.emailOrganizer.getAppSettings()),
    ).toMatchObject({ autoUpdateEnabled: false });

    const recovered = await page.evaluate(
      (jobId) => window.emailOrganizer.getJob({ jobId }),
      job.id,
    );
    expect(recovered.state).toBe("pending");
    expect(recovered.counts.succeeded).toBeGreaterThan(0);
    await page.evaluate(
      (jobId) => window.emailOrganizer.resumeJob({ jobId }),
      job.id,
    );
    await expect
      .poll(
        async () =>
          page.evaluate(
            (jobId) =>
              window.emailOrganizer
                .getJob({ jobId })
                .then((progress) => progress.state),
            job.id,
          ),
        { timeout: 15_000 },
      )
      .toBe("succeeded");

    const profileDirectories = readdirSync(path.join(dataRoot, "profiles"));
    expect(profileDirectories).toHaveLength(2);
  } finally {
    await electronApp.close().catch(() => undefined);
    rmSync(dataRoot, { force: true, recursive: true });
  }
});
