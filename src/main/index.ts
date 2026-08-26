import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
} from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import squirrelStartup from "electron-squirrel-startup";
import { IPC_CHANNELS } from "../shared/ipc";
import { registerProfileHandlers } from "./ipc/profile-handlers";
import { registerJobHandlers } from "./ipc/job-handlers";
import { registerProtonHandlers } from "./ipc/proton-handlers";
import { registerProtonAuditHandlers } from "./ipc/proton-audit-handlers";
import { registerAnalysisHandlers } from "./ipc/analysis-handlers";
import { registerCleanupHandlers } from "./ipc/cleanup-handlers";
import { registerUnsubscribeHandlers } from "./ipc/unsubscribe-handlers";
import { registerGmailHandlers } from "./ipc/gmail-handlers";
import { registerAccountHandlers } from "./ipc/account-handlers";
import { registerOutlookHandlers } from "./ipc/outlook-handlers";
import { registerRecoveryHandlers } from "./ipc/recovery-handlers";
import { ProfileRepository } from "./profiles/profile-repository";
import { ProfileSession } from "./profiles/profile-session";
import { startAutomaticUpdates } from "./updates/auto-update";
import { SafeStorageVault } from "./secrets/safe-storage-vault";
import {
  APP_HOST,
  APP_ORIGIN,
  APP_SCHEME,
  assertTrustedIpcSender,
  SECURE_WEB_PREFERENCES,
  secureSession,
  secureWebContents,
} from "./window-security";

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
]);

app.enableSandbox();

if (process.platform === "win32") {
  app.setAppUserModelId("com.squirrel.sift.Sift");
}

const handlingSquirrelStartup = app.isPackaged && squirrelStartup;
if (handlingSquirrelStartup) app.quit();

// Keep profiles created by the pre-Sift build discoverable after the rename.
const legacyUserData = path.join(app.getPath("appData"), "Mail Steward");
if (existsSync(legacyUserData)) app.setPath("userData", legacyUserData);

const developmentServerUrl =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "undefined"
    ? undefined
    : MAIN_WINDOW_VITE_DEV_SERVER_URL;
const rendererName =
  typeof MAIN_WINDOW_VITE_NAME === "undefined"
    ? "main_window"
    : MAIN_WINDOW_VITE_NAME;
const mainDirectory = path.dirname(fileURLToPath(import.meta.url));

const resolveRendererResource = (requestUrl: string): string | null => {
  const url = new URL(requestUrl);
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;

  const rendererRoot = path.resolve(
    mainDirectory,
    `../renderer/${rendererName}`,
  );
  const relativePath =
    decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const resourcePath = path.resolve(rendererRoot, relativePath);
  const contained =
    resourcePath === rendererRoot ||
    resourcePath.startsWith(`${rendererRoot}${path.sep}`);

  return contained ? resourcePath : null;
};

const registerAppProtocol = (): void => {
  protocol.handle(APP_SCHEME, (request) => {
    const resourcePath = resolveRendererResource(request.url);
    if (!resourcePath) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(resourcePath).toString());
  });
};

const registerIpcHandlers = (): void => {
  ipcMain.removeHandler(IPC_CHANNELS.appGetVersion);
  ipcMain.handle(IPC_CHANNELS.appGetVersion, (event) => {
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
    return z.string().parse(app.getVersion());
  });

  const testDataRoot = process.env.MAIL_STEWARD_TEST_DATA_ROOT;
  const applicationDataRoot =
    !app.isPackaged && testDataRoot
      ? path.resolve(testDataRoot)
      : app.getPath("userData");
  const repository = new ProfileRepository(applicationDataRoot);
  const profileSession = new ProfileSession(
    repository,
    (context) =>
      new SafeStorageVault(applicationDataRoot, context.database, safeStorage),
  );
  registerProfileHandlers({
    ipcMain,
    profileSession,
    developmentServerUrl,
  });
  registerJobHandlers({ ipcMain, profileSession, developmentServerUrl });
  registerProtonHandlers({ ipcMain, profileSession, developmentServerUrl });
  registerProtonAuditHandlers({
    ipcMain,
    profileSession,
    developmentServerUrl,
  });
  registerAnalysisHandlers({ ipcMain, profileSession, developmentServerUrl });
  registerCleanupHandlers({ ipcMain, profileSession, developmentServerUrl });
  registerUnsubscribeHandlers({
    ipcMain,
    profileSession,
    developmentServerUrl,
  });
  registerGmailHandlers({ ipcMain, profileSession, developmentServerUrl });
  registerAccountHandlers({ ipcMain, profileSession, developmentServerUrl });
  registerOutlookHandlers({ ipcMain, profileSession, developmentServerUrl });
  registerRecoveryHandlers({
    ipcMain,
    dialog,
    profileSession,
    safeStorage,
    appVersion: app.getVersion(),
    developmentServerUrl,
  });
};

export const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    backgroundColor: "#0E1116",
    center: true,
    height: 800,
    minHeight: 720,
    minWidth: 640,
    show: false,
    title: "Sift",
    width: 1280,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(mainDirectory, "preload.js"),
      sandbox: true,
    },
  });

  secureWebContents(window.webContents, developmentServerUrl);
  window.once("ready-to-show", () => window.show());

  if (developmentServerUrl) {
    void window.loadURL(developmentServerUrl);
  } else {
    void window.loadURL(APP_ORIGIN);
  }

  return window;
};

if (!handlingSquirrelStartup)
  void app.whenReady().then(() => {
    registerAppProtocol();
    secureSession(session.defaultSession);
    registerIpcHandlers();
    createMainWindow();
    startAutomaticUpdates();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
