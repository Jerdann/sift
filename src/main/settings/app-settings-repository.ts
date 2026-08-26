import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveContainedPath } from "../storage/database";

const preferencesSchema = z
  .object({
    version: z.literal(1),
    autoUpdateEnabled: z.boolean(),
  })
  .strict();

export interface AppPreferences {
  version: 1;
  autoUpdateEnabled: boolean;
}

const defaultPreferences = (): AppPreferences => ({
  version: 1,
  autoUpdateEnabled: false,
});

export class AppSettingsRepository {
  readonly #root: string;
  readonly #settingsPath: string;

  constructor(root: string) {
    this.#root = path.resolve(root);
    mkdirSync(this.#root, { recursive: true });
    this.#settingsPath = resolveContainedPath(this.#root, "settings.json");
  }

  get(): AppPreferences {
    if (!existsSync(this.#settingsPath)) return defaultPreferences();
    try {
      return preferencesSchema.parse(
        JSON.parse(readFileSync(this.#settingsPath, "utf8")),
      );
    } catch {
      // A damaged preference file must never silently re-enable network checks.
      return { version: 1, autoUpdateEnabled: false };
    }
  }

  setAutoUpdateEnabled(autoUpdateEnabled: boolean): AppPreferences {
    const next = preferencesSchema.parse({
      version: 1,
      autoUpdateEnabled,
    });
    const temporaryPath = resolveContainedPath(
      this.#root,
      `.settings-${randomUUID()}.tmp`,
    );
    writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporaryPath, this.#settingsPath);
    return next;
  }
}
