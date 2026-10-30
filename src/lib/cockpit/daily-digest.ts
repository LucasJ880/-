/**
 * 组织驾驶舱 — 夜间岗位日结（A-5，openspec change org-cockpit-daily-digest）
 *
 * 组织本地 00 点，把前一个本地日 A-4 按岗位工作量汇总的那一列固定成一条 AuditLog（cockpit.post_daily_digest）。
 * 只含十个计数：不含平台级自动化运行数、token、成本，也不含任何正文 / 客户 / 金额 / 员工。
 * 不写 MemoryClaim（Corporate Memory 只允许人工写入），不发通知、不调 LLM、不建审批。
 * 同一组织同一本地日只有一条：事务内按组织 + 本地日加 advisory lock，先查后写。依赖可注入。
 */

import type { AutomationKey } from "@/lib/automation/registry";
import { localDayKeys, WORKLOAD_MIN_DAYS, type WorkloadCounts, type WorkloadResult, type WorkloadRowKey } from "./workload";

export const POST_DAILY_DIGEST_ACTION = "cockpit.post_daily_digest";
export const POST_DAILY_DIGEST_AUTOMATION_KEY = "post-daily-digest" satisfies AutomationKey;
/** 组织本地 00 点汇总前一个本地日（路由里的门控写成字面量 [0]，测试对照） */
export const POST_DAILY_DIGEST_HOUR = 0;

/** 日结只取这十个计数（顺序即写入顺序） */
export const DIGEST_COUNT_FIELDS = [
  "agentRuns",
  "proposed",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "superseded",
  "systemFailed",
  "executionFailed",
  "guardrailBlocked",
] as const satisfies ReadonlyArray<keyof WorkloadCounts>;

export type DigestCountField = (typeof DIGEST_COUNT_FIELDS)[number];
export type PostDailyDigestRow = { key: WorkloadRowKey; name: string } & Record<DigestCountField, number>;

/** 写进 AuditLog.afterData 的内容 */
export interface PostDailyDigest {
  day: string;
  timezone: string;
  rows: PostDailyDigestRow[];
  truncated: boolean;
  source: "system";
}

/** 组织本地时刻 now 的前一个本地日 */
export function digestDayFor(now: Date, timeZone: string): string {
  return localDayKeys(now, timeZone, 2)[0];
}

/** 取汇总里 day 那一列，只留十个计数；全为 0 的行去掉，所有行都去掉时返回 null（不写） */
export function buildPostDailyDigest(workload: Pick<WorkloadResult, "timezone" | "days" | "rows" | "truncated">, day: string): PostDailyDigest | null {
  const index = workload.days.indexOf(day);
  if (index < 0) throw new Error(`工作量汇总不含本地日 ${day}`);
  const rows = workload.rows.flatMap((row): PostDailyDigestRow[] => {
    const counts = row.daily[index];
    const picked = Object.fromEntries(DIGEST_COUNT_FIELDS.map((f) => [f, counts[f]])) as Record<DigestCountField, number>;
    return DIGEST_COUNT_FIELDS.some((f) => picked[f] > 0) ? [{ key: row.key, name: row.name, ...picked }] : [];
  });
  return rows.length ? { day, timezone: workload.timezone, rows, truncated: workload.truncated, source: "system" } : null;
}

// ── 写入条件（纯函数，测试直接断言） ──────────────────────────

export function postDailyDigestLockKey(orgId: string, day: string): string {
  return `post-daily-digest:${orgId}:${day}`;
}

/** afterData 是 JSON 字符串，day 是第一个键；行里没有 day 字段，不会误中 */
export function postDailyDigestExistingWhere(orgId: string, day: string) {
  return {
    orgId,
    action: POST_DAILY_DIGEST_ACTION,
    targetType: "organization",
    targetId: orgId,
    afterData: { contains: `"day":"${day}"` },
  };
}

// ── 入口 ──────────────────────────────────────────────────────

export interface PostDailyDigestOrg {
  id: string;
  /** AuditLog.userId 必填：挂组织所有者，company.log 来源按动作标 system */
  ownerId: string;
  timezone: string;
}

export type PostDailyDigestStatus = "written" | "exists" | "empty" | "error";

export interface PostDailyDigestResult {
  orgId: string;
  day: string;
  status: PostDailyDigestStatus;
  rows: number;
  error?: string;
}

export interface PostDailyDigestDeps {
  workload(orgId: string, days: number, now: Date): Promise<WorkloadResult>;
  /** 组织 + 本地日串行化后先查后写；已有时返回 false */
  writeIfAbsent(org: PostDailyDigestOrg, digest: PostDailyDigest): Promise<boolean>;
}

/** 单个组织：读汇总 → 取前一天 → 写审计；任何异常都收成 error，不外抛 */
export async function runPostDailyDigest(
  org: PostDailyDigestOrg,
  now: Date,
  deps: PostDailyDigestDeps = defaultPostDailyDigestDeps(),
): Promise<PostDailyDigestResult> {
  const day = digestDayFor(now, org.timezone);
  try {
    const digest = buildPostDailyDigest(await deps.workload(org.id, WORKLOAD_MIN_DAYS, now), day);
    if (!digest) return { orgId: org.id, day, status: "empty", rows: 0 };
    const written = await deps.writeIfAbsent(org, digest);
    return { orgId: org.id, day, status: written ? "written" : "exists", rows: digest.rows.length };
  } catch (e) {
    return { orgId: org.id, day, status: "error", rows: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 多个组织逐个处理；失败数给受跟踪运行判 succeeded / partial */
export async function runPostDailyDigests(
  orgs: readonly PostDailyDigestOrg[],
  now: Date,
  deps: PostDailyDigestDeps = defaultPostDailyDigestDeps(),
) {
  const results: PostDailyDigestResult[] = [];
  for (const org of orgs) results.push(await runPostDailyDigest(org, now, deps));
  const failedCount = results.filter((r) => r.status === "error").length;
  return {
    data: { orgs: results },
    processedCount: results.length,
    succeededCount: results.length - failedCount,
    failedCount,
  };
}

// ── 默认依赖（Prisma） ────────────────────────────────────────

export function defaultPostDailyDigestDeps(): PostDailyDigestDeps {
  return {
    workload: async (orgId, days, now) => {
      const { getOrgWorkload, defaultWorkloadDeps } = await import("./workload-read-model");
      return getOrgWorkload({ orgId }, days, { ...defaultWorkloadDeps(), now: () => now });
    },

    writeIfAbsent: async (org, digest) => {
      const { db } = await import("@/lib/db");
      const { writeAuditLog } = await import("@/lib/audit/logger");
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${postDailyDigestLockKey(org.id, digest.day)}))) AS l`;
        const existing = await tx.auditLog.findFirst({ where: postDailyDigestExistingWhere(org.id, digest.day), select: { id: true } });
        if (existing) return false;
        await writeAuditLog(tx, {
          userId: org.ownerId,
          orgId: org.id,
          action: POST_DAILY_DIGEST_ACTION,
          targetType: "organization",
          targetId: org.id,
          afterData: digest,
        });
        return true;
      });
    },
  };
}
