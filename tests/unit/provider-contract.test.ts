import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider, type SyntheticMessage } from '../../src/core/providers/fake-provider';
import type { ProviderAccount } from '../../src/core/providers/provider-adapter';

const account: ProviderAccount = {
  accountId: 'synthetic-account',
  displayName: 'Synthetic mailbox',
  addresses: [
    { addressId: 'address-1', displayAddress: 'private@example.test', isPrimary: true },
  ],
  capabilities: {
    folders: true,
    labels: false,
    plainTextBodies: true,
    batchMutation: true,
    ruleDelivery: 'export',
    spamAction: 'native',
  },
};

const makeMessages = (): SyntheticMessage[] =>
  Array.from({ length: 5 }, (_, index) => ({
    providerMessageId: `message-${index + 1}`,
    providerThreadId: `thread-${index + 1}`,
    containerIds: ['inbox'],
    labelIds: [],
    sender: { address: `sender-${index + 1}@example.test` },
    recipients: [{ address: 'private@example.test' }],
    receivedAt: `2026-08-2${index + 1}T12:00:00.000Z`,
    subject: `Synthetic subject ${index + 1}`,
    unread: true,
    archived: false,
    headers: { internetMessageId: `<message-${index + 1}@example.test>` },
    plainTextBody: `Synthetic plain text body ${index + 1}`,
  }));

const createProvider = () =>
  new FakeProvider({
    account,
    containers: [
      { containerId: 'inbox', displayName: 'Inbox', kind: 'inbox' },
      { containerId: 'spam', displayName: 'Spam', kind: 'spam' },
    ],
    messages: makeMessages(),
  });

describe('provider adapter contract', () => {
  it('discovers stable account identity and explicit capabilities', async () => {
    const provider = createProvider();
    const first = await provider.discoverAccount();
    const second = await provider.discoverAccount();
    expect(first).toEqual(second);
    expect(first.capabilities).toEqual(account.capabilities);
    expect(first.addresses).toHaveLength(1);
  });

  it('paginates deterministically with stable provider message IDs', async () => {
    const provider = createProvider();
    const first = await provider.listMessages({ pageSize: 2 });
    const second = await provider.listMessages({ pageSize: 2, cursor: first.nextCursor! });
    const third = await provider.listMessages({ pageSize: 2, cursor: second.nextCursor! });
    expect([...first.items, ...second.items, ...third.items].map((item) => item.providerMessageId)).toEqual([
      'message-1', 'message-2', 'message-3', 'message-4', 'message-5',
    ]);
    expect(third.nextCursor).toBeNull();
    expect(first.items[0]).not.toHaveProperty('plainTextBody');
  });

  it('bounds local plain-text body reads', async () => {
    const provider = createProvider();
    const body = await provider.fetchTextBody('message-1', 9);
    expect(body).toEqual({ plainText: 'Synthetic', truncated: true });
  });

  it('returns normalized receipts and applies supported mutations', async () => {
    const provider = createProvider();
    const receipts = await provider.applyMutations([
      { kind: 'mark-read', providerMessageId: 'message-1' },
      { kind: 'archive', providerMessageId: 'message-2' },
      { kind: 'mark-spam', providerMessageId: 'message-3' },
    ]);
    expect(receipts.map(({ outcome }) => outcome)).toEqual(['applied', 'applied', 'applied']);
    const messages = await provider.listMessages({ pageSize: 5 });
    expect(messages.items.find((item) => item.providerMessageId === 'message-1')?.unread).toBe(false);
    expect(messages.items.find((item) => item.providerMessageId === 'message-2')?.archived).toBe(true);
    expect(messages.items.find((item) => item.providerMessageId === 'message-3')?.containerIds).toEqual(['spam']);
  });

  it('reports unsupported capabilities and missing IDs without approximation', async () => {
    const provider = createProvider();
    const receipts = await provider.applyMutations([
      { kind: 'add-labels', providerMessageId: 'message-1', labelIds: ['offers'] },
      { kind: 'archive', providerMessageId: 'missing-message' },
    ]);
    expect(receipts[0]).toMatchObject({ outcome: 'unsupported', errorCategory: 'capability' });
    expect(receipts[1]).toMatchObject({ outcome: 'not_found', errorCategory: 'permanent' });
  });

  it('keeps core contracts provider-neutral and raw-HTML-free', () => {
    const contract = readFileSync(resolve('src/core/providers/provider-adapter.ts'), 'utf8');
    expect(contract).not.toMatch(/rawHtml|rawHeaders|htmlBody/i);
    expect(contract).not.toMatch(/proton|gmail/i);
  });
});
