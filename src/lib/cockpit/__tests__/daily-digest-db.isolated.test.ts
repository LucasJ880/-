/**
 * A-5 夜间岗位日结——真实 DB（隔离库）+ 真实依赖（A-4 读模型 + 事务内写审计）
 *
 *   组织前一个本地日有投标 / 项目岗位的审批与结局 → 写一条 cockpit.post_daily_digest，计数与内容一致；
 *   同日重跑 → exists，仍一条；两次并发 → 只有一条；无活动的组织 → empty，不写；
 *   只新增这一条审计：没有新的 MemoryClaim、通知、审批。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/cockpit/__tests__/daily-digest-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 岗位日结 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "cockpit post-daily-digest DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

const TZ = "America/Toronto";
/** 多伦多 2026-10-31 00:00（EDT）：日结本地日 2026-10-30 */
const NOW = new Date("2026-10-31T04:00:00Z");
const DAY = "2026-10-30";
const at = (iso: string) => new Date(iso);

async function main() {
  const { db } = await import("@/lib/db");
  const { POST_DAILY_DIGEST_ACTION, runPostDailyDigest } = await import("../daily-digest");

  const stamp = Date.now().toString(36);
  const OWNER = `pdd_owner_${stamp}`;
  const ORG = `pdd_org_${stamp}`;
  const QUIET = `pdd_quiet_${stamp}`;
  const orgIds = [ORG, QUIET];

  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Example Owner", role: "user" } });
  for (const id of orgIds) {
    await db.organization.create({ data: { id, name: `Example ${id}`, code: id, ownerId: OWNER, settingsJson: { timezone: TZ } } });
  }

  const action = (type: string, data: { status: string; createdAt: Date; decidedAt?: Date; failureReason?: string; title: string }) =>
    db.pendingAction.create({
      data: {
        orgId: ORG,
        type,
        title: data.title,
        preview: "Example preview",
        payload: { note: "Example body that must not reach the digest" },
        status: data.status,
        createdById: OWNER,
        decidedById: data.status === "approved" || data.status === "rejected" ? OWNER : null,
        decidedAt: data.decidedAt ?? null,
        failureReason: data.failureReason ?? null,
        expiresAt: new Date(data.createdAt.getTime() + 86_400_000),
        createdAt: data.createdAt,
        updatedAt: data.decidedAt ?? data.createdAt,
      },
    });

  const counts = async () => ({
    audits: await db.auditLog.count({ where: { orgId: { in: orgIds } } }),
    digests: await db.auditLog.count({ where: { orgId: { in: orgIds }, action: POST_DAILY_DIGEST_ACTION } }),
    memory: await db.memoryClaim.count({ where: { orgId: { in: orgIds } } }),
    notifications: await db.notification.count({ where: { userId: OWNER } }),
    pending: await db.pendingAction.count({ where: { orgId: { in: orgIds } } }),
  });

  try {
    // 2026-10-30（多伦多）：投标起草 2（1 批准、1 驳回）、项目起草 1（过期）；10-29 起草的投标在 10-30 批准；10-31 00:30 的不算前一天
    await action("tender.send_rfq", { title: "T1", status: "approved", createdAt: at("2026-10-30T14:00:00Z"), decidedAt: at("2026-10-30T15:00:00Z") });
    await action("tender.send_chase", { title: "T2", status: "rejected", createdAt: at("2026-10-30T16:00:00Z"), decidedAt: at("2026-10-30T18:00:00Z") });
    await action("orders.cancel_blinds_order", { title: "P1", status: "failed", failureReason: "已过期", createdAt: at("2026-10-30T13:00:00Z"), decidedAt: at("2026-10-30T20:00:00Z") });
    await action("tender.send_rfq", { title: "T0", status: "approved", createdAt: at("2026-10-29T20:00:00Z"), decidedAt: at("2026-10-30T12:00:00Z") });
    await action("tender.send_rfq", { title: "T3", status: "pending", createdAt: at("2026-10-31T04:30:00Z") });

    const before = await counts();
    const org = { id: ORG, ownerId: OWNER, timezone: TZ };

    console.log("写入");
    const r1 = await runPostDailyDigest(org, NOW);
    ok(r1.status === "written" && r1.day === DAY && r1.rows === 2, "有活动 → written，本地日 2026-10-30，两行", r1);
    const logs = await db.auditLog.findMany({ where: { orgId: ORG, action: POST_DAILY_DIGEST_ACTION } });
    ok(logs.length === 1, "只有一条日结审计", logs.length);
    const log = logs[0];
    ok(log?.userId === OWNER && log.targetType === "organization" && log.targetId === ORG && log.beforeData === null, "操作人为所有者，目标为组织", log);
    const after = JSON.parse(log?.afterData ?? "{}") as {
      day: string;
      timezone: string;
      truncated: boolean;
      source: string;
      rows: Array<Record<string, number | string>>;
    };
    ok(after.day === DAY && after.timezone === TZ && after.truncated === false && after.source === "system", "afterData：本地日、时区、未截断、来源 system", after);
    const tender = after.rows?.find((r) => r.key === "tender");
    const projects = after.rows?.find((r) => r.key === "projects");
    ok(after.rows?.map((r) => r.key).join(",") === "tender,projects", "只有投标与项目两行（全 0 的岗位不写）", after.rows);
    ok(tender?.proposed === 2 && tender.approved === 2 && tender.rejected === 1 && tender.expired === 0, "投标：起草 2（10-31 的不算）、批准 2（含 10-29 起草当天批准的）、驳回 1", tender);
    ok(projects?.proposed === 1 && projects.expired === 1 && projects.approved === 0, "项目：起草 1、过期 1", projects);
    ok(!/Example|T1|T2|P1|preview|body|cost|Tokens|automationRuns/.test(log?.afterData ?? ""), "内容不含标题 / 正文 / 成本 / token / 平台自动化运行", log?.afterData);

    console.log("幂等");
    const r2 = await runPostDailyDigest(org, NOW);
    ok(r2.status === "exists", "同日重跑 → exists", r2);
    const r3 = await runPostDailyDigest(org, new Date("2026-10-31T04:45:00Z"));
    ok(r3.status === "exists" && r3.day === DAY, "同一本地 0 点的晚些时刻 → 仍是 2026-10-30、exists", r3);
    await db.auditLog.deleteMany({ where: { orgId: ORG, action: POST_DAILY_DIGEST_ACTION } });
    const both = await Promise.all([runPostDailyDigest(org, NOW), runPostDailyDigest(org, NOW)]);
    ok(
      both.map((r) => r.status).sort().join(",") === "exists,written" && (await db.auditLog.count({ where: { orgId: ORG, action: POST_DAILY_DIGEST_ACTION } })) === 1,
      "两次并发 → 一条 written、一条 exists，库里只有一条",
      both,
    );

    console.log("空日");
    const q = await runPostDailyDigest({ id: QUIET, ownerId: OWNER, timezone: TZ }, NOW);
    ok(q.status === "empty" && q.rows === 0, "无活动组织 → empty", q);

    console.log("没有其它写入");
    const afterCounts = await counts();
    ok(
      afterCounts.digests === 1 &&
        afterCounts.audits === before.audits + 1 &&
        afterCounts.memory === before.memory &&
        afterCounts.notifications === before.notifications &&
        afterCounts.pending === before.pending,
      "只多一条日结审计；MemoryClaim、通知、审批数不变",
      { before, afterCounts },
    );
  } finally {
    await db.auditLog.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.pendingAction.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: OWNER } });
    await db.$disconnect();
  }

  console.log(`\n组织驾驶舱岗位日结（隔离库）: ${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
