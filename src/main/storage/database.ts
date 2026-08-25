import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { applyMigrations } from './migrations';

export const profileIdSchema = z.uuid();

export const resolveContainedPath = (root: string, ...segments: string[]): string => {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Resolved profile path escapes the application data root');
  }

  return resolvedTarget;
};

export const resolveProfileDirectory = (root: string, profileId: string): string => {
  const id = profileIdSchema.parse(profileId);
  return resolveContainedPath(root, 'profiles', id);
};

export interface OpenProfileDatabase {
  database: BetterSqlite3.Database;
  databasePath: string;
  profileDirectory: string;
}

export const openProfileDatabase = (
  root: string,
  profileId: string,
): OpenProfileDatabase => {
  const profileDirectory = resolveProfileDirectory(root, profileId);
  mkdirSync(profileDirectory, { recursive: true });
  const databasePath = resolveContainedPath(profileDirectory, 'mail-steward.sqlite3');
  const database = new BetterSqlite3(databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  applyMigrations(database);
  return { database, databasePath, profileDirectory };
};
