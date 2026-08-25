import type {
  ProtonAddressEvidence,
  ProtonDiscoverySummary,
} from '../../shared/contracts/proton';
import {
  createProtonReadClient,
  type ProtonReadClientFactory,
  type RecipientHeaderEvidence,
} from './bridge-client';
import type { ProtonConnectionRepository } from './proton-connection-repository';
import type { ProtonDiscoveryRepository } from './proton-discovery-repository';

const MAX_RECIPIENT_HEADER_SAMPLES = 500;

const aggregateEvidence = (
  evidence: readonly RecipientHeaderEvidence[],
): ProtonAddressEvidence[] => {
  const addresses = new Map<string, {
    count: number;
    lastSeenAt: string | null;
    sources: Set<RecipientHeaderEvidence['source']>;
  }>();
  for (const item of evidence) {
    const address = item.address.trim().toLowerCase();
    const current = addresses.get(address) ?? { count: 0, lastSeenAt: null, sources: new Set() };
    current.count += 1;
    current.sources.add(item.source);
    if (item.seenAt && (!current.lastSeenAt || item.seenAt > current.lastSeenAt)) {
      current.lastSeenAt = item.seenAt;
    }
    addresses.set(address, current);
  }
  return [...addresses.entries()]
    .map(([address, value]) => ({
      address,
      occurrenceCount: value.count,
      lastSeenAt: value.lastSeenAt,
      sources: [...value.sources].sort(),
    }))
    .sort((left, right) => right.occurrenceCount - left.occurrenceCount || left.address.localeCompare(right.address));
};

export const discoverProtonMailbox = async (
  connectionRepository: ProtonConnectionRepository,
  discoveryRepository: ProtonDiscoveryRepository,
  createClient: ProtonReadClientFactory = createProtonReadClient,
): Promise<ProtonDiscoverySummary> => {
  const connection = connectionRepository.get();
  const credentials = connectionRepository.getCredentials();
  if (!connection || !credentials) throw new Error('proton_not_connected');

  const client = await createClient(credentials);
  try {
    await client.connect();
    const mailboxes = [...await client.listMailboxes()];
    const sampleMailbox =
      mailboxes.find((mailbox) => mailbox.specialUse?.toLowerCase() === '\\all') ??
      mailboxes.find((mailbox) => mailbox.specialUse?.toLowerCase() === '\\inbox') ??
      mailboxes.find((mailbox) => mailbox.path.toLowerCase() === 'inbox') ??
      mailboxes.find((mailbox) => mailbox.messageCount > 0 && !mailbox.flags.includes('\\Noselect'));
    const evidence = sampleMailbox
      ? await client.sampleRecipientHeaders(sampleMailbox.path, MAX_RECIPIENT_HEADER_SAMPLES)
      : [];

    return discoveryRepository.replace(connection.id, {
      capabilities: client.capabilityNames(),
      mailboxes,
      addresses: aggregateEvidence(evidence),
    });
  } finally {
    await client.close().catch(() => undefined);
  }
};
