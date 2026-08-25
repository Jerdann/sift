import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  accountIdentityListInputSchema,
  accountIdentitySummarySchema,
  accountIdentityUpdateInputSchema,
  accountSelectionInputSchema,
  mailAccountSummarySchema,
} from '../../shared/contracts/accounts';
import { IPC_CHANNELS } from '../../shared/ipc';
import { GmailConnectionRepository } from '../gmail/gmail-connection-repository';
import { GmailIdentityService } from '../gmail/gmail-identity-service';
import type { OAuthFetch } from '../gmail/gmail-oauth';
import { AccountIdentityRepository } from '../identity/account-identity-repository';
import { protonIdentityEvidence } from '../identity/ownership-evidence';
import { ProfileSession } from '../profiles/profile-session';
import { ProtonConnectionRepository } from '../proton/proton-connection-repository';
import { assertTrustedIpcSender } from '../window-security';

export const registerAccountHandlers = ({
  ipcMain,
  profileSession,
  developmentServerUrl,
  fetchPort = fetch,
}: {
  ipcMain: IpcMain;
  profileSession: ProfileSession;
  developmentServerUrl?: string;
  fetchPort?: OAuthFetch;
}): (() => void) => {
  const trust = (event: IpcMainInvokeEvent) =>
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
  const repositories = () => {
    const context = profileSession.requireActiveContext();
    const vault = profileSession.requireSecretVault();
    return {
      context,
      gmail: new GmailConnectionRepository(context.database, vault, context.profile.id),
      proton: new ProtonConnectionRepository(context.database, vault, context.profile.id),
      identities: new AccountIdentityRepository(context.database, context.profile.id),
    };
  };

  ipcMain.handle(IPC_CHANNELS.accountsList, (event) => {
    trust(event);
    const current = repositories();
    const selectedGmail = current.gmail.get()?.id;
    const selectedProton = current.proton.get()?.id;
    return z.array(mailAccountSummarySchema).parse([
      ...current.gmail.list().map((connection) => ({
        id: connection.id,
        provider: 'gmail' as const,
        label: connection.email,
        state: connection.state,
        selected: connection.id === selectedGmail,
        connectedAt: connection.connectedAt,
      })),
      ...current.proton.list().map((connection) => ({
        id: connection.id,
        provider: 'proton' as const,
        label: connection.username,
        state: connection.state,
        selected: connection.id === selectedProton,
        connectedAt: connection.lastConnectedAt,
      })),
    ].sort((left, right) => left.provider.localeCompare(right.provider) || left.label.localeCompare(right.label)));
  });

  ipcMain.handle(IPC_CHANNELS.accountsSelect, (event, rawInput: unknown) => {
    trust(event);
    const input = accountSelectionInputSchema.parse(rawInput);
    const current = repositories();
    if (input.provider === 'gmail') current.gmail.select(input.connectionId);
    else current.proton.select(input.connectionId);
    return mailAccountSummarySchema.parse({
      id: input.connectionId,
      provider: input.provider,
      label: input.provider === 'gmail'
        ? current.gmail.getById(input.connectionId)!.email
        : current.proton.getById(input.connectionId)!.username,
      state: input.provider === 'gmail'
        ? current.gmail.getById(input.connectionId)!.state
        : current.proton.getById(input.connectionId)!.state,
      selected: true,
      connectedAt: input.provider === 'gmail'
        ? current.gmail.getById(input.connectionId)!.connectedAt
        : current.proton.getById(input.connectionId)!.lastConnectedAt,
    });
  });

  ipcMain.handle(IPC_CHANNELS.identitiesList, (event, rawInput: unknown) => {
    trust(event);
    const input = accountIdentityListInputSchema.parse(rawInput);
    const current = repositories();
    let identities = current.identities.list(input.provider, input.connectionId);
    if (!identities.length) {
      if (input.provider === 'gmail') {
        identities = new GmailIdentityService(
          current.context.database,
          current.gmail,
          current.context.profile.id,
          fetchPort,
        ).syncLocal(input.connectionId);
      } else {
        identities = current.identities.sync(
          'proton',
          input.connectionId,
          protonIdentityEvidence(current.context.database, input.connectionId),
        );
      }
    }
    return z.array(accountIdentitySummarySchema).parse(identities);
  });

  ipcMain.handle(IPC_CHANNELS.identitiesRefresh, async (event, rawInput: unknown) => {
    trust(event);
    const input = accountIdentityListInputSchema.parse(rawInput);
    const current = repositories();
    const identities = input.provider === 'gmail'
      ? await new GmailIdentityService(
        current.context.database,
        current.gmail,
        current.context.profile.id,
        fetchPort,
      ).refresh(input.connectionId)
      : current.identities.sync(
        'proton',
        input.connectionId,
        protonIdentityEvidence(current.context.database, input.connectionId),
      );
    return z.array(accountIdentitySummarySchema).parse(identities);
  });

  ipcMain.handle(IPC_CHANNELS.identitiesUpdate, (event, rawInput: unknown) => {
    trust(event);
    return accountIdentitySummarySchema.parse(
      repositories().identities.update(accountIdentityUpdateInputSchema.parse(rawInput)),
    );
  });

  return () => {
    for (const channel of [
      IPC_CHANNELS.accountsList,
      IPC_CHANNELS.accountsSelect,
      IPC_CHANNELS.identitiesList,
      IPC_CHANNELS.identitiesRefresh,
      IPC_CHANNELS.identitiesUpdate,
    ]) ipcMain.removeHandler(channel);
  };
};
