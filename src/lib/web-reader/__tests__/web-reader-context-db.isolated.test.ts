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

const ALLOW_ALL = (): boolean => true;

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
  const { loadResearchJobRow, loadOrgSettingsJson, loadTreeHistory, writeWebReadAudit } = await import("../db-deps");

  console.log("TREE-1 读页上下文 — isolated DB");
  const fx = await seedWorkforceFixture("wr");
  const other = await seedWorkforceFixture("wr2");
  const ORG = fx.orgId;
  const USER = fx.ownerUserId;
  const jobIds: string[] = [];
  const env = { TENDER_RESEARCH_TREE_ENABLED: "1", TENDER_RESEARCH_TREE_ORG_ALLOWLIST: `${ORG},${other.orgId}` };

  /** 标记照 TREE-2 的写法经 createWorkforceJob 的 extraMetadata 写入（只收原始值）；patch 用来模拟坏数据 */
  async function mkJob(orgId: string, userId: string, extra: Record<string, unknown> | undefined, patch?: Record<string, unknown>) {
    const created = await createWorkforceJob({
      orgId, userId, role: "sales", goal: "调研往期同标", channel: "workforce", projectId: null, workDomain: "tender",
      ...(extra ? { extraMetadata: extra } : {}),
    } as Parameters<typeof createWorkforceJob>[0]);
    if (!created.ok) throw new Error(`createWorkforceJob failed: ${JSON.stringify(created)}`);
    jobIds.push(created.jobId);
    if (patch) {
      const row = await db.agentRun.findUniqueOrThrow({ where: { id: created.jobId }, select: { metadata: true } });
      const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
      await db.agentRun.update({ where: { id: created.jobId }, data: { metadata: { ...meta, ...patch } as object } });
    }
    return created.jobId;
  }
  const MARK = { researchTree: true, researchTreeVersion: 1, researchTrigger: "human_start" };

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
  };
  const deps = { loadJob: loadResearchJobRow, loadOrgSettings: loadOrgSettingsJson, loadTreeHistory, env, reader };

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
    const noUser = await mkJob(ORG, USER, MARK, { initiatedByUserId: "" });
    await expectError("缺发起人被拒", ORG, noUser, "NOT_HUMAN_INITIATED");
    const cronJob = await mkJob(ORG, USER, { ...MARK, researchTrigger: "scheduled" });
    await expectError("发起方式不是人被拒", ORG, cronJob, "NOT_HUMAN_INITIATED");
    const doneJob = await mkJob(ORG, USER, MARK);
    await db.agentRun.update({ where: { id: doneJob }, data: { status: "completed" } });
    await expectError("已结束的调研 Job 被拒", ORG, doneJob, "JOB_FINISHED");
    const otherJob = await mkJob(other.orgId, other.ownerUserId, MARK);
    await expectError("别的组织的 Job 被拒", ORG, otherJob, "JOB_ORG_MISMATCH");
    await expectError("不存在的 Job 被拒", ORG, "no_such_job", "JOB_NOT_FOUND");
    ok(requests.length === 0, "以上都没有任何请求");

    await db.organization.update({ where: { id: ORG }, data: { settingsJson: { researchTree: { sites: { deny: ["blocked-by-org.example"] } } } } });
    const research = await mkJob(ORG, USER, MARK);
    const session = await createResearchReadSessionWithDeps({ orgId: ORG, jobId: research }, deps);
    ok(session.initiatedByUserId === USER && session.jobId === research, "经 extraMetadata 写标记的调研 Job 建出会话；发起人取运行时写的 initiatedByUserId");
    const ctx = session.forBranch({ allowUrl: ALLOW_ALL, branchKey: "prior_award", budget: { remaining: 12, used: 0 } });
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
    ok(Object.keys(after).sort().join(",") === "attempts,blockedSite,branchKey,chars,finalUrl,fromCache,httpStatus,outcome,reason,robotsFetches,robotsRequests,site,truncated,url", "审计 afterData 的键固定", Object.keys(after));

    // 重建会话：已用额度与被挡站从审计历史恢复（同一 Job、同一支）
    const forbid = "https://forbid.example/p";
    const reader403 = { ...reader, net: { ...reader.net, request: async (req: { url: URL }) => {
      requests.push(req.url.toString());
      if (req.url.pathname === "/robots.txt") return { status: 404, headers: {}, body: new Uint8Array(), truncated: false };
      if (req.url.hostname === "forbid.example") return { status: 403, headers: { "content-type": "text/html" }, body: new Uint8Array(), truncated: false };
      return { status: 200, headers: { "content-type": "text/html" }, body: enc.encode(`<p>${"Award notice. ".repeat(200)}</p>`), truncated: false };
    } } };
    // 每次重建都换一个新的时钟对象 = 新进程的账本：只能靠库里的审计历史恢复
    const freshDeps = () => ({ ...deps, reader: { ...reader403, clock: { now: () => Date.now(), sleep: async () => undefined } } });
    const s2 = await createResearchReadSessionWithDeps({ orgId: ORG, jobId: research }, freshDeps());
    const c2 = s2.forBranch({ branchKey: "prior_award", budget: { remaining: 12, used: 0 }, allowUrl: ALLOW_ALL });
    ok(c2.budget.used === 1 && c2.budget.remaining === 11, "重建会话：上一次发过请求的读页计入已用", c2.budget);
    const blockedRead = await readPublicPage(forbid, c2);
    ok(blockedRead.reason === "http_403" && blockedRead.blocked?.site === "forbid.example", "这次读到 403");
    const s3 = await createResearchReadSessionWithDeps({ orgId: ORG, jobId: research }, freshDeps());
    const c3 = s3.forBranch({ branchKey: "prior_award", budget: { remaining: 12, used: 0 }, allowUrl: ALLOW_ALL });
    const before = requests.length;
    const again = await readPublicPage("https://forbid.example/other", c3);
    ok(again.reason === "site_blocked_in_branch" && requests.length === before && c3.budget.used === 2, "再重建：被挡站从审计恢复、不再发请求；已用 2", { again: again.reason, budget: c3.budget });

    // 第三轮挑错后补：缓存被挡也写审计、取 robots 次数从审计恢复、历史行数超限
    const cacheMarkJob = await mkJob(ORG, USER, MARK);
    const sm = await createResearchReadSessionWithDeps({ orgId: ORG, jobId: cacheMarkJob }, freshDeps());
    const cA = sm.forBranch({ branchKey: "A", budget: { remaining: 12, used: 0 }, allowUrl: ALLOW_ALL });
    const cB = sm.forBranch({ branchKey: "B", budget: { remaining: 12, used: 0 }, allowUrl: ALLOW_ALL });
    await readPublicPage(forbid, cA);
    const viaCache = await readPublicPage(forbid, cB);
    const markRows = await db.auditLog.findMany({ where: { orgId: ORG, action: WEB_READ_AUDIT_ACTION, targetId: cacheMarkJob } });
    const marks = markRows.map((r) => JSON.parse(String(r.afterData)) as Record<string, unknown>).filter((d) => d.branchKey === "B");
    ok(viaCache.fromCache && marks.length === 1 && marks[0].fromCache === true && marks[0].attempts === 0 && marks[0].blockedSite === "forbid.example", "B 从缓存拿到被挡：库里有一条不含请求的审计", marks);
    const sm2 = await createResearchReadSessionWithDeps({ orgId: ORG, jobId: cacheMarkJob }, freshDeps());
    const cB2 = sm2.forBranch({ branchKey: "B", budget: { remaining: 12, used: 0 }, allowUrl: ALLOW_ALL });
    const before2 = requests.length;
    const rB = await readPublicPage("https://forbid.example/third", cB2);
    ok(rB.reason === "site_blocked_in_branch" && requests.length === before2 && cB2.budget.used === 0, "重建后 B 仍记得被挡站、不发请求、没扣额度", { r: rB.reason, b: cB2.budget });

    const robotsJob = await mkJob(ORG, USER, MARK);
    for (let i = 0; i < 2; i++) {
      await writeWebReadAudit({ orgId: ORG, userId: USER, jobId: robotsJob, branchKey: "R", url: `https://r${i}.example/p`, finalUrl: null, outcome: "blocked", httpStatus: null, chars: 0, truncated: false, reason: "robots_disallow", attempts: 0, robotsRequests: 1, robotsFetches: 6, site: `r${i}.example`, blockedSite: `r${i}.example`, fromCache: false });
    }
    const sr = await createResearchReadSessionWithDeps({ orgId: ORG, jobId: robotsJob }, freshDeps());
    const cR = sr.forBranch({ branchKey: "R", budget: { remaining: 12, used: 0 }, allowUrl: ALLOW_ALL });
    const before3 = requests.length;
    const rR = await readPublicPage("https://fresh-robots.example/p", cR);
    ok(rR.reason === "robots_limit" && requests.length === before3, "库里这一支已取过 12 次 robots：重建后到上限、不发请求", rR.reason);

    const bigJob = await mkJob(ORG, USER, MARK);
    const noise = Array.from({ length: 1500 }, (_, i) => ({ userId: USER, orgId: ORG, action: WEB_READ_AUDIT_ACTION, targetType: "research_job", targetId: bigJob, afterData: JSON.stringify({ branchKey: `n${i % 20}`, attempts: 0, robotsFetches: 0, blockedSite: null }) }));
    await db.auditLog.createMany({ data: noise });
    for (let i = 0; i < 12; i++) {
      await writeWebReadAudit({ orgId: ORG, userId: USER, jobId: bigJob, branchKey: "victim", url: `https://v.example/${i}`, finalUrl: `https://v.example/${i}`, outcome: "ok", httpStatus: 200, chars: 10, truncated: false, reason: null, attempts: 1, robotsRequests: 0, robotsFetches: 0, site: "v.example", blockedSite: null, fromCache: false });
    }
    const sb = await createResearchReadSessionWithDeps({ orgId: ORG, jobId: bigJob }, freshDeps());
    const cv = sb.forBranch({ branchKey: "victim", budget: { remaining: 12, used: 0 }, allowUrl: ALLOW_ALL });
    ok(cv.budget.used === 12 && cv.budget.remaining === 0, "1500 行别支的历史在前：后写的 12 次读页照样恢复（不丢新行）", cv.budget);
    await db.auditLog.createMany({ data: noise.slice(0, 500) });
    const sb2 = await createResearchReadSessionWithDeps({ orgId: ORG, jobId: bigJob }, freshDeps());
    const cn = sb2.forBranch({ branchKey: "brand-new", budget: { remaining: 12, used: 0 }, allowUrl: ALLOW_ALL });
    const before4 = requests.length;
    const rn = await readPublicPage("https://v.example/new", cn);
    ok(rn.outcome === "limit" && cn.budget.remaining === 0 && requests.length === before4, "历史超过 2000 行：这棵树不再读页（不按部分历史放行）", { r: rn.reason, b: cn.budget });
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
