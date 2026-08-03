/**
 * 项目每日简报原子 claim（模型调用前）
 *
 * 唯一键：orgId + projectId + briefType + localDate
 * 状态：STARTED → COMPLETED | FAILED
 * Stale：STARTED 且 claimExpiresAt < now → 可接管重试
 */

import { randomUUID } from "crypto";

export type BriefRunStatus = "STARTED" | "COMPLETED" | "FAILED";

export type BriefClaimRecord = {
  id: string;
  orgId: string;
  projectId: string;
  briefType: string;
  localDate: string;
  status: BriefRunStatus;
  correlationId: string | null;
  servicePrincipal: string | null;
  claimExpiresAt: Date | null;
  briefMarkdown: string | null;
  errorMessage: string | null;
  pendingActionId: string | null;
};

export type ClaimResult =
  | { ok: true; claimed: true; record: BriefClaimRecord }
  | { ok: true; claimed: false; reason: "duplicate_completed" | "in_progress"; record: BriefClaimRecord }
  | { ok: false; error: string };

export type BriefClaimStore = {
  claim: (input: {
    orgId: string;
    projectId: string;
    briefType: string;
    localDate: string;
    correlationId: string;
    servicePrincipal: string;
    claimTtlMs: number;
    now?: Date;
  }) => Promise<ClaimResult>;
  complete: (input: {
    id: string;
    briefMarkdown: string;
    pendingActionId?: string | null;
  }) => Promise<void>;
  fail: (input: { id: string; errorMessage: string }) => Promise<void>;
};

const STALE_TTL_MS = 15 * 60 * 1000;

/** 内存实现：支持真正的并发竞态测试（同步临界区） */
export function createMemoryBriefClaimStore(): BriefClaimStore & {
  rows: Map<string, BriefClaimRecord>;
} {
  const rows = new Map<string, BriefClaimRecord>();
  const keyOf = (o: string, p: string, t: string, d: string) =>
    `${o}|${p}|${t}|${d}`;

  return {
    rows,
    async claim(input) {
      const now = input.now ?? new Date();
      const key = keyOf(
        input.orgId,
        input.projectId,
        input.briefType,
        input.localDate,
      );
      const existing = rows.get(key);
      if (existing) {
        if (existing.status === "COMPLETED") {
          return { ok: true, claimed: false, reason: "duplicate_completed", record: existing };
        }
        if (
          existing.status === "STARTED" &&
          existing.claimExpiresAt &&
          existing.claimExpiresAt.getTime() > now.getTime()
        ) {
          return { ok: true, claimed: false, reason: "in_progress", record: existing };
        }
        // stale STARTED 或 FAILED → 接管
      }
      const record: BriefClaimRecord = {
        id: existing?.id ?? randomUUID(),
        orgId: input.orgId,
        projectId: input.projectId,
        briefType: input.briefType,
        localDate: input.localDate,
        status: "STARTED",
        correlationId: input.correlationId,
        servicePrincipal: input.servicePrincipal,
        claimExpiresAt: new Date(now.getTime() + input.claimTtlMs),
        briefMarkdown: null,
        errorMessage: null,
        pendingActionId: null,
      };
      rows.set(key, record);
      return { ok: true, claimed: true, record };
    },
    async complete(input) {
      for (const [k, r] of rows) {
        if (r.id === input.id) {
          rows.set(k, {
            ...r,
            status: "COMPLETED",
            briefMarkdown: input.briefMarkdown,
            pendingActionId: input.pendingActionId ?? null,
            claimExpiresAt: null,
          });
          return;
        }
      }
    },
    async fail(input) {
      for (const [k, r] of rows) {
        if (r.id === input.id) {
          rows.set(k, {
            ...r,
            status: "FAILED",
            errorMessage: input.errorMessage,
            claimExpiresAt: null,
          });
          return;
        }
      }
    },
  };
}

export const DEFAULT_CLAIM_TTL_MS = STALE_TTL_MS;

