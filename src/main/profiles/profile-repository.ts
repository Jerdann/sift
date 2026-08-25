import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type ProfileSummary,
  profileDisplayNameSchema,
  profileSummarySchema,
} from '../../shared/contracts/profiles';
import {
  type OpenProfileDatabase,
  openProfileDatabase,
  profileIdSchema,
  resolveContainedPath,
} from '../storage/database';

const registrySchema = z.object({
  version: z.literal(1),
  profiles: z.array(profileSummarySchema),
});

interface RegistryFile {
  version: 1;
  profiles: ProfileSummary[];
}

export interface ProfileContext extends OpenProfileDatabase {
  profile: ProfileSummary;
}

export interface ProfileRepositoryOptions {
  now?: () => string;
  createId?: () => string;
}

export class ProfileRepository {
  readonly #root: string;
  readonly #registryPath: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(root: string, options: ProfileRepositoryOptions = {}) {
    this.#root = path.resolve(root);
    mkdirSync(this.#root, { recursive: true });
    this.#registryPath = resolveContainedPath(this.#root, 'profiles.json');
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  listProfiles(): ProfileSummary[] {
    return this.#readRegistry().profiles
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  createProfile(displayName: string): ProfileContext {
    const normalizedDisplayName = profileDisplayNameSchema.parse(displayName);
    const profileId = profileIdSchema.parse(this.#createId());
    const createdAt = this.#now();
    const profile: ProfileSummary = {
      id: profileId,
      displayName: normalizedDisplayName,
      createdAt,
      lastOpenedAt: createdAt,
      providerCount: 0,
    };
    const opened = openProfileDatabase(this.#root, profileId);

    const registry = this.#readRegistry();
    registry.profiles.push(profile);
    this.#writeRegistry(registry);

    return { ...opened, profile };
  }

  openProfile(profileId: string): ProfileContext {
    const id = profileIdSchema.parse(profileId);
    const registry = this.#readRegistry();
    const profile = registry.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error('Local profile was not found');

    const opened = openProfileDatabase(this.#root, id);
    const updatedProfile = { ...profile, lastOpenedAt: this.#now() };
    registry.profiles = registry.profiles.map((candidate) =>
      candidate.id === id ? updatedProfile : candidate,
    );
    this.#writeRegistry(registry);
    return { ...opened, profile: updatedProfile };
  }

  updateProviderCount(profileId: string, providerCount: number): ProfileSummary {
    const id = profileIdSchema.parse(profileId);
    const count = z.number().int().nonnegative().parse(providerCount);
    const registry = this.#readRegistry();
    const profile = registry.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error('Local profile was not found');

    const updated = profileSummarySchema.parse({ ...profile, providerCount: count });
    registry.profiles = registry.profiles.map((candidate) =>
      candidate.id === id ? updated : candidate,
    );
    this.#writeRegistry(registry);
    return updated;
  }

  #readRegistry(): RegistryFile {
    if (!existsSync(this.#registryPath)) return { version: 1, profiles: [] };
    const raw = readFileSync(this.#registryPath, 'utf8');
    return registrySchema.parse(JSON.parse(raw));
  }

  #writeRegistry(registry: RegistryFile): void {
    const validated = registrySchema.parse(registry);
    const temporaryPath = resolveContainedPath(
      this.#root,
      `.profiles-${randomUUID()}.tmp`,
    );
    writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    renameSync(temporaryPath, this.#registryPath);
  }
}
