import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('creates isolated profiles and resumes interrupted work after relaunch', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'mail-steward-e2e-'));
  let electronApp = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MAIL_STEWARD_TEST_DATA_ROOT: dataRoot },
  });

  try {
    let page = await electronApp.firstWindow();
    await expect(page.getByRole('heading', { name: 'A lighter inbox starts here.' })).toBeVisible();

    await page.getByRole('button', { name: 'Create local profile' }).click();
    await page.getByLabel('Profile name').fill('Owner');
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByRole('heading', { name: 'Keep the mail that matters. Clear out the rest.' })).toBeVisible();
    await page.getByRole('button', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connect through Google’s consent screen' })).toBeVisible();
    await page.screenshot({ path: 'test-results/accounts-workspace.png', fullPage: true });

    await page.getByRole('button', { name: /Owner.*Switch profile/ }).click();
    await page.getByRole('button', { name: 'Create local profile' }).click();
    await page.getByLabel('Profile name').fill('Second user');
    await page.getByRole('button', { name: 'Create profile' }).click();

    const rendererBoundary = await page.evaluate(() => ({
      hasNodeRequire: typeof (globalThis as { require?: unknown }).require !== 'undefined',
      popupBlocked: window.open('https://attacker.example.test') === null,
      bridgeMethods: Object.keys(window.emailOrganizer).sort(),
    }));
    expect(rendererBoundary).toEqual({
      hasNodeRequire: false,
      popupBlocked: true,
      bridgeMethods: [
        'analyzeGmail',
        'analyzeMailbox',
        'approveCleanupPlan',
        'approveGmailOrganizationPlan',
        'approveRulePlan',
        'connectGmail',
        'connectProtonBridge',
        'createProfile',
        'diagnoseProtonBridge',
        'disconnectGmail',
        'disconnectProtonBridge',
        'discoverProtonMailbox',
        'editOrganizationProposal',
        'exportProtonRulePlan',
        'exportRulePack',
        'generateCleanupPlan',
        'generateGmailOrganizationPlan',
        'generateOrganizationProposal',
        'generateRulePlan',
        'getCleanupPlan',
        'getCurrentProtonAudit',
        'getGmailAnalysis',
        'getGmailAudit',
        'getGmailConnection',
        'getGmailOrganizationPlan',
        'getGmailSubscriptionDashboard',
        'getJob',
        'getMailboxAnalysis',
        'getOrganizationProposal',
        'getProtonConnection',
        'getProtonDiscovery',
        'getRuleInventory',
        'getRulePlan',
        'getSubscriptionDashboard',
        'getVersion',
        'listAccountIdentities',
        'listMailAccounts',
        'listProfiles',
        'onCleanupProgress',
        'onGmailAuditProgress',
        'onGmailOrganizationProgress',
        'onGmailUnsubscribeProgress',
        'onJobProgress',
        'onProtonAuditProgress',
        'onUnsubscribeProgress',
        'pauseProtonAudit',
        'refreshAccountIdentities',
        'refreshRuleInventory',
        'resumeBulkUnsubscribe',
        'resumeCleanupPlan',
        'resumeGmailBulkUnsubscribe',
        'resumeJob',
        'resumeProtonAudit',
        'retryBulkUnsubscribe',
        'retryCleanupPlan',
        'retryGmailBulkUnsubscribe',
        'retryGmailOrganizationPlan',
        'retryRulePlan',
        'scanGmailSubscriptions',
        'scanSubscriptions',
        'selectMailAccount',
        'selectProfile',
        'startBulkUnsubscribe',
        'startGmailAudit',
        'startGmailBulkUnsubscribe',
        'startProtonAudit',
        'startSyntheticJob',
        'undoCleanupPlan',
        'undoGmailOrganizationPlan',
        'undoRulePlan',
        'updateAccountIdentity',
      ],
    });

    const blockedRemoteFetch = await page.evaluate(async () => {
      try {
        await fetch('https://attacker.example.test/tracker');
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
      args: ['.'],
      cwd: process.cwd(),
      env: { ...process.env, MAIL_STEWARD_TEST_DATA_ROOT: dataRoot },
    });
    page = await electronApp.firstWindow();
    await expect(page.getByText('Owner', { exact: true })).toBeVisible();
    await expect(page.getByText('Second user', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open' }).nth(1).click();

    const recovered = await page.evaluate(
      (jobId) => window.emailOrganizer.getJob({ jobId }),
      job.id,
    );
    expect(recovered.state).toBe('pending');
    expect(recovered.counts.succeeded).toBeGreaterThan(0);
    await page.evaluate(
      (jobId) => window.emailOrganizer.resumeJob({ jobId }),
      job.id,
    );
    await expect
      .poll(
        async () =>
          page.evaluate(
            (jobId) => window.emailOrganizer.getJob({ jobId }).then((progress) => progress.state),
            job.id,
          ),
        { timeout: 15_000 },
      )
      .toBe('succeeded');

    const profileDirectories = readdirSync(path.join(dataRoot, 'profiles'));
    expect(profileDirectories).toHaveLength(2);
  } finally {
    await electronApp.close().catch(() => undefined);
    rmSync(dataRoot, { force: true, recursive: true });
  }
});
