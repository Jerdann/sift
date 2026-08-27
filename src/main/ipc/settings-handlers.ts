import type { IpcMain } from "electron";
import {
  appSettingsSchema,
  manualUpdateCheckResultSchema,
  updateAppSettingsInputSchema,
} from "../../shared/contracts/settings";
import { IPC_CHANNELS } from "../../shared/ipc";
import type { AutomaticUpdateController } from "../updates/auto-update";
import { assertTrustedIpcSender } from "../window-security";

export interface RegisterSettingsHandlersOptions {
  ipcMain: IpcMain;
  updates: AutomaticUpdateController;
  developmentServerUrl?: string;
}

export const registerSettingsHandlers = ({
  ipcMain,
  updates,
  developmentServerUrl,
}: RegisterSettingsHandlersOptions): (() => void) => {
  const trust = (event: Electron.IpcMainInvokeEvent): void =>
    assertTrustedIpcSender(
      event.senderFrame?.url,
      developmentServerUrl,
    );

  ipcMain.handle(IPC_CHANNELS.appSettingsGet, (event) => {
    trust(event);
    return appSettingsSchema.parse(updates.getSettings());
  });

  ipcMain.handle(IPC_CHANNELS.appSettingsUpdate, (event, rawInput) => {
    trust(event);
    const input = updateAppSettingsInputSchema.parse(rawInput);
    return appSettingsSchema.parse(
      updates.setAutoUpdateEnabled(input.autoUpdateEnabled),
    );
  });

  ipcMain.handle(IPC_CHANNELS.appUpdatesCheck, async (event) => {
    trust(event);
    return manualUpdateCheckResultSchema.parse(
      await updates.checkForUpdatesNow(),
    );
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.appSettingsGet);
    ipcMain.removeHandler(IPC_CHANNELS.appSettingsUpdate);
    ipcMain.removeHandler(IPC_CHANNELS.appUpdatesCheck);
  };
};
