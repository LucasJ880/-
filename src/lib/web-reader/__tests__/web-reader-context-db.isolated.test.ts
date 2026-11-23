/**
 * TREE-1 读公开网页：读页上下文的 Job 校验与审计落库——真实 DB（隔离库），网络用假的
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/web-reader/__tests__/web-reader-context-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；不连外网、不调模型、不发邮件。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 TREE-1 读页上下文 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "TREE-1 web reader context DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : "");
  }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { seedWorkforceFixture } = await import("@/lib/workforce-runtime/__tests__/helpers");
  const { createWorkforceJob } = await import("@/lib/workforce-runtime/job");
  const { createResearchReadSessionWithDeps, readPublicPage, WebReaderContextError, WEB_READ_AUDIT_ACTION } = await import("../read-page");
  const { loadResearchJobRow, loadOrgSettingsJson, writeWebReadAudit } = await import("../index");

  console.log("TREE-1 读页上下文 — isolated DB");
  const fx = await seedWorkforceFixture("wr");
  const other = await seedWorkforceFixture("wr2");
  const ORG = fx.orgId;
  const USER = fx.ownerUserId;
  const jobIds: string[] = [];
  const env = { TENDER_RESEARCH_TREE_ENABLED: "1", TENDER_RESEARCH_TREE_ORG_ALLOWLIST: `${ORG},${other.orgId}` };

  async function mkJob(orgId: string, userId: string, marker: unknown) {
    const created = await createWorkforceJob({
      orgId, userId, role: "sales", goal: "调研往期同标", channel: "workforce", projectId: null, workDomain: "tender",
    } as Parameters<typeof createWorkforceJob>[0]);
    if (!created.ok) throw new Error(`createWorkforceJob failed: ${JSON.stringify(created)}`);
    jobIds.push(created.jobId);
    if (marker !== undefined) {
      const row = await db.agentRun.findUniqueOrThrow({ where: { id: created.jobId }, select: { metadata: true } });
      const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
      await db.agentRun.update({ where: { id: created.jobId }, data: { metadata: { ...meta, researchTree: marker } as object } });
    }
    return created.jobId;
  }

  const requests: string[] = [];
  const enc = new TextEncoder();
  const reader = {
    net: {
      resolve: async () => [{ address: "93.184.216.34", family: 4 as const }],
      request: async (req: { url: URL }) => {
        requests.push(req.url.toString());
        if (req.url.pathname === "/robots.txt") return { status: 404, headers: {}, body: new Uint8Array(), truncated: false };
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: enc.encode(`<p>SECRET-BODY-TEXT ${"Award notice. ".repeat(200)}</p>`),
          truncated: false,
        };
      },
    },
    clock: { now: () => Date.now(), sleep: async () => undefined },
    audit: writeWebReadAudit,
    extractPdf: async () => [] as string[],
  };
  const deps = { loadJob: loadResearchJobRow, loadOrgSettings: loadOrgSettingsJson, env, reader };

  async function expectError(name: string, orgId: string, jobId: string, code: string) {
    try {
      await createResearchReadSessionWithDeps({ orgId, jobId }, deps);
      ok(false, name, "没有抛错");
    } catch (e) {
      ok(e instanceof WebReaderContextError && e.code === code, name, e instanceof Error ? e.message : e);
    }
  }

  try {
    const analysisJob = await mkJob(ORG, USER, undefined);
    await expectError("一键分析 Job（没有调研标记）被拒", ORG, analysisJob, "NOT_RESEARCH_JOB");
    const noUser = await mkJob(ORG, USER, { version: 1, initiatedByUserId: "", trigger: "human_start" });
    await expectError("缺发起人被拒", ORG, noUser, "NOT_HUMAN_INITIATED");
    const cronJob = await mkJob(ORG, USER, { version: 1, initiatedByUserId: USER, trigger: "scheduled" });
    await expectError("发起方式不是人被拒", ORG, cronJob, "NOT_HUMAN_INITIATED");
    const otherJob = await mkJob(other.orgId, other.ownerUserId, { version: 1, initiatedByUserId: other.ownerUserId, trigger: "human_start" });
    await expectError("别的组织的 Job 被拒", ORG, otherJob, "JOB_ORG_MISMATCH");
    await expectError("不存在的 Job 被拒", ORG, "no_such_job", "JOB_NOT_FOUND");
    ok(requests.length === 0, "以上都没有任何请求");

    await db.organization.update({ where: { id: ORG }, data: { settingsJson: { researchTree: { sites: { deny: ["blocked-by-org.example"] } } } } });
    const research = await mkJob(ORG, USER, { version: 1, initiatedByUserId: USER, trigger: "human_start" });
    const session = await createResearchReadSessionWithDeps({ orgId: ORG, jobId: research }, deps);
    ok(session.initiatedByUserId === USER && session.jobId === research, "调研 Job 建出会话");
    const ctx = session.forBranch({ branchKey: "prior_award", budget: { remaining: 12, used: 0 } });
    const denied = await readPublicPage("https://blocked-by-org.example/x", ctx);
    ok(denied.outcome === "refused" && denied.reason === "site_denied", "组织设置里的「不碰」生效");
    const page = await readPublicPage("https://example.gov/award", ctx);
    ok(page.outcome === "ok" && page.text.includes("SECRET-BODY-TEXT"), "读到正文");
    const audits = await db.auditLog.findMany({ where: { orgId: ORG, action: WEB_READ_AUDIT_ACTION, targetId: research }, select: { userId: true, targetType: true, afterData: true, beforeData: true } });
    ok(audits.length === 1, "写了一条审计（拒绝的不写）", audits);
    const a = audits[0];
    // 审计写入方把 afterData 存成 JSON 字符串
    const rawAfter = a?.afterData ?? {};
    const after = (typeof rawAfter === "string" ? JSON.parse(rawAfter) : rawAfter) as Record<string, unknown>;
    ok(a?.userId === USER && a?.targetType === "research_job", "审计记在发起人名下、指向调研 Job");
    ok(after.url === "https://example.gov/award" && after.httpStatus === 200 && after.chars === page.text.length && typeof after.chars === "number" && after.outcome === "ok" && after.branchKey === "prior_award", "审计含网址、状态、字数", { after, textLength: page.text.length });
    ok(!JSON.stringify(audits).includes("SECRET-BODY-TEXT"), "审计里搜不到正文");
  } finally {
    await db.auditLog.deleteMany({ where: { orgId: { in: [ORG, other.orgId] } } }).catch(() => undefined);
    await db.agentRunEvent.deleteMany({ where: { runId: { in: jobIds } } }).catch(() => undefined);
    await db.agentRunStep.deleteMany({ where: { runId: { in: jobIds } } }).catch(() => undefined);
    await db.agentRun.deleteMany({ where: { id: { in: jobIds } } }).catch(() => undefined);
    for (const f of [fx, other]) {
      await db.agentSession.deleteMany({ where: { orgId: f.orgId } }).catch(() => undefined);
      await db.organizationMember.deleteMany({ where: { orgId: f.orgId } }).catch(() => undefined);
      await db.organization.deleteMany({ where: { id: f.orgId } }).catch(() => undefined);
      await db.user.deleteMany({ where: { id: { in: [f.ownerUserId, f.approverUserId] } } }).catch(() => undefined);
    }
    await db.$disconnect();
  }
  console.log(`\nweb-reader-context-db: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
