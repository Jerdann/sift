import { app, autoUpdater, BrowserWindow, dialog } from "electron";
import type {
  AppSettings,
  ManualUpdateCheckResult,
} from "../../shared/contracts/settings";
import type { AppSettingsRepository } from "../settings/app-settings-repository";
import { automaticUpdateDelay } from "./update-policy";

const UPDATE_INTERVAL_MS = 60 * 60 * 1_000;
const MANUAL_CHECK_TIMEOUT_MS = 30_000;
const UPDATE_FEED_ROOT = "https://update.electronjs.org/Jerdann/sift";

export interface AutomaticUpdateController {
  start(): void;
  getSettings(): AppSettings;
  setAutoUpdateEnabled(enabled: boolean): AppSettings;
  checkForUpdatesNow(): Promise<ManualUpdateCheckResult>;
}

export class SiftAutomaticUpdateController
  implements AutomaticUpdateController
{
  readonly #settings: AppSettingsRepository;
  #delayTimer: NodeJS.Timeout | null = null;
  #intervalTimer: NodeJS.Timeout | null = null;
  #initialized = false;
  #manualDownloadRequested = false;
  #pendingManualCheck: {
    resolve(result: ManualUpdateCheckResult): void;
    reject(error: Error): void;
    timeout: NodeJS.Timeout;
  } | null = null;

  constructor(settings: AppSettingsRepository) {
    this.#settings = settings;
  }

  getSettings(): AppSettings {
    const preferences = this.#settings.get();
    const updatesSupported = app.isPackaged && process.platform === "win32";
    const environmentDisabled =
      process.env.SIFT_DISABLE_AUTO_UPDATE === "1";
    return {
      autoUpdateEnabled: preferences.autoUpdateEnabled,
      automaticUpdatesActive:
        updatesSupported &&
        preferences.autoUpdateEnabled &&
        !environmentDisabled,
      updatesSupported,
      appVersion: app.getVersion(),
    };
  }

  setAutoUpdateEnabled(enabled: boolean): AppSettings {
    this.#settings.setAutoUpdateEnabled(enabled);
    this.#stopSchedule();
    if (enabled) this.#schedule(0);
    return this.getSettings();
  }

  checkForUpdatesNow(): Promise<ManualUpdateCheckResult> {
    const settings = this.getSettings();
    const environmentDisabled = process.env.SIFT_DISABLE_AUTO_UPDATE === "1";
    if (!settings.updatesSupported || environmentDisabled) {
      return Promise.resolve({
        status: "unsupported",
        currentVersion: settings.appVersion,
      });
    }
    if (this.#pendingManualCheck) {
      return Promise.reject(new Error("update_check_already_running"));
    }

    this.#initializeUpdater();
    this.#manualDownloadRequested = true;
    return new Promise<ManualUpdateCheckResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#manualDownloadRequested = false;
        this.#failManualCheck(new Error("update_check_timed_out"));
      }, MANUAL_CHECK_TIMEOUT_MS);
      timeout.unref();
      this.#pendingManualCheck = { resolve, reject, timeout };
      void Promise.resolve(autoUpdater.checkForUpdates()).catch((error) =>
        this.#failManualCheck(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    });
  }

  start(): void {
    const settings = this.getSettings();
    const delay = automaticUpdateDelay({
      argv: process.argv,
      disabled: !settings.automaticUpdatesActive,
      isPackaged: app.isPackaged,
      platform: process.platform,
    });
    if (delay === null) return;
    this.#schedule(delay);
  }

  #schedule(delay: number): void {
    if (!this.getSettings().automaticUpdatesActive) return;
    this.#initializeUpdater();
    if (delay === 0) {
      this.#beginChecks();
      return;
    }
    this.#delayTimer = setTimeout(() => this.#beginChecks(), delay);
    this.#delayTimer.unref();
  }

  #initializeUpdater(): void {
    if (this.#initialized) return;
    this.#initialized = true;
    autoUpdater.setFeedURL({
      url: `${UPDATE_FEED_ROOT}/${process.platform}-${process.arch}/${app.getVersion()}`,
      headers: {
        "User-Agent": `Sift/${app.getVersion()} (${process.platform}; ${process.arch})`,
      },
    });
    autoUpdater.on("error", (error) => {
      console.error("Sift update check failed", error);
      this.#manualDownloadRequested = false;
      this.#failManualCheck(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    autoUpdater.on("update-available", () =>
      this.#completeManualCheck("update_available"),
    );
    autoUpdater.on("update-not-available", () => {
      this.#manualDownloadRequested = false;
      this.#completeManualCheck("up_to_date");
    });
    autoUpdater.on("update-downloaded", () => {
      const manualRequest = this.#manualDownloadRequested;
      this.#manualDownloadRequested = false;
      void this.#offerRestart(manualRequest);
    });
  }

  #beginChecks(): void {
    if (!this.getSettings().automaticUpdatesActive) return;
    this.#delayTimer = null;
    this.#checkNow();
    this.#intervalTimer = setInterval(
      () => this.#checkNow(),
      UPDATE_INTERVAL_MS,
    );
    this.#intervalTimer.unref();
  }

  #checkNow(): void {
    if (!this.getSettings().automaticUpdatesActive) return;
    void Promise.resolve(autoUpdater.checkForUpdates()).catch((error) =>
      console.error("Sift update check failed", error),
    );
  }

  async #offerRestart(manualRequest = false): Promise<void> {
    if (!manualRequest && !this.getSettings().automaticUpdatesActive) return;
    const options: Electron.MessageBoxOptions = {
      type: "info",
      buttons: ["Restart and update", "Later"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "Sift update ready",
      message: "A newer version of Sift is ready.",
      detail:
        "Choose Restart and update to install it now. Choose Later to keep working. The downloaded update will install the next time Sift starts.",
    };
    const parent = BrowserWindow.getFocusedWindow();
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (
      result.response === 0 &&
      (manualRequest || this.getSettings().automaticUpdatesActive)
    ) {
      autoUpdater.quitAndInstall();
    }
  }

  #completeManualCheck(
    status: ManualUpdateCheckResult["status"],
  ): void {
    const pending = this.#pendingManualCheck;
    if (!pending) return;
    this.#pendingManualCheck = null;
    clearTimeout(pending.timeout);
    pending.resolve({ status, currentVersion: app.getVersion() });
  }

  #failManualCheck(error: Error): void {
    const pending = this.#pendingManualCheck;
    if (!pending) return;
    this.#pendingManualCheck = null;
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  #stopSchedule(): void {
    if (this.#delayTimer) clearTimeout(this.#delayTimer);
    if (this.#intervalTimer) clearInterval(this.#intervalTimer);
    this.#delayTimer = null;
    this.#intervalTimer = null;
  }
}
