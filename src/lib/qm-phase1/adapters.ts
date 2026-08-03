/**
 * QM Phase1 PoC 生产适配器（复用现有 PendingAction / Prisma claim）
 */

import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import {
  createPrismaBriefClaimStore,
  type BriefClaimStore,
} from "./brief-claim";
import {
  createDbSnapshotLoader,
  type ProjectBriefDeps,
} from "./project-daily-brief";

export function createPrismaClaimStore(): BriefClaimStore {
  return createPrismaBriefClaimStore(db as never);
}

export function createProductionBriefDeps(input: {
  scopeDeps: ProjectBriefDeps["scopeDeps"];
  audit?: boolean;
}): ProjectBriefDeps {
  return {
    scopeDeps: input.scopeDeps,
    claimStore: createPrismaClaimStore(),
    loadSnapshot: createDbSnapshotLoader(db),
    audit: input.audit !== false,
    createPendingActionSuggestion: async (args) => {
      const result = await createDraft({
        type: "grader.internal_note",
        title: args.title,
        preview: args.preview,
        payload: args.payload,
        userId: args.createdById,
        orgId: args.orgId,
        projectId:
          typeof args.payload.targetId === "string"
            ? args.payload.targetId
            : undefined,
        idempotencyKey: args.idempotencyKey,
      });
      if (!result.success) {
        return { created: false };
      }
      const data =
        result.data && typeof result.data === "object"
          ? (result.data as Record<string, unknown>)
          : null;
      const id =
        data && typeof data.actionId === "string" ? data.actionId : undefined;
      // createDraft 对同 idempotencyKey 复用已有草稿仍 success；
      // 外层 brief claim 已保证每日最多一次成功路径进入此处。
      return { created: true, id };
    },
  };
}
