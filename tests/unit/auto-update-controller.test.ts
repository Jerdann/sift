import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  return {
    listeners,
    app: { isPackaged: true, getVersion: () => "1.2.0" },
    autoUpdater: {
      setFeedURL: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
      checkForUpdates: vi.fn(() => Promise.resolve()),
      quitAndInstall: vi.fn(),
    },
    BrowserWindow: { getFocusedWindow: vi.fn(() => null) },
    dialog: { showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })) },
  };
});

vi.mock("electron", () => electron);

import { AppSettingsRepository } from "../../src/main/settings/app-settings-repository";
import { SiftAutomaticUpdateController } from "../../src/main/updates/auto-update";

const roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  electron.listeners.clear();
  delete process.env.SIFT_DISABLE_AUTO_UPDATE;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("automatic update consent", () => {
  it("stops scheduled checks immediately and suppresses restart when opted out", async () => {
    vi.useFakeTimers();
    const root = mkdtempSync(path.join(tmpdir(), "sift-updater-"));
    roots.push(root);
    const repository = new AppSettingsRepository(root);
    repository.setAutoUpdateEnabled(true);
    const controller = new SiftAutomaticUpdateController(
      repository,
    );

    controller.start();
    expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(electron.autoUpdater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://update.electronjs.org/Jerdann/sift/win32-x64/1.2.0",
      }),
    );

    controller.setAutoUpdateEnabled(false);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1_000);
    expect(electron.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    electron.listeners.get("update-downloaded")?.();
    await Promise.resolve();
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(electron.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("defaults the restart prompt to Later and keeps the current session open", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sift-updater-"));
    roots.push(root);
    const repository = new AppSettingsRepository(root);
    repository.setAutoUpdateEnabled(true);
    const controller = new SiftAutomaticUpdateController(
      repository,
    );
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    controller.start();

    electron.listeners.get("update-downloaded")?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ defaultId: 1, cancelId: 1 }),
    );
    expect(electron.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("restarts immediately only after Restart and update is chosen", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sift-updater-"));
    roots.push(root);
    const repository = new AppSettingsRepository(root);
    repository.setAutoUpdateEnabled(true);
    const controller = new SiftAutomaticUpdateController(
      repository,
    );
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
    controller.start();

    electron.listeners.get("update-downloaded")?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(electron.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
