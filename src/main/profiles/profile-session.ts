import type { ProfileSummary } from '../../shared/contracts/profiles';
import type { SecretVault } from '../secrets/secret-vault';
import { type ProfileContext, ProfileRepository } from './profile-repository';

export type ProfileSecretVaultFactory = (context: ProfileContext) => SecretVault;

export class ProfileSession {
  readonly #repository: ProfileRepository;
  readonly #createSecretVault: ProfileSecretVaultFactory | null;
  #activeContext: ProfileContext | null = null;
  #activeSecretVault: SecretVault | null = null;

  constructor(
    repository: ProfileRepository,
    createSecretVault: ProfileSecretVaultFactory | null = null,
  ) {
    this.#repository = repository;
    this.#createSecretVault = createSecretVault;
  }

  listProfiles(): ProfileSummary[] {
    return this.#repository.listProfiles();
  }

  createProfile(displayName: string): ProfileSummary {
    this.#replaceContext(this.#repository.createProfile(displayName));
    return this.requireActiveContext().profile;
  }

  selectProfile(profileId: string): ProfileSummary {
    this.#replaceContext(this.#repository.openProfile(profileId));
    return this.requireActiveContext().profile;
  }

  requireActiveContext(): ProfileContext {
    if (!this.#activeContext) throw new Error('Select a local profile first');
    return this.#activeContext;
  }

  requireSecretVault(): SecretVault {
    if (!this.#activeSecretVault) {
      throw new Error('OS-backed secret storage is unavailable for this profile');
    }
    return this.#activeSecretVault;
  }

  setActiveProviderCount(providerCount: number): ProfileSummary {
    const context = this.requireActiveContext();
    const profile = this.#repository.updateProviderCount(
      context.profile.id,
      providerCount,
    );
    this.#activeContext = { ...context, profile };
    return profile;
  }

  close(): void {
    this.#activeContext?.database.close();
    this.#activeContext = null;
    this.#activeSecretVault = null;
  }

  #replaceContext(context: ProfileContext): void {
    let secretVault: SecretVault | null;
    try {
      secretVault = this.#createSecretVault?.(context) ?? null;
    } catch (error) {
      context.database.close();
      throw error;
    }
    this.#activeContext?.database.close();
    this.#activeContext = context;
    this.#activeSecretVault = secretVault;
  }
}
