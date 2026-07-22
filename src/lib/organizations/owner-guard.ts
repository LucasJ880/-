/**
 * Security-1：唯一 org_owner 保护（纯函数，便于单测）
 */

export function wouldRemoveLastOrgOwner(opts: {
  currentRole: string;
  currentStatus: string;
  nextRole: string;
  nextStatus: string;
  activeOwnerCount: number;
}): boolean {
  const isActiveOwner =
    opts.currentRole === "org_owner" && opts.currentStatus === "active";
  if (!isActiveOwner) return false;
  const remainsOwner =
    opts.nextRole === "org_owner" && opts.nextStatus === "active";
  if (remainsOwner) return false;
  return opts.activeOwnerCount <= 1;
}
