import type { ImapFlow } from 'imapflow';
import { describe, expect, it, vi } from 'vitest';
import { ImapFlowMutationClient } from '../../src/main/proton/proton-mutation-client';

describe('Proton mutation folder namespace', () => {
  it('creates portable folder paths beneath the Bridge Folders root', async () => {
    const mailboxes = [
      { path: 'Folders', delimiter: '/', specialUse: undefined },
      { path: 'Labels', delimiter: '/', specialUse: undefined },
    ];
    const mailboxCreate = vi.fn(async (providerPath: string) => {
      mailboxes.push({ path: providerPath, delimiter: '/', specialUse: undefined });
      return { path: providerPath, created: true };
    });
    const imap = {
      list: vi.fn(async () => mailboxes),
      mailboxCreate,
    } as unknown as ImapFlow;
    const client = new ImapFlowMutationClient(imap);

    await expect(client.prepareTarget('Joint House Things/Money/Receipts', false)).resolves.toBe(
      'Folders/Joint House Things/Money/Receipts',
    );
    expect(mailboxCreate.mock.calls.map(([providerPath]) => providerPath)).toEqual([
      'Folders/Joint House Things',
      'Folders/Joint House Things/Money',
      'Folders/Joint House Things/Money/Receipts',
    ]);
  });

  it('does not create an account-root mailbox or recreate an existing folder', async () => {
    const mailboxCreate = vi.fn();
    const imap = {
      list: vi.fn(async () => [
        { path: 'Folders', delimiter: '/', specialUse: undefined },
        { path: 'Folders/Games', delimiter: '/', specialUse: undefined },
      ]),
      mailboxCreate,
    } as unknown as ImapFlow;
    const client = new ImapFlowMutationClient(imap);

    await expect(client.prepareTarget('Games', false)).resolves.toBe('Folders/Games');
    expect(mailboxCreate).not.toHaveBeenCalled();
  });
});
