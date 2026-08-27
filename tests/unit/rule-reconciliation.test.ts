import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeGmailFilter, sha256 } from '../../src/core/rules/rule-reconciliation';
import { GmailAnalysisService } from '../../src/main/gmail/gmail-analysis-service';
import { GmailConnectionRepository } from '../../src/main/gmail/gmail-connection-repository';
import { GmailRuleInventoryService } from '../../src/main/gmail/gmail-rule-inventory-service';
import { GmailRuleReconciliationRunner } from '../../src/main/gmail/gmail-rule-reconciliation-runner';
import { AccountIdentityRepository } from '../../src/main/identity/account-identity-repository';
import { OrganizationProposalRepository } from '../../src/main/organization/organization-proposal-repository';
import { JobRepository } from '../../src/main/jobs/job-repository';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { RuleReconciliationRepository } from '../../src/main/rules/rule-reconciliation-repository';
import { SafeStorageVault, type SafeStoragePort } from '../../src/main/secrets/safe-storage-vault';
import type { DesiredManagedRule, ProviderRuleSnapshot } from '../../src/shared/contracts/rule-management';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const storage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString(),
};

const providerSnapshot = (id: string, desired: DesiredManagedRule): Omit<ProviderRuleSnapshot, 'stableKey' | 'ownership'> => ({
  providerRuleId: id,
  fingerprint: desired.fingerprint,
  criteria: {
    from: `@${desired.senderDomain}`,
    to: desired.receivingAddress,
    subject: null,
    query: null,
    negatedQuery: null,
    hasAttachment: null,
  },
  action: {
    addLabels: [desired.spam ? 'SPAM' : desired.targetPath],
    removeLabels: [...(desired.archive ? ['INBOX'] : []), ...(desired.markRead ? ['UNREAD'] : [])].sort(),
  },
});

const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sift-rules-')); roots.push(root);
  const profileId = '592ba97f-e105-44ce-9341-c9997e1ae9d1';
  const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Rule owner');
  const vault = new SafeStorageVault(root, profile.database, storage);
  const connections = new GmailConnectionRepository(profile.database, vault, profileId, {
    createId: () => '244a769c-11bd-42c4-99cc-65a6ce368f64',
    now: () => '2026-08-25T12:00:00.000Z',
  });
  const connection = connections.save({ clientId: 'synthetic-client.apps.googleusercontent.com' }, 'owner@example.test', 'refresh-value');
  const insert = profile.database.prepare(`INSERT INTO gmail_indexed_messages(
    id,connection_id,gmail_message_id,thread_id,received_at,subject,sender_json,recipients_json,
    headers_json,label_ids_json,size_bytes,indexed_at
  ) VALUES (?,?,?,?,?,?,?,?,?, '[]',100,'2026-08-25T12:00:00.000Z')`);
  const add = (id: string, sender: string, subject: string, headers: Record<string, string> = {}) => insert.run(
    id, connection.id, id, `thread-${id}`, '2026-08-25T10:00:00.000Z', subject,
    JSON.stringify([sender]), '["owner@example.test"]',
    JSON.stringify({ 'delivered-to': 'owner@example.test', ...headers }),
  );
  add('72ea544e-8999-461d-8bde-287f03e1b2b1', 'mail@offers.example', '50% off today', { 'list-id': 'offers.example' });
  add('ce34d6aa-811d-4a99-9e02-0cc95e404834', 'mail@offers.example', 'Last chance sale', { 'list-id': 'offers.example' });
  add('afafc196-49af-4ec5-8d67-62aa05295662', 'alerts@secure.example', 'New login security alert');
  new GmailAnalysisService(profile.database, profileId).analyze(connection);
  new AccountIdentityRepository(profile.database, profileId).update({
    provider: 'gmail', connectionId: connection.id, address: 'owner@example.test', status: 'confirmed',
    containerEnabled: true, containerName: 'Primary',
  });
  new GmailAnalysisService(profile.database, profileId).analyze(connection);
  new OrganizationProposalRepository(profile.database, profileId).generate('gmail', connection.id);
  const rules = new RuleReconciliationRepository(profile.database, profileId, { now: () => '2026-08-25T12:30:00.000Z' });
  return { profile, profileId, connection, connections, rules };
};

