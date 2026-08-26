import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executablePath = path.resolve(
  process.env.SIFT_PACKAGE_DIR ??
    process.env.MAIL_STEWARD_PACKAGE_DIR ??
    path.join("out", "Sift-win32-x64"),
  "Sift.exe",
);
const userDataDir = await mkdtemp(
  path.join(os.tmpdir(), "mail-steward-package-smoke-"),
);
let packagedApp;

try {
  packagedApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`, "--disable-gpu"],
    env: {
      ...process.env,
      SIFT_DISABLE_AUTO_UPDATE: "1",
      SIFT_PACKAGE_SMOKE: "1",
    },
  });
  packagedApp
    .process()
    .stderr?.on("data", (data) => process.stderr.write(data));

  const osEncryption = await packagedApp.evaluate(({ safeStorage }) => {
    if (!safeStorage.isEncryptionAvailable()) return { available: false };

    const canary = "mail-steward-runtime-canary";
    const encrypted = safeStorage.encryptString(canary);
    return {
      available: true,
      ciphertextBytes: encrypted.byteLength,
      plaintextAbsent: !encrypted.includes(Buffer.from(canary, "utf8")),
      roundTrip: safeStorage.decryptString(encrypted) === canary,
    };
  });
  if (
    !osEncryption.available ||
    !osEncryption.roundTrip ||
    !osEncryption.plaintextAbsent
  ) {
    throw new Error("Windows safeStorage runtime verification failed");
  }
  const actualUserDataDir = await packagedApp.evaluate(({ app }) =>
    app.getPath("userData"),
  );
  if (path.resolve(actualUserDataDir) !== path.resolve(userDataDir)) {
    throw new Error(
      `Packaged smoke test refused to use non-isolated data root: ${actualUserDataDir}`,
    );
  }
  const window = await packagedApp.firstWindow();
  window.on("console", (message) =>
    console.log(`[renderer:${message.type()}] ${message.text()}`),
  );
  window.on("pageerror", (error) =>
    console.error(`[renderer:error] ${error.message}`),
  );
  await window.waitForLoadState("domcontentloaded");

  try {
    await window.waitForFunction(
      () => Boolean(window.emailOrganizer),
      undefined,
      {
        timeout: 10_000,
      },
    );
  } catch (error) {
    const diagnostics = await window.evaluate(() => ({
      body: document.body.innerText.slice(0, 300),
      hasBridge: Boolean(window.emailOrganizer),
      title: document.title,
      url: location.href,
    }));
    throw new Error(
      `Packaged preload did not become available: ${JSON.stringify(diagnostics)}`,
      { cause: error },
    );
  }

  const result = await window.evaluate(async () => ({
    profileCount: (await window.emailOrganizer.listProfiles()).length,
    settings: await window.emailOrganizer.getAppSettings(),
    title: document.title,
    version: await window.emailOrganizer.getVersion(),
  }));

  if (result.title !== "Sift") {
    throw new Error(`Unexpected packaged window title: ${result.title}`);
  }
  if (!/^\d+\.\d+\.\d+/.test(result.version)) {
    throw new Error(`Unexpected packaged app version: ${result.version}`);
  }
  if (
    !result.settings.updatesSupported ||
    result.settings.autoUpdateEnabled ||
    result.settings.automaticUpdatesActive
  ) {
    throw new Error(
      `Packaged update preference boundary failed: ${JSON.stringify(result.settings)}`,
    );
  }
  const bridgeRuntime = await window.evaluate(async () => {
    await window.emailOrganizer.createProfile({ displayName: "Package smoke" });
    const currentAudit = await window.emailOrganizer.getCurrentProtonAudit();
    let disconnectedAuditRejected = false;
    try {
      await window.emailOrganizer.startProtonAudit({ extractBodies: false });
    } catch {
      disconnectedAuditRejected = true;
    }
    const diagnostic = await window.emailOrganizer.diagnoseProtonBridge({
      host: "127.0.0.1",
      port: 65_534,
      username: "synthetic-bridge-user",
      password: "synthetic-bridge-password",
      security: "plain",
    });
    return {
      currentAudit,
      diagnostic,
      disconnectedAuditRejected,
      auditMethodsPresent: [
        "startProtonAudit",
        "pauseProtonAudit",
        "resumeProtonAudit",
        "getCurrentProtonAudit",
        "onProtonAuditProgress",
      ].every((method) => typeof window.emailOrganizer[method] === "function"),
    };
  });
  if (
    bridgeRuntime.diagnostic.ok ||
    bridgeRuntime.diagnostic.category !== "bridge_unavailable"
  ) {
    throw new Error(
      `Unexpected packaged Bridge diagnostic: ${bridgeRuntime.diagnostic.category}`,
    );
  }
  if (
    bridgeRuntime.currentAudit !== null ||
    !bridgeRuntime.disconnectedAuditRejected ||
    !bridgeRuntime.auditMethodsPresent
  ) {
    throw new Error("Packaged audit lifecycle boundary verification failed");
  }

  console.log(
    `Packaged runtime launched securely (v${result.version}, OS encryption ${osEncryption.ciphertextBytes} bytes, Bridge and audit runtimes loaded).`,
  );
} finally {
  await packagedApp?.close();
  await rm(userDataDir, { recursive: true, force: true });
}