/** Prisma 原子 claim：create 撞唯一键 → 检查是否可接管 */
export function createPrismaBriefClaimStore(db: {
  projectDailyBriefRun: {
    create: (args: unknown) => Promise<BriefClaimRecord>;
    findUnique: (args: unknown) => Promise<BriefClaimRecord | null>;
    update: (args: unknown) => Promise<BriefClaimRecord>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
}): BriefClaimStore {
  return {
    async claim(input) {
      const now = input.now ?? new Date();
      const claimExpiresAt = new Date(now.getTime() + input.claimTtlMs);
      try {
        const created = (await db.projectDailyBriefRun.create({
          data: {
            orgId: input.orgId,
            projectId: input.projectId,
            briefType: input.briefType,
            localDate: input.localDate,
            status: "STARTED",
            correlationId: input.correlationId,
            servicePrincipal: input.servicePrincipal,
            claimExpiresAt,
          },
        })) as BriefClaimRecord;
        return { ok: true, claimed: true, record: created };
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: string }).code)
            : "";
        if (code !== "P2002") {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        const existing = (await db.projectDailyBriefRun.findUnique({
          where: {
            orgId_projectId_briefType_localDate: {
              orgId: input.orgId,
              projectId: input.projectId,
              briefType: input.briefType,
              localDate: input.localDate,
            },
          },
        })) as BriefClaimRecord | null;
        if (!existing) {
          return { ok: false, error: "claim conflict but row missing" };
        }
        if (existing.status === "COMPLETED") {
          return {
            ok: true,
            claimed: false,
            reason: "duplicate_completed",
            record: existing,
          };
        }
        const stale =
          existing.status === "FAILED" ||
          (existing.status === "STARTED" &&
            (!existing.claimExpiresAt ||
              new Date(existing.claimExpiresAt).getTime() <= now.getTime()));
        if (!stale) {
          return {
            ok: true,
            claimed: false,
            reason: "in_progress",
            record: existing,
          };
        }
        const updated = await db.projectDailyBriefRun.updateMany({
          where: {
            id: existing.id,
            OR: [
              { status: "FAILED" },
              {
                status: "STARTED",
                claimExpiresAt: { lte: now },
              },
              {
                status: "STARTED",
                claimExpiresAt: null,
              },
            ],
          },
          data: {
            status: "STARTED",
            correlationId: input.correlationId,
            servicePrincipal: input.servicePrincipal,
            claimExpiresAt,
            errorMessage: null,
            briefMarkdown: null,
            updatedAt: now,
          },
        });
        if (updated.count === 0) {
          const again = (await db.projectDailyBriefRun.findUnique({
            where: {
              orgId_projectId_briefType_localDate: {
                orgId: input.orgId,
                projectId: input.projectId,
                briefType: input.briefType,
                localDate: input.localDate,
              },
            },
          })) as BriefClaimRecord;
          return {
            ok: true,
            claimed: false,
            reason: "in_progress",
            record: again,
          };
        }
        const record = (await db.projectDailyBriefRun.findUnique({
          where: {
            orgId_projectId_briefType_localDate: {
              orgId: input.orgId,
              projectId: input.projectId,
              briefType: input.briefType,
              localDate: input.localDate,
            },
          },
        })) as BriefClaimRecord;
        return { ok: true, claimed: true, record };
      }
    },
    async complete(input) {
      await db.projectDailyBriefRun.update({
        where: { id: input.id },
        data: {
          status: "COMPLETED",
          briefMarkdown: input.briefMarkdown,
          pendingActionId: input.pendingActionId ?? null,
          claimExpiresAt: null,
        },
      });
    },
    async fail(input) {
      await db.projectDailyBriefRun.update({
        where: { id: input.id },
        data: {
          status: "FAILED",
          errorMessage: input.errorMessage,
          claimExpiresAt: null,
        },
      });
    },
  };
}
