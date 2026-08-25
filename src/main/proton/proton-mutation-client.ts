import type { ImapFlow } from 'imapflow';
import type { BridgeCredentials } from '../../shared/contracts/proton';
import { bridgeOptionsFor } from './bridge-client';

export interface ProtonMutationClientPort {
  connect(): Promise<void>;
  close(): Promise<void>;
  prepareTarget(path: string, nativeSpam: boolean, nativeTrash?: boolean): Promise<string>;
  inspect(sourcePath: string, uid: number): Promise<{ uidValidity: string; flags: string[] } | null>;
  apply(sourcePath: string, uid: number, targetPath: string): Promise<ProtonMoveReceipt | null>;
  restore(targetPath: string, uid: number, sourcePath: string, priorFlags: readonly string[]): Promise<ProtonMoveReceipt | null>;
}

export interface ProtonMoveReceipt {
  path: string;
  uidValidity: string;
  uid: number;
  flags: string[];
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

  async apply(sourcePath: string, uid: number, targetPath: string): Promise<ProtonMoveReceipt | null> {
    let targetUid: number | undefined;
    const lock = await this.#client.getMailboxLock(sourcePath, { description: 'Sift approved cleanup' });
    try {
      const seen = await this.#client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      if (!seen) return null;
      const moved = await this.#client.messageMove(uid, targetPath, { uid: true });
      targetUid = moved ? moved.uidMap?.get(uid) : undefined;
    } finally { lock.release(); }
    if (!targetUid) return null;
    const resulting = await this.inspect(targetPath, targetUid);
    return resulting ? { path: targetPath, uid: targetUid, ...resulting } : null;
  }

  async restore(targetPath: string, uid: number, sourcePath: string, priorFlags: readonly string[]): Promise<ProtonMoveReceipt | null> {
    let sourceUid: number | undefined;
    const targetLock = await this.#client.getMailboxLock(targetPath, { description: 'Sift cleanup undo' });
    try {
      const moved = await this.#client.messageMove(uid, sourcePath, { uid: true });
      sourceUid = moved ? moved.uidMap?.get(uid) : undefined;
    } finally { targetLock.release(); }
    if (!sourceUid) return null;
    const sourceLock = await this.#client.getMailboxLock(sourcePath, { description: 'Sift cleanup flag restore' });
    try {
      const restored = await this.#client.messageFlagsSet(sourceUid, [...priorFlags], { uid: true });
      if (!restored) return null;
    } finally { sourceLock.release(); }
    const resulting = await this.inspect(sourcePath, sourceUid);
    return resulting ? { path: sourcePath, uid: sourceUid, ...resulting } : null;
  }
}

export const createProtonMutationClient: ProtonMutationClientFactory = async (credentials) => {
  const { ImapFlow: RuntimeImapFlow } = await import('imapflow');
  return new ImapFlowMutationClient(new RuntimeImapFlow(bridgeOptionsFor(credentials)));
};
