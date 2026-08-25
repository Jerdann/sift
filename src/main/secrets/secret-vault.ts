import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const secretReferenceSchema = z.object({
  id: z.uuid(),
  profileId: z.uuid(),
  purpose: z.string().trim().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type SecretReference = z.infer<typeof secretReferenceSchema>;

export interface SecretVault {
  store(profileId: string, purpose: string, secret: string): SecretReference;
  read(profileId: string, referenceId: string): string;
  delete(profileId: string, referenceId: string): void;
}

export class SecretStorageUnavailableError extends Error {
  constructor() {
    super('OS-backed secret storage is unavailable');
    this.name = 'SecretStorageUnavailableError';
  }
}

export class InMemorySecretVault implements SecretVault {
  readonly #values = new Map<string, { reference: SecretReference; value: string }>();
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  store(profileId: string, purpose: string, secret: string): SecretReference {
    const timestamp = this.#now();
    const reference = secretReferenceSchema.parse({
      id: this.#createId(),
      profileId,
      purpose,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.#values.set(reference.id, { reference, value: secret });
    return reference;
  }

  read(profileId: string, referenceId: string): string {
    const stored = this.#values.get(referenceId);
    if (!stored || stored.reference.profileId !== profileId) {
      throw new Error('Secret reference was not found for this profile');
    }
    return stored.value;
  }

  delete(profileId: string, referenceId: string): void {
    const stored = this.#values.get(referenceId);
    if (!stored || stored.reference.profileId !== profileId) {
      throw new Error('Secret reference was not found for this profile');
    }
    this.#values.delete(referenceId);
  }
}
