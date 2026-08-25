import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  bridgeConnectResultSchema,
  bridgeCredentialsSchema,
  bridgeDiagnosticSchema,
  protonConnectionSummarySchema,
  protonDiscoverySummarySchema,
  protonDisconnectInputSchema,
} from '../../shared/contracts/proton';
import { IPC_CHANNELS } from '../../shared/ipc';
import { ProfileSession } from '../profiles/profile-session';
import { diagnoseBridge, type BridgeClientFactory } from '../proton/bridge-client';
import { ProtonConnectionRepository } from '../proton/proton-connection-repository';
import {
  createProtonReadClient,
  type ProtonReadClientFactory,
} from '../proton/bridge-client';
import { ProtonDiscoveryRepository } from '../proton/proton-discovery-repository';
import { discoverProtonMailbox } from '../proton/proton-discovery-service';
import { assertTrustedIpcSender } from '../window-security';

export interface RegisterProtonHandlersOptions {
  ipcMain: IpcMain;
  profileSession: ProfileSession;
  developmentServerUrl?: string;
  createBridgeClient?: BridgeClientFactory;
  createProtonReadClient?: ProtonReadClientFactory;
}

export const registerProtonHandlers = ({
  ipcMain,
  profileSession,
  developmentServerUrl,
  createBridgeClient,
  createProtonReadClient: createReadClient = createProtonReadClient,
}: RegisterProtonHandlersOptions): (() => void) => {
  const trust = (event: IpcMainInvokeEvent) =>
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
  const repository = () => {
    const context = profileSession.requireActiveContext();
    return new ProtonConnectionRepository(
      context.database,
      profileSession.requireSecretVault(),
      context.profile.id,
    );
  };
  const discoveryRepository = () => {
    const context = profileSession.requireActiveContext();
    return new ProtonDiscoveryRepository(context.database, context.profile.id);
  };
  const gmailCount = (): number => {
    const context = profileSession.requireActiveContext();
    return Number((context.database.prepare('SELECT COUNT(*) AS count FROM gmail_connections WHERE profile_id = ?').get(context.profile.id) as { count: number }).count);
  };

  ipcMain.handle(IPC_CHANNELS.protonGetConnection, (event) => {
    trust(event);
    return protonConnectionSummarySchema.nullable().parse(repository().get());
  });

  ipcMain.handle(IPC_CHANNELS.protonDiagnose, async (event, rawInput: unknown) => {
    trust(event);
    const credentials = bridgeCredentialsSchema.parse(rawInput);
    return bridgeDiagnosticSchema.parse(
      await diagnoseBridge(credentials, createBridgeClient),
    );
  });

  ipcMain.handle(IPC_CHANNELS.protonConnect, async (event, rawInput: unknown) => {
    trust(event);
    const credentials = bridgeCredentialsSchema.parse(rawInput);
    const diagnostic = await diagnoseBridge(credentials, createBridgeClient);
    if (!diagnostic.ok) {
      repository().markAttention(diagnostic.category);
      return bridgeConnectResultSchema.parse({ diagnostic, connection: null });
    }

    const connection = repository().save(credentials);
    profileSession.setActiveProviderCount(1 + gmailCount());
    return bridgeConnectResultSchema.parse({ diagnostic, connection });
  });

  ipcMain.handle(IPC_CHANNELS.protonDisconnect, (event, rawInput: unknown) => {
    trust(event);
    const { connectionId } = protonDisconnectInputSchema.parse(rawInput);
    repository().disconnect(connectionId);
    profileSession.setActiveProviderCount(gmailCount());
  });

  ipcMain.handle(IPC_CHANNELS.protonGetDiscovery, (event) => {
    trust(event);
    const connection = repository().get();
    return protonDiscoverySummarySchema.nullable().parse(
      connection ? discoveryRepository().get(connection.id) : null,
    );
  });

  ipcMain.handle(IPC_CHANNELS.protonDiscover, async (event) => {
    trust(event);
    return protonDiscoverySummarySchema.parse(
      await discoverProtonMailbox(repository(), discoveryRepository(), createReadClient),
    );
  });

  return () => {
    for (const channel of [
      IPC_CHANNELS.protonGetConnection,
      IPC_CHANNELS.protonDiagnose,
      IPC_CHANNELS.protonConnect,
      IPC_CHANNELS.protonDisconnect,
      IPC_CHANNELS.protonDiscover,
      IPC_CHANNELS.protonGetDiscovery,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
};
