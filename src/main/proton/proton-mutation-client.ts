import type { ImapFlow } from 'imapflow';
import type { BridgeCredentials } from '../../shared/contracts/proton';
import { bridgeOptionsFor } from './bridge-client';
import { protonFolderPath } from './proton-paths';

export interface ProtonMutationClientPort {
  connect(): Promise<void>;
  close(): Promise<void>;
  prepareTarget(path: string, nativeSpam: boolean, nativeTrash?: boolean): Promise<string>;
  inspect(sourcePath: string, uid: number): Promise<{ uidValidity: string; flags: string[] } | null>;
  inspectMany(sourcePath: string, uids: readonly number[]): Promise<Map<number, { uidValidity: string; flags: string[] }>>;
  moveMany(sourcePath: string, uids: readonly number[], targetPath: string): Promise<Map<number, ProtonMovePointer>>;
  restore(targetPath: string, uid: number, sourcePath: string, priorFlags: readonly string[]): Promise<ProtonMoveReceipt | null>;
}

export interface ProtonMoveReceipt {
  path: string;
  uidValidity: string;
  uid: number;
  flags: string[];
}

export interface ProtonMovePointer {
  path: string;
  uid: number;
}

export type ProtonMutationClientFactory = (
  credentials: BridgeCredentials,
) => ProtonMutationClientPort | Promise<ProtonMutationClientPort>;

export class ImapFlowMutationClient implements ProtonMutationClientPort {
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
    const delimiter = mailboxes[0]?.delimiter || '/';
    const providerPath = protonFolderPath(path, delimiter);
    const existing = mailboxes.find((mailbox) => mailbox.path.toLowerCase() === providerPath.toLowerCase());
    if (existing) return existing.path;
    const parts = providerPath.split(delimiter).filter(Boolean);
    const foldersRoot = mailboxes.find((mailbox) => mailbox.path.toLowerCase() === parts[0]!.toLowerCase());
    if (!foldersRoot) throw new Error('proton_folders_root_missing');
    for (let index = 2; index <= parts.length; index += 1) {
      const current = parts.slice(0, index).join(delimiter);
      if (!mailboxes.some((mailbox) => mailbox.path.toLowerCase() === current.toLowerCase())) {
        await this.#client.mailboxCreate(current);
        mailboxes = await this.#client.list();
      }
    }
    return mailboxes.find((mailbox) => mailbox.path.toLowerCase() === providerPath.toLowerCase())?.path ?? providerPath;
  }

  async inspect(sourcePath: string, uid: number): Promise<{ uidValidity: string; flags: string[] } | null> {
    return (await this.inspectMany(sourcePath, [uid])).get(uid) ?? null;
  }

  async inspectMany(sourcePath: string, uids: readonly number[]): Promise<Map<number, { uidValidity: string; flags: string[] }>> {
    const inspected = new Map<number, { uidValidity: string; flags: string[] }>();
    if (!uids.length) return inspected;
    const lock = await this.#client.getMailboxLock(sourcePath, { readOnly: true, description: 'Sift prior-state capture' });
    try {
      if (!this.#client.mailbox) return inspected;
      const uidValidity = String(this.#client.mailbox.uidValidity);
      for await (const message of this.#client.fetch([...uids], { uid: true, flags: true }, { uid: true })) {
        inspected.set(message.uid, {
          uidValidity,
          flags: [...(message.flags ?? [])].sort(),
        });
      }
      return inspected;
    } finally { lock.release(); }
  }

  async moveMany(sourcePath: string, uids: readonly number[], targetPath: string): Promise<Map<number, ProtonMovePointer>> {
    const pointers = new Map<number, ProtonMovePointer>();
    if (!uids.length) return pointers;
    let uidMap: Map<number, number> | undefined;
    const lock = await this.#client.getMailboxLock(sourcePath, { description: 'Sift approved cleanup' });
    try {
      const seen = await this.#client.messageFlagsAdd([...uids], ['\\Seen'], { uid: true });
      if (!seen) throw new Error('provider_seen_rejected');
      const moved = await this.#client.messageMove([...uids], targetPath, { uid: true });
      if (!moved) throw new Error('provider_move_rejected');
      uidMap = moved.uidMap;
    } finally { lock.release(); }
    if (!uidMap?.size) throw new Error('provider_move_receipt_missing');
    for (const sourceUid of uids) {
      const targetUid = uidMap.get(sourceUid);
      if (targetUid) pointers.set(sourceUid, { path: targetPath, uid: targetUid });
    }
    return pointers;
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
