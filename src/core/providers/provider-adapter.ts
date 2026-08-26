export type RuleDeliveryMode = 'install' | 'export' | 'unsupported';
export type SpamActionMode = 'native' | 'move' | 'unsupported';
export type TrashActionMode = 'native' | 'move' | 'unsupported';
export type UnsubscribeActionMode = 'authenticated_one_click' | 'manual' | 'unsupported';

export interface ProviderCapabilities {
  readonly folders: boolean;
  readonly labels: boolean;
  readonly plainTextBodies: boolean;
  readonly batchMutation: boolean;
  readonly ruleDelivery: RuleDeliveryMode;
  readonly spamAction: SpamActionMode;
  readonly trashAction: TrashActionMode;
  readonly unsubscribeAction: UnsubscribeActionMode;
}

export interface ProviderAddress {
  readonly addressId: string;
  readonly displayAddress: string;
  readonly isPrimary: boolean;
}

export interface ProviderAccount {
  readonly accountId: string;
  readonly displayName: string;
  readonly addresses: readonly ProviderAddress[];
  readonly capabilities: ProviderCapabilities;
}

export interface MailContainer {
  readonly containerId: string;
  readonly displayName: string;
  readonly kind: 'inbox' | 'archive' | 'sent' | 'spam' | 'trash' | 'custom';
  readonly unreadCount?: number;
  readonly messageCount?: number;
}

export interface NormalizedHeaders {
  readonly internetMessageId?: string;
  readonly listId?: string;
  readonly listUnsubscribe?: readonly string[];
  readonly authenticationSummary?: string;
}

export interface MessageParticipant {
  readonly address: string;
  readonly displayName?: string;
}

export interface MessageSummary {
  readonly providerMessageId: string;
  readonly providerThreadId?: string;
  readonly containerIds: readonly string[];
  readonly labelIds: readonly string[];
  readonly sender: MessageParticipant;
  readonly recipients: readonly MessageParticipant[];
  readonly receivedAt: string;
  readonly subject: string;
  readonly unread: boolean;
  readonly archived: boolean;
  readonly headers: NormalizedHeaders;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface MessagePageRequest {
  readonly containerId?: string;
  readonly cursor?: string;
  readonly pageSize: number;
}

export interface TextBodyResult {
  readonly plainText: string;
  readonly truncated: boolean;
}

export type ProviderMutation =
  | { readonly kind: 'mark-read'; readonly providerMessageId: string }
  | { readonly kind: 'archive'; readonly providerMessageId: string }
  | { readonly kind: 'move'; readonly providerMessageId: string; readonly containerId: string }
  | { readonly kind: 'add-labels'; readonly providerMessageId: string; readonly labelIds: readonly string[] }
  | { readonly kind: 'remove-labels'; readonly providerMessageId: string; readonly labelIds: readonly string[] }
  | { readonly kind: 'mark-spam'; readonly providerMessageId: string };

export interface MutationReceipt {
  readonly providerMessageId: string;
  readonly mutationKind: ProviderMutation['kind'];
  readonly outcome: 'applied' | 'unsupported' | 'not_found' | 'failed';
  readonly providerReceiptId?: string;
  readonly errorCategory?: 'capability' | 'authentication' | 'rate_limit' | 'transient' | 'permanent';
}

export interface ProviderAdapter {
  discoverAccount(): Promise<ProviderAccount>;
  listContainers(cursor?: string): Promise<Page<MailContainer>>;
  listMessages(request: MessagePageRequest): Promise<Page<MessageSummary>>;
  fetchTextBody(providerMessageId: string, maximumBytes: number): Promise<TextBodyResult>;
  applyMutations(mutations: readonly ProviderMutation[]): Promise<readonly MutationReceipt[]>;
}
