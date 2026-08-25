import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HandlerDetails, Session, WebContents } from 'electron';
import { EMAIL_ORGANIZER_BRIDGE_METHODS } from '../../src/shared/ipc';
import {
  APP_ORIGIN,
  assertTrustedIpcSender,
  CONTENT_SECURITY_POLICY,
  denyWindowOpen,
  isTrustedRendererUrl,
  SECURE_WEB_PREFERENCES,
  secureSession,
  secureWebContents,
} from '../../src/main/window-security';

describe('desktop security boundary', () => {
  it('uses fail-closed BrowserWindow preferences', () => {
    expect(SECURE_WEB_PREFERENCES).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
  });

  it('allows only the application origin or exact development origin', () => {
    expect(isTrustedRendererUrl(APP_ORIGIN)).toBe(true);
    expect(isTrustedRendererUrl(`${APP_ORIGIN}assets/app.js`)).toBe(true);
    expect(isTrustedRendererUrl('https://example.com')).toBe(false);
    expect(isTrustedRendererUrl('javascript:alert(1)')).toBe(false);
    expect(isTrustedRendererUrl('file:///C:/private.txt')).toBe(false);
    expect(
      isTrustedRendererUrl('http://localhost:5173/', 'http://localhost:5173/'),
    ).toBe(true);
    expect(
      isTrustedRendererUrl('http://localhost.attacker.test:5173/', 'http://localhost:5173/'),
    ).toBe(false);
  });

  it('rejects IPC from absent and untrusted frames', () => {
    expect(() => assertTrustedIpcSender(undefined)).toThrow('untrusted renderer');
    expect(() => assertTrustedIpcSender('https://attacker.test')).toThrow(
      'untrusted renderer',
    );
    expect(() => assertTrustedIpcSender(APP_ORIGIN)).not.toThrow();
  });

  it('denies permissions, popup windows, and foreign navigation', () => {
    let permissionCheck!: () => boolean;
    let permissionRequest!: (
      webContents: WebContents | null,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void;
    let navigateHandler!: (
      event: { preventDefault(): void },
      targetUrl: string,
    ) => void;
    let openHandler!: (details: HandlerDetails) => { action: 'deny' };

    const fakeSession = {
      setPermissionCheckHandler: (handler: typeof permissionCheck) => {
        permissionCheck = handler;
      },
      setPermissionRequestHandler: (handler: typeof permissionRequest) => {
        permissionRequest = handler;
      },
      webRequest: { onHeadersReceived: () => undefined },
    } as unknown as Session;

    const fakeWebContents = {
      on: (_event: string, handler: typeof navigateHandler) => {
        navigateHandler = handler;
      },
      setWindowOpenHandler: (handler: typeof openHandler) => {
        openHandler = handler;
      },
    } as unknown as WebContents;

    secureSession(fakeSession);
    secureWebContents(fakeWebContents);

    expect(permissionCheck()).toBe(false);
    let permissionAllowed = true;
    permissionRequest(null, 'notifications', (allowed) => {
      permissionAllowed = allowed;
    });
    expect(permissionAllowed).toBe(false);
    expect(openHandler({} as HandlerDetails)).toEqual({ action: 'deny' });
    expect(denyWindowOpen({} as HandlerDetails)).toEqual({ action: 'deny' });

    let prevented = false;
    navigateHandler(
      { preventDefault: () => { prevented = true; } },
      'https://attacker.test',
    );
    expect(prevented).toBe(true);
  });

  it('pins a restrictive CSP without unsafe script or remote access', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
    );
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-inline');
    expect(CONTENT_SECURITY_POLICY).not.toContain('http:');
  });

  it('exposes a closed bridge and no raw HTML rendering primitive', () => {
    expect(EMAIL_ORGANIZER_BRIDGE_METHODS).toEqual([
      'getVersion',
      'listMailAccounts',
      'selectMailAccount',
      'listAccountIdentities',
      'refreshAccountIdentities',
      'updateAccountIdentity',
      'getOrganizationProposal',
      'generateOrganizationProposal',
      'editOrganizationProposal',
      'getRuleInventory',
      'refreshRuleInventory',
      'getRulePlan',
      'generateRulePlan',
      'approveRulePlan',
      'retryRulePlan',
      'undoRulePlan',
      'exportProtonRulePlan',
      'listProfiles',
      'createProfile',
      'selectProfile',
      'startSyntheticJob',
      'getJob',
      'resumeJob',
      'onJobProgress',
      'getProtonConnection',
      'diagnoseProtonBridge',
      'connectProtonBridge',
      'disconnectProtonBridge',
      'discoverProtonMailbox',
      'getProtonDiscovery',
      'startProtonAudit',
      'getCurrentProtonAudit',
      'resumeProtonAudit',
      'pauseProtonAudit',
      'onProtonAuditProgress',
      'getMailboxAnalysis',
      'analyzeMailbox',
      'exportRulePack',
      'getGmailConnection',
      'connectGmail',
      'disconnectGmail',
      'getGmailAudit',
      'startGmailAudit',
      'onGmailAuditProgress',
      'getGmailAnalysis',
      'analyzeGmail',
      'getGmailOrganizationPlan',
      'generateGmailOrganizationPlan',
      'approveGmailOrganizationPlan',
      'retryGmailOrganizationPlan',
      'undoGmailOrganizationPlan',
      'onGmailOrganizationProgress',
      'getGmailSubscriptionDashboard',
      'scanGmailSubscriptions',
      'startGmailBulkUnsubscribe',
      'resumeGmailBulkUnsubscribe',
      'retryGmailBulkUnsubscribe',
      'onGmailUnsubscribeProgress',
      'getCleanupPlan',
      'generateCleanupPlan',
      'approveCleanupPlan',
      'resumeCleanupPlan',
      'retryCleanupPlan',
      'undoCleanupPlan',
      'onCleanupProgress',
      'getSubscriptionDashboard',
      'scanSubscriptions',
      'startBulkUnsubscribe',
      'resumeBulkUnsubscribe',
      'retryBulkUnsubscribe',
      'onUnsubscribeProgress',
    ]);

    const preload = readFileSync(resolve('src/preload/preload.ts'), 'utf8');
    const renderer = readFileSync(resolve('src/renderer/App.tsx'), 'utf8');
    const main = readFileSync(resolve('src/main/index.ts'), 'utf8');
    const protonClient = readFileSync(resolve('src/main/proton/bridge-client.ts'), 'utf8');
    expect(preload).not.toMatch(/invoke\(\s*[a-zA-Z_$][\w$]*\s*[,)]/);
    expect(preload).not.toContain('sendSync');
    expect(renderer).not.toContain('dangerouslySetInnerHTML');
    expect(renderer).not.toContain('style={{');
    expect(renderer).not.toMatch(/from ['"](?:electron|node:)/);
    expect(main).toContain('registerSchemesAsPrivileged');
    expect(main).toContain('app.enableSandbox()');
    expect(main).toContain('safeStorage');
    expect(main).toContain('new SafeStorageVault');
    expect(main).not.toContain('loadFile(');
    for (const mutation of [
      'messageFlagsSet', 'messageFlagsAdd', 'messageFlagsRemove', 'messageDelete',
      'messageMove', 'mailboxCreate', 'mailboxDelete', 'append(',
    ]) expect(protonClient).not.toContain(mutation);
    expect(protonClient).toContain('const MAX_TEXT_BYTES = 32_768');
    expect(protonClient).toContain("root.disposition?.toLowerCase() !== 'attachment'");
  });
});
