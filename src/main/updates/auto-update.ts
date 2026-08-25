import { app } from 'electron';
import { updateElectronApp, UpdateSourceType } from 'update-electron-app';
import { automaticUpdateDelay } from './update-policy';

const beginUpdateChecks = (): void => {
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: 'Jerdann/sift',
    },
    updateInterval: '1 hour',
    notifyUser: true,
  });
};

export const startAutomaticUpdates = (): void => {
  const delay = automaticUpdateDelay({
    argv: process.argv,
    disabled: process.env.SIFT_DISABLE_AUTO_UPDATE === '1',
    isPackaged: app.isPackaged,
    platform: process.platform,
  });
  if (delay === null) return;
  if (delay === 0) {
    beginUpdateChecks();
    return;
  }
  setTimeout(beginUpdateChecks, delay).unref();
};
