import type { Dialog, IpcMain, IpcMainInvokeEvent } from "electron";
import { writeFileSync } from "node:fs";
import {
  backupResultSchema,
  diagnosticsExportResultSchema,
  diagnosticsSummarySchema,
  rebuildIndexInputSchema,
  rebuildIndexResultSchema,
  restoreProfileInputSchema,
  restoreResultSchema,
} from "../../shared/contracts/recovery";
import { IPC_CHANNELS } from "../../shared/ipc";
import type { ProfileSession } from "../profiles/profile-session";
import {
  diagnostics,
  rebuildLocalIndex,
  restoreEncryptedBackup,
  writeEncryptedBackup,
} from "../recovery/recovery-service";
import type { SafeStoragePort } from "../secrets/safe-storage-vault";
import { assertTrustedIpcSender } from "../window-security";

export interface RegisterRecoveryHandlersOptions {
  ipcMain: IpcMain;
  dialog: Pick<Dialog, "showOpenDialog" | "showSaveDialog">;
  profileSession: ProfileSession;
  safeStorage: SafeStoragePort;
  appVersion: string;
  developmentServerUrl?: string;
}

export const registerRecoveryHandlers = ({
  ipcMain,
  dialog,
  profileSession,
  safeStorage,
  appVersion,
  developmentServerUrl,
}: RegisterRecoveryHandlersOptions): (() => void) => {
  const trust = (event: IpcMainInvokeEvent) =>
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);

  ipcMain.handle(IPC_CHANNELS.recoveryDiagnosticsGet, (event) => {
    trust(event);
    return diagnosticsSummarySchema.parse(
      diagnostics(
        profileSession.requireActiveContext(),
        safeStorage,
        appVersion,
      ),
    );
  });

  ipcMain.handle(IPC_CHANNELS.recoveryDiagnosticsExport, async (event) => {
    trust(event);
    const result = await dialog.showSaveDialog({
      title: "Export content-free Sift diagnostics",
      defaultPath: `sift-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) {
      return diagnosticsExportResultSchema.parse({
        canceled: true,
        path: null,
      });
    }
    const report = diagnostics(
      profileSession.requireActiveContext(),
      safeStorage,
      appVersion,
    );
    writeFileSync(result.filePath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
    });
    return diagnosticsExportResultSchema.parse({
      canceled: false,
      path: result.filePath,
    });
  });

  ipcMain.handle(IPC_CHANNELS.recoveryBackupCreate, async (event) => {
    trust(event);
    const result = await dialog.showSaveDialog({
      title: "Create encrypted Sift profile backup",
      defaultPath: `sift-profile-${new Date().toISOString().slice(0, 10)}.siftbackup`,
      filters: [{ name: "Sift encrypted backup", extensions: ["siftbackup"] }],
    });
    if (result.canceled || !result.filePath) {
      return backupResultSchema.parse({
        canceled: true,
        path: null,
        createdAt: null,
        bytes: 0,
      });
    }
    const created = await writeEncryptedBackup(
      profileSession.requireActiveContext(),
      safeStorage,
      appVersion,
      result.filePath,
    );
    return backupResultSchema.parse({
      canceled: false,
      path: result.filePath,
      ...created,
    });
  });

  ipcMain.handle(
    IPC_CHANNELS.recoveryBackupRestore,
    async (event, input: unknown) => {
      trust(event);
      restoreProfileInputSchema.parse(input);
      const result = await dialog.showOpenDialog({
        title: "Restore encrypted Sift profile backup",
        properties: ["openFile"],
        filters: [
          { name: "Sift encrypted backup", extensions: ["siftbackup"] },
        ],
      });
      if (result.canceled || result.filePaths.length !== 1) return null;
      const [source] = result.filePaths;
      if (!source) return null;
      return restoreResultSchema.parse(
        restoreEncryptedBackup(profileSession, safeStorage, source),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.recoveryIndexRebuild, (event, input: unknown) => {
    trust(event);
    rebuildIndexInputSchema.parse(input);
    return rebuildIndexResultSchema.parse(
      rebuildLocalIndex(profileSession.requireActiveContext()),
    );
  });

  return () => {
    for (const channel of [
      IPC_CHANNELS.recoveryDiagnosticsGet,
      IPC_CHANNELS.recoveryDiagnosticsExport,
      IPC_CHANNELS.recoveryBackupCreate,
      IPC_CHANNELS.recoveryBackupRestore,
      IPC_CHANNELS.recoveryIndexRebuild,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
};
