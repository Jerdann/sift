import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeGmailCode, refreshGmailAccessToken } from '../../src/main/gmail/gmail-oauth';
import { GmailConnectionRepository } from '../../src/main/gmail/gmail-connection-repository';
import { GmailAuditService } from '../../src/main/gmail/gmail-audit-service';
import { GmailAnalysisService } from '../../src/main/gmail/gmail-analysis-service';
import { GmailOrganizationRepository } from '../../src/main/gmail/gmail-organization-repository';
import { GmailOrganizationRunner } from '../../src/main/gmail/gmail-organization-runner';
import { GmailSubscriptionService } from '../../src/main/gmail/gmail-subscription-service';
import { AccountIdentityRepository } from '../../src/main/identity/account-identity-repository';
import { JobRepository } from '../../src/main/jobs/job-repository';
import { OrganizationProposalRepository } from '../../src/main/organization/organization-proposal-repository';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { SafeStorageVault, type SafeStoragePort } from '../../src/main/secrets/safe-storage-vault';
import { UnsubscribeRunner } from '../../src/main/unsubscribe/unsubscribe-runner';
import type { GmailAuditSummary } from '../../src/shared/contracts/gmail';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const storage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString(),
};

describe('Gmail OAuth connection', () => {
  it('uses PKCE token exchange and refresh without putting credentials in URLs', async () => {
    const fetchPort = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const input = { clientId: 'synthetic-client-id.apps.googleusercontent.com' };
    await expect(exchangeGmailCode(input, 'authorization-code', 'verifier', 'http://127.0.0.1:1234/oauth2callback', fetchPort as typeof fetch)).resolves.toMatchObject({ refresh_token: 'refresh' });
    const firstBody = fetchPort.mock.calls[0]![1]!.body as URLSearchParams;
    expect(firstBody.get('code_verifier')).toBe('verifier');
    expect(firstBody.get('client_secret')).toBeNull();
    await expect(refreshGmailAccessToken(input.clientId, 'refresh', undefined, fetchPort as typeof fetch)).resolves.toBe('access');
    expect(String(fetchPort.mock.calls[1]![0])).toBe('https://oauth2.googleapis.com/token');
  });

  it('stores refresh access encrypted and isolates it from summaries', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-gmail-')); roots.push(root);
    const profileId = '881596c7-8676-48d2-90e0-4c64ac402419';
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Gmail owner');
    const vault = new SafeStorageVault(root, profile.database, storage);
    const repository = new GmailConnectionRepository(profile.database, vault, profileId, { createId: () => 'e39a9273-2842-4b4d-a8ae-e930918176cc' });
    const summary = repository.save({ clientId: 'synthetic-client-id.apps.googleusercontent.com' }, 'owner@example.test', 'do-not-render-me');
    expect(summary).toMatchObject({ email: 'owner@example.test', state: 'connected' });
    expect(JSON.stringify(summary)).not.toContain('do-not-render-me');
    expect(repository.credentials()?.refreshToken).toBe('do-not-render-me');
    repository.disconnect(summary.id);
    expect(repository.get()).toBeNull();
    profile.database.close();
  });

  it('indexes Gmail metadata page-by-page and completes without downloading message bodies', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-gmail-audit-')); roots.push(root);
    const profileId = 'd4273c54-a1c6-4685-987c-d3c49d8e90ec';
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Gmail audit');
    const vault = new SafeStorageVault(root, profile.database, storage);
    const repository = new GmailConnectionRepository(profile.database, vault, profileId, { createId: () => '6f647139-7eb2-463b-9055-0ac24d2baf8a' });
    repository.save({ clientId: 'synthetic-client-id.apps.googleusercontent.com' }, 'owner@example.test', 'refresh');
    const fetchPort = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'access', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
      if (/\/messages\?/.test(value)) return new Response(JSON.stringify({ messages: [{ id: 'gmail-1', threadId: 'thread-1' }], resultSizeEstimate: 1 }), { status: 200 });
      return new Response(JSON.stringify({ id: 'gmail-1', threadId: 'thread-1', internalDate: '1787565600000', labelIds: ['INBOX', 'UNREAD'], sizeEstimate: 321, payload: { headers: [{ name: 'Subject', value: 'Receipt for your payment' }, { name: 'From', value: 'Store <billing@store.example>' }, { name: 'To', value: 'owner@example.test' }, { name: 'Delivered-To', value: 'owner@example.test' }] } }), { status: 200 });
    });
    const progress: GmailAuditSummary[] = [];
    const service = new GmailAuditService(profile.database, repository, { fetchPort: fetchPort as typeof fetch, createId: () => 'c08ac9e2-4958-47f6-8cc3-39aa08f0980f' });
    const result = await service.run((summary) => progress.push(summary));
    expect(result).toMatchObject({ state: 'completed', indexedMessages: 1, totalEstimate: 1 });
    expect(progress[0]?.state).toBe('scanning');
    const row = profile.database.prepare('SELECT * FROM gmail_indexed_messages').get() as { subject: string; headers_json: string };
    expect(row.subject).toBe('Receipt for your payment');
    expect(row.headers_json).not.toContain('body');
    expect(fetchPort.mock.calls.some((call) => String(call[0]).includes('format=metadata'))).toBe(true);
    profile.database.prepare(`INSERT INTO gmail_indexed_messages(id,connection_id,gmail_message_id,thread_id,received_at,subject,sender_json,recipients_json,headers_json,label_ids_json,size_bytes,indexed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('26965ae0-857c-44dc-b267-7fa9374ae90d', repository.get()!.id, 'gmail-2', 'thread-2', '2026-08-24T12:00:00.000Z', 'Weekly engineering digest', '["news@news.example"]', '["owner@example.test"]', JSON.stringify({ 'delivered-to': 'owner@example.test', 'list-id': '<weekly.news.example>', 'list-unsubscribe': '<https://news.example/unsubscribe/opaque>', 'list-unsubscribe-post': 'List-Unsubscribe=One-Click', 'authentication-results': 'dkim=pass; dmarc=pass' }), '["INBOX","UNREAD"]', 400, '2026-08-24T12:00:00.000Z');
    const analysis = new GmailAnalysisService(profile.database, profileId).analyze(repository.get()!);
    expect(analysis.uniqueMessages).toBe(2);
    expect(analysis.categories).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'transactions', proposedFolder: 'Money/Receipts' }), expect.objectContaining({ category: 'subscriptions', proposedFolder: 'Subscriptions' })]));
    expect(analysis.addresses[0]).toMatchObject({ address: 'owner@example.test', recommendation: 'retain' });
    const jobs = new JobRepository(profile.database);
    const unsubscribePost = vi.fn(async () => true);
    const gmailSubscriptions = new GmailSubscriptionService(profile.database, jobs, profileId);
    const subscriptionScan = gmailSubscriptions.scan(repository.get()!.id);
    const eligibleSubscription = subscriptionScan.candidates.find((candidate) => candidate.eligibility === 'eligible')!;
    const started = gmailSubscriptions.start([eligibleSubscription.id]);
    const unsubscribed = (await new UnsubscribeRunner(jobs, gmailSubscriptions, unsubscribePost).run(started.job!.id)).dashboard;
    expect(unsubscribed.candidates.find((candidate) => candidate.id === eligibleSubscription.id)?.status).toBe('unsubscribed');
    expect(unsubscribePost).toHaveBeenCalledWith('https://news.example/unsubscribe/opaque');
    new AccountIdentityRepository(profile.database, profileId).sync('gmail', repository.get()!.id, [{
      address: 'owner@example.test', evidence: ['provider_primary'], sentFromCount: 0, deliveredToCount: 2,
      providerEvidence: true, lastSeenAt: '2026-08-24T12:00:00.000Z',
    }]);
    new OrganizationProposalRepository(profile.database, profileId).generate('gmail', repository.get()!.id);
    const organization = new GmailOrganizationRepository(profile.database, jobs, profileId);
    const plan = organization.generate(repository.get()!);
    expect(plan).toMatchObject({ state: 'draft', impactCount: 2, existingMessageCount: 2, batchCount: 2 });
    const approved = organization.approve(repository.get()!.id, plan.id, plan.revision);
    const providerLabels = new Map<string, string[]>([['gmail-1', ['INBOX', 'UNREAD']], ['gmail-2', ['INBOX', 'UNREAD']]]);
    let failAfterNextModify = false;
    const actionFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'access', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
      if (value.endsWith('/labels') && !init?.method) return new Response(JSON.stringify({ labels: [] }), { status: 200 });
      if (value.endsWith('/labels')) return new Response(JSON.stringify({ id: 'Label_123' }), { status: 200 });
      if (value.includes('/messages/') && value.includes('?format=minimal')) {
        const id = decodeURIComponent(value.split('/messages/')[1]!.split('?')[0]!);
        return new Response(JSON.stringify({ id, labelIds: providerLabels.get(id) ?? [] }), { status: 200 });
      }
      if (value.endsWith('/messages/batchModify')) {
        const body = JSON.parse(String(init?.body)) as { ids: string[]; addLabelIds: string[]; removeLabelIds: string[] };
        for (const id of body.ids) providerLabels.set(id, [...new Set([...(providerLabels.get(id) ?? []), ...body.addLabelIds])].filter((label) => !body.removeLabelIds.includes(label)).sort());
        if (failAfterNextModify) { failAfterNextModify = false; return new Response(null, { status: 500 }); }
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 204 });
    });
    await new GmailOrganizationRunner(repository, organization, jobs, actionFetch as typeof fetch).run(approved.job!.id);
    const completed = organization.get(repository.get()!.id)!;
    expect(completed.state).toBe('completed');
    expect(completed.impacts[0]?.state).toBe('succeeded');
    const batchCall = actionFetch.mock.calls.find((call) => String(call[0]).endsWith('/messages/batchModify'))!;
    expect(JSON.parse(String(batchCall[1]?.body))).toMatchObject({ addLabelIds: ['Label_123'], removeLabelIds: ['INBOX', 'UNREAD'] });
    expect(actionFetch.mock.calls.some((call) => String(call[0]).includes('/settings/filters'))).toBe(false);
    const undoPlan = organization.prepareUndo(completed.id);
    const undone = await new GmailOrganizationRunner(repository, organization, jobs, actionFetch as typeof fetch).undo(undoPlan.undoJob!.id);
    expect(undone.undoJob?.state).toBe('succeeded');
    expect(providerLabels.get('gmail-1')).toEqual(['INBOX', 'UNREAD']);
    expect(providerLabels.get('gmail-2')).toEqual(['INBOX', 'UNREAD']);

    const crashPlan = organization.generate(repository.get()!);
    const crashApproved = organization.approve(repository.get()!.id, crashPlan.id, crashPlan.revision);
    failAfterNextModify = true;
    const firstAttempt = await new GmailOrganizationRunner(repository, organization, jobs, actionFetch as typeof fetch).run(crashApproved.job!.id);
    expect(firstAttempt.failedBatches).toHaveLength(1);
    const modifyCount = actionFetch.mock.calls.filter((call) => String(call[0]).endsWith('/messages/batchModify')).length;
    const retried = organization.retry(firstAttempt.id, firstAttempt.failedBatches.map((batch) => batch.id));
    const recovered = await new GmailOrganizationRunner(repository, organization, jobs, actionFetch as typeof fetch).run(retried.job!.id);
    expect(recovered.state).toBe('completed');
    expect(actionFetch.mock.calls.filter((call) => String(call[0]).endsWith('/messages/batchModify'))).toHaveLength(modifyCount);
    profile.database.close();
  });
});