describe('provider rule inventory and reconciliation', () => {
  it('normalizes Gmail filter ordering into one semantic fingerprint', () => {
    const labelNames = new Map([['Label_2', 'Primary/Promotions'], ['INBOX', 'INBOX'], ['UNREAD', 'UNREAD']]);
    const left = normalizeGmailFilter({
      id: 'filter-left', criteria: { from: ' @OFFERS.EXAMPLE ', to: 'OWNER@EXAMPLE.TEST' },
      action: { addLabelIds: ['Label_2'], removeLabelIds: ['UNREAD', 'INBOX'] },
    }, labelNames);
    const right = normalizeGmailFilter({
      id: 'filter-right', criteria: { to: 'owner@example.test', from: '@offers.example' },
      action: { removeLabelIds: ['INBOX', 'UNREAD'], addLabelIds: ['Label_2'] },
    }, labelNames);
    expect(left.fingerprint).toBe(right.fingerprint);
    expect(left.criteria.from).toBe('@offers.example');
    expect(left.action.removeLabels).toEqual(['INBOX', 'UNREAD']);
  });

  it('adopts an exact external match, creates missing rules, and never plans against unrelated filters', () => {
    const { profile, connection, rules } = setup();
    const desired = rules.desired('gmail', connection.id).rules;
    expect(desired).toHaveLength(2);
    const exact = providerSnapshot('existing-exact', desired[0]!);
    const unrelated = {
      providerRuleId: 'external-unrelated',
      fingerprint: sha256('external-unrelated'),
      criteria: { from: '@friend.example', to: null, subject: null, query: null, negatedQuery: null, hasAttachment: null },
      action: { addLabels: ['Personal'], removeLabels: [] },
    };
    rules.saveInventory('gmail', connection.id, 'live_api', [exact, unrelated], 1_000);
    const plan = rules.generate('gmail', connection.id);
    expect(plan.operations.map((operation) => operation.kind).sort()).toEqual(['adopt', 'create']);
    expect(plan.operations.find((operation) => operation.kind === 'adopt')?.prior?.providerRuleId).toBe('existing-exact');
    expect(plan.operations.some((operation) => operation.prior?.providerRuleId === 'external-unrelated')).toBe(false);
    const regenerated = rules.generate('gmail', connection.id);
    expect(regenerated.revision).toBe(plan.revision);
    profile.database.close();
  });

  it('can explicitly replace unmatched external rules while retaining exact matches', () => {
    const { profile, connection, rules } = setup();
    const desired = rules.desired('gmail', connection.id).rules;
    const exact = providerSnapshot('existing-exact', desired[0]!);
    const unrelated = {
      providerRuleId: 'external-unrelated',
      fingerprint: sha256('external-unrelated'),
      criteria: { from: '@old-noise.example', to: null, subject: null, query: null, negatedQuery: null, hasAttachment: null },
      action: { addLabels: ['Old'], removeLabels: [] },
    };
    rules.saveInventory('gmail', connection.id, 'live_api', [exact, unrelated], 1_000, ['INBOX', 'Old']);

    const plan = rules.generate('gmail', connection.id, true);
    expect(plan.operations.find((operation) => operation.kind === 'adopt')?.prior?.providerRuleId)
      .toBe('existing-exact');
    expect(plan.operations).toContainEqual(expect.objectContaining({
      kind: 'remove',
      desired: null,
      prior: expect.objectContaining({ providerRuleId: 'external-unrelated', ownership: 'external' }),
    }));
    profile.database.close();
  });

  it('creates a quiet-inbox rule for a repeated uncertain sender stream', () => {
    const { profile, profileId, connection, rules } = setup();
    const insert = profile.database.prepare(`INSERT INTO gmail_indexed_messages(
      id,connection_id,gmail_message_id,thread_id,received_at,subject,sender_json,recipients_json,
      headers_json,label_ids_json,size_bytes,indexed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,'[]',100,'2026-08-25T12:00:00.000Z')`);
    for (let index = 0; index < 3; index += 1) {
      const id = `8bedbe5c-1c80-4e82-a566-72bb60c8e90${index}`;
      insert.run(
        id, connection.id, id, `thread-unsorted-${index}`, '2026-08-25T10:00:00.000Z',
        `Generic update ${index}`, '["updates@company.example"]', '["owner@example.test"]',
        '{"delivered-to":"owner@example.test"}',
      );
    }
    new GmailAnalysisService(profile.database, profileId).analyze(connection);
    new OrganizationProposalRepository(profile.database, profileId).generate('gmail', connection.id);

    const desired = rules.desired('gmail', connection.id).rules.find(
      (rule) => rule.senderDomain === 'company.example',
    );
    expect(desired).toMatchObject({
      category: 'other', targetPath: 'Primary/Review/Unsorted',
      markRead: true, archive: true, observedMessages: 3,
    });
    profile.database.close();
  });

  it('uses the latest mailbox scan when the folder proposal points to an older scan', () => {
    const { profile, profileId, connection, rules } = setup();
    const insert = profile.database.prepare(`INSERT INTO gmail_indexed_messages(
      id,connection_id,gmail_message_id,thread_id,received_at,subject,sender_json,recipients_json,
      headers_json,label_ids_json,size_bytes,indexed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,'[]',100,'2026-08-25T12:00:00.000Z')`);
    insert.run(
      '66a67bd3-3d82-4fb1-adce-542796e65b52', connection.id,
      '66a67bd3-3d82-4fb1-adce-542796e65b52', 'thread-second-offer',
      '2026-08-25T11:00:00.000Z', 'Another limited sale',
      '["mail@second-offers.example"]', '["owner@example.test"]',
      '{"delivered-to":"owner@example.test","list-id":"second-offers.example"}',
    );

    new GmailAnalysisService(profile.database, profileId).analyze(connection);

    const desired = rules.desired('gmail', connection.id).rules;
    expect(desired.length).toBeGreaterThan(0);
    expect(desired.some((rule) => rule.senderDomain === 'second-offers.example')).toBe(true);
    profile.database.close();
  });

  it('uses a stable identity when a correction requires replacing a managed rule', () => {
    const { profile, profileId, connection, rules } = setup();
    const firstDesired = rules.desired('gmail', connection.id).rules.find((rule) => rule.category === 'promotions')!;
    const now = '2026-08-25T12:20:00.000Z';
    profile.database.prepare(`INSERT INTO managed_rules(
      id,profile_id,provider,connection_id,stable_key,provider_rule_id,fingerprint,desired_json,ownership,state,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`).run(
      '59ba97f-e105-44ce-9341-c9997e1ae9d2', profileId, 'gmail', connection.id,
      firstDesired.stableKey, 'managed-filter-1', firstDesired.fingerprint, JSON.stringify(firstDesired), 'managed', now, now,
    );
    rules.saveInventory('gmail', connection.id, 'live_api', [providerSnapshot('managed-filter-1', firstDesired)], 1_000);
    const proposal = new OrganizationProposalRepository(profile.database, profileId).get('gmail', connection.id)!;
    const promotion = proposal.items.find((item) => item.category === 'promotions')!;
    new OrganizationProposalRepository(profile.database, profileId).edit({
      proposalId: proposal.id, revision: proposal.revision, itemId: promotion.id,
      category: 'subscriptions', targetPath: 'Primary/Subscriptions/Offers', enabled: true,
    });
    const corrected = rules.desired('gmail', connection.id).rules.find((rule) => rule.senderDomain === firstDesired.senderDomain)!;
    expect(corrected.stableKey).toBe(firstDesired.stableKey);
    expect(corrected.fingerprint).not.toBe(firstDesired.fingerprint);
    const plan = rules.generate('gmail', connection.id);
    expect(plan.operations.find((operation) => operation.stableKey === firstDesired.stableKey)?.kind).toBe('replace');
    profile.database.close();
  });

  it('reads Gmail labels and filters without mutating provider state', async () => {
    const { profile, connection, connections, rules } = setup();
    const fetchPort = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'access', expires_in: 3600, token_type: 'Bearer' }));
      if (url.endsWith('/labels')) return new Response(JSON.stringify({ labels: [{ id: 'Label_1', name: 'Primary/Promotions' }] }));
      if (url.endsWith('/settings/filters')) return new Response(JSON.stringify({ filter: [{
        id: 'provider-filter-1', criteria: { from: '@offers.example', to: 'owner@example.test' },
        action: { addLabelIds: ['Label_1'], removeLabelIds: ['INBOX', 'UNREAD'] },
      }] }));
      return new Response(null, { status: 404 });
    });
    const inventory = await new GmailRuleInventoryService(connections, rules, fetchPort).refresh(connection.id);
    expect(inventory).toMatchObject({ provider: 'gmail', capability: 'live_api', providerLimit: 1_000 });
    expect(inventory.rules[0]).toMatchObject({ providerRuleId: 'provider-filter-1', ownership: 'external' });
    expect(inventory.rules[0]?.action.addLabels).toEqual(['Primary/Promotions']);
    expect(inventory.containers).toEqual(['Primary/Promotions']);
    const providerReads = fetchPort.mock.calls.filter((call) => String(call[0]).includes('gmail.googleapis.com'));
    expect(providerReads.every((call) => !call[1]?.method || call[1]?.method === 'GET')).toBe(true);
    profile.database.close();
  });

  it('resumes after a provider create without duplicating the Gmail filter', async () => {
    const { profile, profileId, connection, connections } = setup();
    const proposalRepository = new OrganizationProposalRepository(profile.database, profileId);
    const proposal = proposalRepository.get('gmail', connection.id)!;
    const security = proposal.items.find((item) => item.category === 'security')!;
    proposalRepository.edit({
      proposalId: proposal.id, revision: proposal.revision, itemId: security.id,
      category: security.category, targetPath: security.targetPath, enabled: false,
    });
    const jobs = new JobRepository(profile.database);
    const rules = new RuleReconciliationRepository(profile.database, profileId, { jobs });
    rules.saveInventory('gmail', connection.id, 'live_api', [], 1_000);
    const draft = rules.generate('gmail', connection.id);
    expect(draft.operations).toHaveLength(1);
    expect(() => rules.approve(draft.id, draft.revision)).toThrow('organization_folders_required');
    const appliedProposal = proposalRepository.get('gmail', connection.id)!;
    profile.database.prepare(`
      INSERT INTO gmail_organization_plans(
        id,connection_id,analysis_id,revision,state,skipped_ambiguous_streams,
        created_at,approved_at,proposal_id,proposal_revision,job_id,undo_job_id,plan_kind
      )
      SELECT ?,?,id,?,'completed',0,?,?,?,?,NULL,NULL,'organize'
      FROM gmail_mailbox_analyses WHERE connection_id=? ORDER BY rowid DESC LIMIT 1
    `).run(
      'df77dc85-7ef8-40ba-8b52-5acba8d9a119', connection.id,
      'completed-history-revision', '2026-08-25T12:25:00.000Z',
      '2026-08-25T12:26:00.000Z', appliedProposal.id,
      appliedProposal.revision, connection.id,
    );
    const approved = rules.approve(draft.id, draft.revision);
    expect(approved.job).not.toBeNull();

    const filters: Array<{ id: string; criteria: { from: string; to?: string }; action: { addLabelIds: string[]; removeLabelIds: string[] } }> = [];
    let filterReads = 0;
    const fetchPort = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'access', expires_in: 3600, token_type: 'Bearer' }));
      if (url.endsWith('/labels') && !init?.method) return new Response(JSON.stringify({ labels: [{ id: 'Label_1', name: 'Primary/Promotions' }] }));
      if (url.endsWith('/settings/filters') && !init?.method) {
        filterReads += 1;
        if (filterReads === 2) return new Response(null, { status: 500 });
        return new Response(JSON.stringify({ filter: filters }));
      }
      if (url.endsWith('/settings/filters') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { criteria: { from: string; to?: string }; action: { addLabelIds: string[]; removeLabelIds: string[] } };
        filters.push({ id: 'created-filter-1', ...payload });
        return new Response(JSON.stringify({ id: 'created-filter-1' }));
      }
      if (url.includes('/settings/filters/') && init?.method === 'DELETE') {
        const id = decodeURIComponent(url.split('/').at(-1)!);
        const index = filters.findIndex((filter) => filter.id === id);
        if (index >= 0) filters.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });
    const runner = new GmailRuleReconciliationRunner(connections, rules, jobs, fetchPort);
    const failed = await runner.run(approved.job!.id);
    expect(failed.state).toBe('failed');
    expect(filters).toHaveLength(1);

    const retried = rules.retry(draft.id, [draft.operations[0]!.id]);
    const completed = await runner.run(retried.job!.id);
    expect(completed.state).toBe('completed');
    expect(filters).toHaveLength(1);
    expect(fetchPort.mock.calls.filter((call) => String(call[0]).endsWith('/settings/filters') && call[1]?.method === 'POST')).toHaveLength(1);
    expect(rules.managedRule('gmail', connection.id, draft.operations[0]!.stableKey)).toMatchObject({ provider_rule_id: 'created-filter-1', state: 'active' });

    const undoing = rules.prepareUndo(draft.id);
    const undone = await runner.undo(undoing.undoJob!.id);
    expect(undone.state).toBe('undone');
    expect(filters).toHaveLength(0);
    expect(rules.managedRule('gmail', connection.id, draft.operations[0]!.stableKey)?.state).toBe('removed');
    profile.database.close();
  });
});
