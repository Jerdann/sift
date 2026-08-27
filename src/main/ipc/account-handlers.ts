import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import {
  accountIdentityListInputSchema,
  accountIdentitySummarySchema,
  accountIdentityUpdateInputSchema,
  accountSelectionInputSchema,
  mailAccountSummarySchema,
} from "../../shared/contracts/accounts";
import { IPC_CHANNELS } from "../../shared/ipc";
import { GmailConnectionRepository } from "../gmail/gmail-connection-repository";
import { GmailIdentityService } from "../gmail/gmail-identity-service";
import type { OAuthFetch } from "../gmail/gmail-oauth";
import { AccountIdentityRepository } from "../identity/account-identity-repository";
import { protonIdentityEvidence } from "../identity/ownership-evidence";
import { ProfileSession } from "../profiles/profile-session";
import { ProtonConnectionRepository } from "../proton/proton-connection-repository";
import { assertTrustedIpcSender } from "../window-security";
import { OrganizationProposalRepository } from "../organization/organization-proposal-repository";
import {
  editOrganizationProposalSchema,
  organizationProposalSchema,
  organizationProposalScopeSchema,
} from "../../shared/contracts/organization";
import {
  approveRulePlanSchema,
  retryRulePlanSchema,
  undoRulePlanSchema,
  ruleInventorySchema,
  ruleManagementScopeSchema,
  ruleReconciliationPlanSchema,
} from "../../shared/contracts/rule-management";
import { RuleReconciliationRepository } from "../rules/rule-reconciliation-repository";
import { GmailRuleInventoryService } from "../gmail/gmail-rule-inventory-service";
import { ProtonRuleInventoryService } from "../rules/proton-rule-inventory-service";
import { GmailRuleReconciliationRunner } from "../gmail/gmail-rule-reconciliation-runner";
import { JobRepository } from "../jobs/job-repository";
import { OutlookConnectionRepository } from "../outlook/outlook-connection-repository";
import { OutlookIdentityService } from "../outlook/outlook-identity-service";
import { OutlookRuleInventoryService } from "../outlook/outlook-rule-inventory-service";
import { OutlookRuleReconciliationRunner } from "../outlook/outlook-rule-reconciliation-runner";
import {
  completeSpamReviewSchema,
  spamReviewSchema,
  spamReviewScopeSchema,
} from "../../shared/contracts/spam-review";
import { SpamReviewRepository } from "../spam/spam-review-repository";

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
    const jobs = new JobRepository(context.database);
    return {
      context,
      gmail: new GmailConnectionRepository(
        context.database,
        vault,
        context.profile.id,
      ),
      proton: new ProtonConnectionRepository(
        context.database,
        vault,
        context.profile.id,
      ),
      outlook: new OutlookConnectionRepository(
        context.database,
        vault,
        context.profile.id,
      ),
      identities: new AccountIdentityRepository(
        context.database,
        context.profile.id,
      ),
      proposals: new OrganizationProposalRepository(
        context.database,
        context.profile.id,
      ),
      spamReviews: new SpamReviewRepository(
        context.database,
        context.profile.id,
      ),
      jobs,
      rules: new RuleReconciliationRepository(
        context.database,
        context.profile.id,
        { jobs },
      ),
    };
  };

  ipcMain.handle(IPC_CHANNELS.accountsList, (event) => {
    trust(event);
    const current = repositories();
    const selectedGmail = current.gmail.get()?.id;
    const selectedProton = current.proton.get()?.id;
    const selectedOutlook = current.outlook.get()?.id;
    return z.array(mailAccountSummarySchema).parse(
      [
        ...current.gmail.list().map((connection) => ({
          id: connection.id,
          provider: "gmail" as const,
          label: connection.email,
          state: connection.state,
          selected: connection.id === selectedGmail,
          connectedAt: connection.connectedAt,
          capabilities: {
            audit: "native",
            addresses: "provider",
            organization: "labels",
            rules: "live",
            unsubscribe: "one_click",
            spam: "native",
            trash: "native",
          },
        })),
        ...current.proton.list().map((connection) => ({
          id: connection.id,
          provider: "proton" as const,
          label: connection.username,
          state: connection.state,
          selected: connection.id === selectedProton,
          connectedAt: connection.lastConnectedAt,
          capabilities: {
            audit: "local",
            addresses: "evidence",
            organization: "folders",
            rules: "export",
            unsubscribe: "one_click",
            spam: "native",
            trash: "native",
          },
        })),
        ...current.outlook.list().map((connection) => ({
          id: connection.id,
          provider: "outlook" as const,
          label: connection.email,
          state: connection.state,
          selected: connection.id === selectedOutlook,
          connectedAt: connection.connectedAt,
          capabilities: {
            audit: "native",
            addresses: "provider",
            organization: "folders",
            rules: "live",
            unsubscribe: "one_click",
            spam: "native",
            trash: "native",
          },
        })),
      ].sort(
        (left, right) =>
          left.provider.localeCompare(right.provider) ||
          left.label.localeCompare(right.label),
      ),
    );
  });

  ipcMain.handle(IPC_CHANNELS.accountsSelect, (event, rawInput: unknown) => {
    trust(event);
    const input = accountSelectionInputSchema.parse(rawInput);
    const current = repositories();
    if (input.provider === "gmail") current.gmail.select(input.connectionId);
    else if (input.provider === "outlook")
      current.outlook.select(input.connectionId);
    else current.proton.select(input.connectionId);
    return mailAccountSummarySchema.parse({
      id: input.connectionId,
      provider: input.provider,
      label:
        input.provider === "gmail"
          ? current.gmail.getById(input.connectionId)!.email
          : input.provider === "outlook"
            ? current.outlook.getById(input.connectionId)!.email
            : current.proton.getById(input.connectionId)!.username,
      state:
        input.provider === "gmail"
          ? current.gmail.getById(input.connectionId)!.state
          : input.provider === "outlook"
            ? current.outlook.getById(input.connectionId)!.state
            : current.proton.getById(input.connectionId)!.state,
      selected: true,
      connectedAt:
        input.provider === "gmail"
          ? current.gmail.getById(input.connectionId)!.connectedAt
          : input.provider === "outlook"
            ? current.outlook.getById(input.connectionId)!.connectedAt
            : current.proton.getById(input.connectionId)!.lastConnectedAt,
      capabilities:
        input.provider === "gmail"
          ? {
              audit: "native",
              addresses: "provider",
              organization: "labels",
              rules: "live",
              unsubscribe: "one_click",
              spam: "native",
              trash: "native",
            }
          : input.provider === "outlook"
            ? {
                audit: "native",
                addresses: "provider",
                organization: "folders",
                rules: "live",
                unsubscribe: "one_click",
                spam: "native",
                trash: "native",
              }
            : {
                audit: "local",
                addresses: "evidence",
                organization: "folders",
                rules: "export",
                unsubscribe: "one_click",
                spam: "native",
                trash: "native",
              },
    });
  });

  ipcMain.handle(IPC_CHANNELS.identitiesList, (event, rawInput: unknown) => {
    trust(event);
    const input = accountIdentityListInputSchema.parse(rawInput);
    const current = repositories();
    let identities = current.identities.list(
      input.provider,
      input.connectionId,
    );
    if (!identities.length) {
      if (input.provider === "gmail") {
        identities = new GmailIdentityService(
          current.context.database,
          current.gmail,
          current.context.profile.id,
          fetchPort,
        ).syncLocal(input.connectionId);
      } else if (input.provider === "proton") {
        identities = current.identities.sync(
          "proton",
          input.connectionId,
          protonIdentityEvidence(current.context.database, input.connectionId),
        );
      } else {
        identities = new OutlookIdentityService(
          current.context.database,
          current.outlook,
          current.context.profile.id,
          fetchPort,
        ).syncLocal(input.connectionId);
      }
    }
    return z.array(accountIdentitySummarySchema).parse(identities);
  });

  ipcMain.handle(
    IPC_CHANNELS.identitiesRefresh,
    async (event, rawInput: unknown) => {
      trust(event);
      const input = accountIdentityListInputSchema.parse(rawInput);
      const current = repositories();
      const identities =
        input.provider === "gmail"
          ? await new GmailIdentityService(
              current.context.database,
              current.gmail,
              current.context.profile.id,
              fetchPort,
            ).refresh(input.connectionId)
          : input.provider === "proton"
            ? current.identities.sync(
                "proton",
                input.connectionId,
                protonIdentityEvidence(
                  current.context.database,
                  input.connectionId,
                ),
              )
            : await new OutlookIdentityService(
                current.context.database,
                current.outlook,
                current.context.profile.id,
                fetchPort,
              ).refresh(input.connectionId);
      return z.array(accountIdentitySummarySchema).parse(identities);
    },
  );

  ipcMain.handle(IPC_CHANNELS.identitiesUpdate, (event, rawInput: unknown) => {
    trust(event);
    return accountIdentitySummarySchema.parse(
      repositories().identities.update(
        accountIdentityUpdateInputSchema.parse(rawInput),
      ),
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.organizationProposalGet,
    (event, rawInput: unknown) => {
      trust(event);
      const input = organizationProposalScopeSchema.parse(rawInput);
      return organizationProposalSchema
        .nullable()
        .parse(
          repositories().proposals.get(input.provider, input.connectionId),
        );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.organizationProposalGenerate,
    (event, rawInput: unknown) => {
      trust(event);
      const input = organizationProposalScopeSchema.parse(rawInput);
      return organizationProposalSchema.parse(
        repositories().proposals.generate(input.provider, input.connectionId),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.organizationProposalEdit,
    (event, rawInput: unknown) => {
      trust(event);
      return organizationProposalSchema.parse(
        repositories().proposals.edit(
          editOrganizationProposalSchema.parse(rawInput),
        ),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.spamReviewGet, (event, rawInput: unknown) => {
    trust(event);
    const input = spamReviewScopeSchema.parse(rawInput);
    return spamReviewSchema
      .nullable()
      .parse(
        repositories().spamReviews.getCurrent(
          input.provider,
          input.connectionId,
        ),
      );
  });

  ipcMain.handle(
    IPC_CHANNELS.spamReviewGenerate,
    (event, rawInput: unknown) => {
      trust(event);
      const input = spamReviewScopeSchema.parse(rawInput);
      return spamReviewSchema.parse(
        repositories().spamReviews.generate(
          input.provider,
          input.connectionId,
        ),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.spamReviewComplete,
    (event, rawInput: unknown) => {
      trust(event);
      return spamReviewSchema.parse(
        repositories().spamReviews.complete(
          completeSpamReviewSchema.parse(rawInput),
        ),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.ruleInventoryGet, (event, rawInput: unknown) => {
    trust(event);
    const input = ruleManagementScopeSchema.parse(rawInput);
    return ruleInventorySchema
      .nullable()
      .parse(
        repositories().rules.getCurrentInventory(
          input.provider,
          input.connectionId,
        ),
      );
  });

  ipcMain.handle(
    IPC_CHANNELS.ruleInventoryRefresh,
    async (event, rawInput: unknown) => {
      trust(event);
      const input = ruleManagementScopeSchema.parse(rawInput);
      const current = repositories();
      const inventory =
        input.provider === "gmail"
          ? await new GmailRuleInventoryService(
              current.gmail,
              current.rules,
              fetchPort,
            ).refresh(input.connectionId)
          : input.provider === "outlook"
            ? await new OutlookRuleInventoryService(
                current.outlook,
                current.rules,
                fetchPort,
              ).refresh(input.connectionId)
            : new ProtonRuleInventoryService(current.rules).refresh(
                input.connectionId,
              );
      return ruleInventorySchema.parse(inventory);
    },
  );

  ipcMain.handle(IPC_CHANNELS.rulePlanGet, (event, rawInput: unknown) => {
    trust(event);
    const input = ruleManagementScopeSchema.parse(rawInput);
    return ruleReconciliationPlanSchema
      .nullable()
      .parse(
        repositories().rules.getCurrentPlan(input.provider, input.connectionId),
      );
  });

  ipcMain.handle(IPC_CHANNELS.rulePlanGenerate, (event, rawInput: unknown) => {
    trust(event);
    const input = ruleManagementScopeSchema.parse(rawInput);
    return ruleReconciliationPlanSchema.parse(
      repositories().rules.generate(
        input.provider,
        input.connectionId,
        input.replaceExternalRules ?? false,
      ),
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.rulePlanApprove,
    async (event, rawInput: unknown) => {
      trust(event);
      const input = approveRulePlanSchema.parse(rawInput);
      const current = repositories();
      const approved = current.rules.approve(
        input.planId,
        input.revision,
        input.enabledOperationIds,
      );
      if (!approved.job) throw new Error("provider_rule_apply_requires_export");
      const result =
        approved.provider === "gmail"
          ? await new GmailRuleReconciliationRunner(
              current.gmail,
              current.rules,
              current.jobs,
              fetchPort,
            ).run(approved.job.id)
          : approved.provider === "outlook"
            ? await new OutlookRuleReconciliationRunner(
                current.outlook,
                current.rules,
                current.jobs,
                fetchPort,
              ).run(approved.job.id)
            : (() => {
                throw new Error("provider_rule_apply_requires_export");
              })();
      return ruleReconciliationPlanSchema.parse(result);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.rulePlanRetry,
    async (event, rawInput: unknown) => {
      trust(event);
      const input = retryRulePlanSchema.parse(rawInput);
      const current = repositories();
      const retried = current.rules.retry(input.planId, input.operationIds);
      if (!retried.job) throw new Error("provider_rule_apply_requires_export");
      const result =
        retried.provider === "gmail"
          ? await new GmailRuleReconciliationRunner(
              current.gmail,
              current.rules,
              current.jobs,
              fetchPort,
            ).run(retried.job.id)
          : retried.provider === "outlook"
            ? await new OutlookRuleReconciliationRunner(
                current.outlook,
                current.rules,
                current.jobs,
                fetchPort,
              ).run(retried.job.id)
            : (() => {
                throw new Error("provider_rule_apply_requires_export");
              })();
      return ruleReconciliationPlanSchema.parse(result);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.rulePlanUndo,
    async (event, rawInput: unknown) => {
      trust(event);
      const input = undoRulePlanSchema.parse(rawInput);
      const current = repositories();
      const prepared = current.rules.prepareUndo(input.planId);
      if (!prepared.undoJob)
        throw new Error("provider_rule_undo_requires_export");
      const result =
        prepared.provider === "gmail"
          ? await new GmailRuleReconciliationRunner(
              current.gmail,
              current.rules,
              current.jobs,
              fetchPort,
            ).undo(prepared.undoJob.id)
          : prepared.provider === "outlook"
            ? await new OutlookRuleReconciliationRunner(
                current.outlook,
                current.rules,
                current.jobs,
                fetchPort,
              ).undo(prepared.undoJob.id)
            : (() => {
                throw new Error("provider_rule_undo_requires_export");
              })();
      return ruleReconciliationPlanSchema.parse(result);
    },
  );

  return () => {
    for (const channel of [
      IPC_CHANNELS.accountsList,
      IPC_CHANNELS.accountsSelect,
      IPC_CHANNELS.identitiesList,
      IPC_CHANNELS.identitiesRefresh,
      IPC_CHANNELS.identitiesUpdate,
      IPC_CHANNELS.organizationProposalGet,
      IPC_CHANNELS.organizationProposalGenerate,
      IPC_CHANNELS.organizationProposalEdit,
      IPC_CHANNELS.spamReviewGet,
      IPC_CHANNELS.spamReviewGenerate,
      IPC_CHANNELS.spamReviewComplete,
      IPC_CHANNELS.ruleInventoryGet,
      IPC_CHANNELS.ruleInventoryRefresh,
      IPC_CHANNELS.rulePlanGet,
      IPC_CHANNELS.rulePlanGenerate,
      IPC_CHANNELS.rulePlanApprove,
      IPC_CHANNELS.rulePlanRetry,
      IPC_CHANNELS.rulePlanUndo,
    ])
      ipcMain.removeHandler(channel);
  };
};
