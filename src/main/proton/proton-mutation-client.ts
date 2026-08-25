import type { ImapFlow } from 'imapflow';
import type { BridgeCredentials } from '../../shared/contracts/proton';
import { bridgeOptionsFor } from './bridge-client';

export interface ProtonMutationClientPort {
  connect(): Promise<void>;
  close(): Promise<void>;
  prepareTarget(path: string, nativeSpam: boolean, nativeTrash?: boolean): Promise<string>;
  inspect(sourcePath: string, uid: number): Promise<{ uidValidity: string; flags: string[] } | null>;
  apply(sourcePath: string, uid: number, targetPath: string): Promise<boolean>;
}

export type ProtonMutationClientFactory = (
  credentials: BridgeCredentials,
) => ProtonMutationClientPort | Promise<ProtonMutationClientPort>;

class ImapFlowMutationClient implements ProtonMutationClientPort {
  readonly #client: ImapFlow;
  constructor(client: ImapFlow) { this.#client = client; }
  async connect() { await this.#client.connect(); }
  async close() {
    if (this.#client.usable) await this.#client.logout();
    else this.#client.close();
  }

  async prepareTarget(path: string, nativeSpam: boolean, nativeTrash = false): Promise<string> {
    let mailboxes = await this.#client.list();
    if (nativeSpam) {
      const junk = mailboxes.find((mailbox) => mailbox.specialUse?.toLowerCase() === '\\junk');
      if (!junk) throw new Error('native_spam_folder_missing');
      return junk.path;
    }
    if (nativeTrash) {
      const trash = mailboxes.find((mailbox) => mailbox.specialUse?.toLowerCase() === '\\trash');
      if (!trash) throw new Error('native_trash_folder_missing');
      return trash.path;
    }
    const existing = mailboxes.find((mailbox) => mailbox.path.toLowerCase() === path.toLowerCase());
    if (existing) return existing.path;
    const delimiter = mailboxes[0]?.delimiter || '/';
    const parts = path.split('/').filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      const current = parts.slice(0, index).join(delimiter);
      if (!mailboxes.some((mailbox) => mailbox.path.toLowerCase() === current.toLowerCase())) {
        await this.#client.mailboxCreate(current);
        mailboxes = await this.#client.list();
      }
    }
    return mailboxes.find((mailbox) => mailbox.path.toLowerCase() === parts.join(delimiter).toLowerCase())?.path ?? parts.join(delimiter);
  }

  async inspect(sourcePath: string, uid: number): Promise<{ uidValidity: string; flags: string[] } | null> {
    const lock = await this.#client.getMailboxLock(sourcePath, { readOnly: true, description: 'Sift prior-state capture' });
    try {
      if (!this.#client.mailbox) return null;
      const message = await this.#client.fetchOne(uid, { uid: true, flags: true }, { uid: true });
      return message ? {
        uidValidity: String(this.#client.mailbox.uidValidity),
        flags: [...(message.flags ?? [])].sort(),
      } : null;
    } finally { lock.release(); }
  }

  async apply(sourcePath: string, uid: number, targetPath: string): Promise<boolean> {
    const lock = await this.#client.getMailboxLock(sourcePath, { description: 'Sift approved cleanup' });
    try {
      const seen = await this.#client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      if (!seen) return false;
      return Boolean(await this.#client.messageMove(uid, targetPath, { uid: true }));
    } finally { lock.release(); }
  }
}

export const createProtonMutationClient: ProtonMutationClientFactory = async (credentials) => {
  const { ImapFlow: RuntimeImapFlow } = await import('imapflow');
  return new ImapFlowMutationClient(new RuntimeImapFlow(bridgeOptionsFor(credentials)));
};
