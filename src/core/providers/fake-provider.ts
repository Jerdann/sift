import type {
  MailContainer,
  MessagePageRequest,
  MessageSummary,
  MutationReceipt,
  Page,
  ProviderAccount,
  ProviderAdapter,
  ProviderMutation,
  TextBodyResult,
} from './provider-adapter';

export interface SyntheticMessage extends MessageSummary {
  readonly plainTextBody: string;
}

export interface FakeProviderOptions {
  account: ProviderAccount;
  containers: readonly MailContainer[];
  messages: readonly SyntheticMessage[];
}

const cursorFor = (offset: number) => `offset:${offset}`;
const offsetFrom = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/.exec(cursor);
  if (!match) throw new Error('Invalid provider cursor');
  return Number(match[1]);
};

export class FakeProvider implements ProviderAdapter {
  readonly #account: ProviderAccount;
  readonly #containers: readonly MailContainer[];
  readonly #messages: Map<string, SyntheticMessage>;
  #receiptSequence = 0;

  constructor({ account, containers, messages }: FakeProviderOptions) {
    this.#account = structuredClone(account);
    this.#containers = structuredClone(containers);
    this.#messages = new Map(
      messages.map((message) => [message.providerMessageId, structuredClone(message)]),
    );
  }

  async discoverAccount(): Promise<ProviderAccount> {
    return structuredClone(this.#account);
  }

  async listContainers(cursor?: string): Promise<Page<MailContainer>> {
    const offset = offsetFrom(cursor);
    const pageSize = 100;
    const items = this.#containers.slice(offset, offset + pageSize);
    const nextOffset = offset + items.length;
    return {
      items: structuredClone(items),
      nextCursor: nextOffset < this.#containers.length ? cursorFor(nextOffset) : null,
    };
  }

  async listMessages(request: MessagePageRequest): Promise<Page<MessageSummary>> {
    if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 500) {
      throw new Error('pageSize must be an integer between 1 and 500');
    }
    const offset = offsetFrom(request.cursor);
    const candidates = [...this.#messages.values()]
      .filter(
        (message) =>
          !request.containerId || message.containerIds.includes(request.containerId),
      )
      .sort((left, right) => left.providerMessageId.localeCompare(right.providerMessageId));
    const items = candidates.slice(offset, offset + request.pageSize).map(
      ({ plainTextBody: _plainTextBody, ...summary }) => structuredClone(summary),
    );
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < candidates.length ? cursorFor(nextOffset) : null,
    };
  }

  async fetchTextBody(
    providerMessageId: string,
    maximumBytes: number,
  ): Promise<TextBodyResult> {
    const message = this.#messages.get(providerMessageId);
    if (!message) throw new Error('Synthetic message was not found');
    if (!Number.isInteger(maximumBytes) || maximumBytes < 0) {
      throw new Error('maximumBytes must be a non-negative integer');
    }
    const encoded = Buffer.from(message.plainTextBody, 'utf8');
    const selected = encoded.subarray(0, maximumBytes);
    return {
      plainText: selected.toString('utf8'),
      truncated: selected.byteLength < encoded.byteLength,
    };
  }

  async applyMutations(
    mutations: readonly ProviderMutation[],
  ): Promise<readonly MutationReceipt[]> {
    return mutations.map((mutation) => this.#applyMutation(mutation));
  }

  #applyMutation(mutation: ProviderMutation): MutationReceipt {
    const message = this.#messages.get(mutation.providerMessageId);
    if (!message) {
      return {
        providerMessageId: mutation.providerMessageId,
        mutationKind: mutation.kind,
        outcome: 'not_found',
        errorCategory: 'permanent',
      };
    }
    if (!this.#supports(mutation)) {
      return {
        providerMessageId: mutation.providerMessageId,
        mutationKind: mutation.kind,
        outcome: 'unsupported',
        errorCategory: 'capability',
      };
    }

    let updated: SyntheticMessage = message;
    switch (mutation.kind) {
      case 'mark-read':
        updated = { ...message, unread: false };
        break;
      case 'archive':
        updated = { ...message, archived: true };
        break;
      case 'move':
        updated = { ...message, containerIds: [mutation.containerId] };
        break;
      case 'add-labels':
        updated = {
          ...message,
          labelIds: [...new Set([...message.labelIds, ...mutation.labelIds])],
        };
        break;
      case 'remove-labels':
        updated = {
          ...message,
          labelIds: message.labelIds.filter((id) => !mutation.labelIds.includes(id)),
        };
        break;
      case 'mark-spam':
        updated = { ...message, containerIds: ['spam'], archived: true };
        break;
    }
    this.#messages.set(mutation.providerMessageId, updated);
    this.#receiptSequence += 1;
    return {
      providerMessageId: mutation.providerMessageId,
      mutationKind: mutation.kind,
      outcome: 'applied',
      providerReceiptId: `fake-receipt-${this.#receiptSequence}`,
    };
  }

  #supports(mutation: ProviderMutation): boolean {
    const capabilities = this.#account.capabilities;
    if (!capabilities.batchMutation) return false;
    if (mutation.kind === 'move') return capabilities.folders;
    if (mutation.kind === 'add-labels' || mutation.kind === 'remove-labels') {
      return capabilities.labels;
    }
    if (mutation.kind === 'mark-spam') {
      return capabilities.spamAction !== 'unsupported';
    }
    return true;
  }
}
