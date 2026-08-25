import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  createProfileInputSchema,
  profileSummarySchema,
  selectProfileInputSchema,
} from '../../shared/contracts/profiles';
import { IPC_CHANNELS } from '../../shared/ipc';
import { ProfileSession } from '../profiles/profile-session';
import { assertTrustedIpcSender } from '../window-security';

export interface RegisterProfileHandlersOptions {
  ipcMain: IpcMain;
  profileSession: ProfileSession;
  developmentServerUrl?: string;
}

export const registerProfileHandlers = ({
  ipcMain,
  profileSession,
  developmentServerUrl,
}: RegisterProfileHandlersOptions): (() => void) => {
  const trust = (event: IpcMainInvokeEvent) =>
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);

  ipcMain.handle(IPC_CHANNELS.profilesList, (event) => {
    trust(event);
    return z.array(profileSummarySchema).parse(profileSession.listProfiles());
  });

  ipcMain.handle(IPC_CHANNELS.profilesCreate, (event, input: unknown) => {
    trust(event);
    const { displayName } = createProfileInputSchema.parse(input);
    return profileSummarySchema.parse(profileSession.createProfile(displayName));
  });

  ipcMain.handle(IPC_CHANNELS.profilesSelect, (event, input: unknown) => {
    trust(event);
    const { profileId } = selectProfileInputSchema.parse(input);
    return profileSummarySchema.parse(profileSession.selectProfile(profileId));
  });

  return () => {
    profileSession.close();
    for (const channel of [
      IPC_CHANNELS.profilesList,
      IPC_CHANNELS.profilesCreate,
      IPC_CHANNELS.profilesSelect,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
};
