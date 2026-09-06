import type {
  MailCategory,
  MailboxAnalysisSummary,
} from "../../shared/contracts/analysis";

export interface PortableMailRule {
  id: string;
  senderDomain: string;
  receivingAddress: string | null;
  category: MailCategory;
  targetFolder: string;
  markRead: boolean;
  spam: boolean;
  confidence: number;
  observedMessages: number;
}
export interface PortableRulePack {
  format: "sift-rule-pack";
  version: 1;
  generatedAt: string;
  classifierVersion: string;
  rules: PortableMailRule[];
  skippedAmbiguousStreams: number;
}

// Analysis summaries do not contain exact message predicates or the user's
// handling choices. Never derive executable filters from aggregate domains.
export const buildPortableRulePack = (
  analysis: MailboxAnalysisSummary,
): PortableRulePack => ({
  format: "sift-rule-pack",
  version: 1,
  generatedAt: analysis.analyzedAt,
  classifierVersion: analysis.classifierVersion,
  rules: [],
  skippedAmbiguousStreams: analysis.topStreams.length,
});
export const renderProtonSieve = (_pack: PortableRulePack): string => {
  throw new Error("review_purpose_filters_in_rules");
};
