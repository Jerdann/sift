import type { OrganizationProposal } from "../../shared/contracts/organization";

export function groupedProposalItems(proposal: OrganizationProposal | null) {
  type Row = OrganizationProposal["items"][number] & {
    itemIds: string[];
    groupId: string;
    groupName: string;
    color: string;
  };
  const rows = new Map<string, Row>();
  for (const item of proposal?.items ?? []) {
    const group = proposal?.groups?.find(
      (g) => item.scopeAddress && g.addresses.includes(item.scopeAddress),
    );
    const groupId = group?.id ?? (item.scopeAddress ? "main" : "unmatched");
    const key = JSON.stringify([
      groupId,
      item.category,
      item.targetPath,
      item.enabled,
    ]);
    const current = rows.get(key);
    if (current) {
      current.confidence =
        (current.confidence * current.messageCount +
          item.confidence * item.messageCount) /
        (current.messageCount + item.messageCount);
      current.messageCount += item.messageCount;
      current.itemIds.push(item.id);
      current.latestAt =
        [current.latestAt, item.latestAt].filter(Boolean).sort().at(-1) ?? null;
      current.samples = [
        ...new Set([...current.samples, ...item.samples]),
      ].slice(0, 5);
    } else
      rows.set(key, {
        ...item,
        itemIds: [item.id],
        groupId,
        groupName:
          group?.name ?? (item.scopeAddress ? "Main" : "Unmatched addresses"),
        color: group?.color ?? "blue",
      });
  }
  return [...rows.values()];
}
