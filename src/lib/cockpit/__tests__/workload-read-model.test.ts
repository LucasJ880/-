/**
 * A-4 工作量读模型与接口（openspec change org-cockpit-workload，spec cockpit/workload）
 * 运行：npx tsx src/lib/cockpit/__tests__/workload-read-model.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthUser } from "@/lib/auth";
import { isOnboardingTestInquiry, utmSourceOf, TRADE_SHOW_SOURCE } from "@/lib/revenue-spine/sla-metrics";
import { POST_REGISTRY, type PostKey } from "../posts";
import {
  COCKPIT_FORBIDDEN_BODY,
  agentRunTypeCountWhere,
  assemblePostsCockpit,
  resolveCockpitViewer,
  workforceDomainCountWhere,
  type CockpitViewer,
  type PostKpiView,
} from "../posts-read-model";
import { buildWaitingForYou } from "../waiting";
import { parseWorkloadDays, TRADE_SHOW_ROW, type WorkloadAgentRunRow } from "../workload";
import {
  WORKLOAD_FDE_EMPLOYEE_KEY,
  WORKLOAD_FOLLOW_UP_GUARDRAIL_ACTION,
  WORKLOAD_INQUIRY_ACTION_TYPE,
  WORKLOAD_INQUIRY_REPLY_TYPE,
  WORKLOAD_ROW_LIMIT,
  automationRunRangeWhere,
  followUpGuardrailWhere,
  getOrgWorkload,
  capped,
  inquiryFlagsOf,
  inquiryLinkWhere,
  mergeAgentRunRows,
  opportunityIdOfPayload,
  toInquiryRow,
  workloadInquiryWhere,
  workloadPendingActionWhere,
  workloadUsageWhere,
  type InquiryClassifier,
  type InquirySource,
  type WorkloadDeps,
  type WorkloadPendingSource,
} from "../workload-read-model";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 500)}`}`);
  }
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const NOW = new Date("2026-10-26T16:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const user = { id: "u1", email: "boss@example.com", name: "Boss", nickname: null, avatar: null, role: "user", status: "active", canEditCustomers: true } as AuthUser;
const viewer: CockpitViewer = { user, orgId: "org-1", orgRole: "org_admin" };
const sla: InquiryClassifier = { isOnboardingTestInquiry, utmSourceOf, tradeShowSource: TRADE_SHOW_SOURCE };

function fakeDeps(o: Partial<WorkloadDeps> = {}): WorkloadDeps {
  return {
    now: () => NOW,
    orgSettings: async () => ({ timezone: "America/Toronto" }),
    agentRuns: async () => ({ rows: [], truncated: false }),
    automationCounts: async () => [],
    pendingActions: async () => ({ rows: [], truncated: false }),
    pendingPayloads: async () => new Map(),
    projectWorkDomains: async () => new Map(),
    agentRunTypes: async () => new Map(),
    inquiryLinks: async () => new Map(),
    inquiries: async () => ({ rows: [], truncated: false }),
    followUpGuardrailBlocks: async () => ({ rows: [], truncated: false }),
    opportunityInquiries: async () => new Map(),
    usage: async () => ({ rows: [], truncated: false }),
    usageRuns: async () => new Map(),
    inquiryClassifier: async () => sla,
    ...o,
  };
}

function pending(id: string, o: Partial<WorkloadPendingSource> = {}): WorkloadPendingSource {
  return {
    id,
    type: WORKLOAD_INQUIRY_REPLY_TYPE,
    projectId: null,
    agentRunId: null,
    status: "pending",
    failureReason: null,
    decidedById: null,
    createdAt: hoursAgo(10),
    decidedAt: null,
    executedAt: null,
    updatedAt: hoursAgo(10),
    ...o,
  };
}

const inquiry = (o: Partial<InquirySource> = {}): InquirySource => ({
  opportunityId: "opp-1",
  createdAt: hoursAgo(12),
  inputContext: {},
  opportunity: { orgId: "org-1", source: "website", lostReason: null, customer: { tags: null } },
  ...o,
});
const opp = (o: Partial<NonNullable<InquirySource["opportunity"]>> = {}): NonNullable<InquirySource["opportunity"]> => ({
  orgId: "org-1",
  source: "website",
  lostReason: null,
  customer: null,
  ...o,
});

async function main() {
  console.log("参数");
  ok(parseWorkloadDays(null).ok && (parseWorkloadDays(null) as { days: number }).days === 14, "days 缺省 14（spec 场景）");
  ok(["7", "30"].every((v) => parseWorkloadDays(v).ok) && ["6", "31", "abc", "14.5"].every((v) => !parseWorkloadDays(v).ok), "7 / 30 接受；6 / 31 / abc / 14.5 非法（spec 场景）");

  console.log("访问规则（与岗位总览同一套）");
  {
    const denied = await resolveCockpitViewer(user, {
      resolveOrg: async () => ({ ok: true, orgId: "org-1" }),
      activeOrgRole: async () => "member",
      isManagement: () => false,
    });
    ok(!denied.ok && denied.status === 403 && JSON.stringify(denied.body) === JSON.stringify(COCKPIT_FORBIDDEN_BODY), "非管理层 → 403，响应体与岗位总览相同（spec 场景）");
  }

  console.log("询盘判定复用 SLA 指标");
  ok(toInquiryRow(inquiry({ inputContext: { meta: { utm: { source: "qingyan_onboarding_test" } } } }), sla, "org-1")?.testInquiry === true, "UTM 来源为入驻测试 → 测试询盘（spec 场景）");
  ok(toInquiryRow(inquiry({ opportunity: opp({ customer: { tags: "vip,qingyan_onboarding_test" } }) }), sla, "org-1")?.testInquiry === true, "客户标签含入驻测试 → 测试询盘");
  ok(toInquiryRow(inquiry({ opportunity: opp({ lostReason: "onboarding test" }) }), sla, "org-1")?.testInquiry === true, "丢单原因为入驻测试 → 测试询盘");
  ok(toInquiryRow(inquiry({ opportunity: opp({ source: "trade_show" }) }), sla, "org-1")?.tradeShow === true, "商机来源 trade_show → 展会（spec 场景）");
  ok(inquiryFlagsOf(inquiry({ opportunity: opp({ source: null }), inputContext: { source: "trade_show" } }), sla).tradeShow === true, "商机来源缺失时取 inputContext.source");
  ok(toInquiryRow(inquiry({ inputContext: { guardrailBlockedAt: "2026-10-25T10:00:00Z" } }), sla, "org-1")?.guardrailBlocked === true && toInquiryRow(inquiry(), sla, "org-1")?.guardrailBlocked === false, "护栏标记取 inputContext.guardrailBlockedAt");
  ok(toInquiryRow(inquiry({ opportunityId: null }), sla, "org-1") === null && toInquiryRow(inquiry({ opportunity: null }), sla, "org-1") === null, "无商机的询盘不计（与 SLA 指标同条件）");
  ok(toInquiryRow(inquiry({ opportunity: opp({ orgId: "org-2" }) }), sla, "org-1") === null, "商机不属于本组织的询盘不计（与 SLA 指标同条件）");
  ok(opportunityIdOfPayload({ opportunityId: "o1" }) === "o1" && opportunityIdOfPayload({ metadata: { opportunityId: "o2" } }) === "o2" && opportunityIdOfPayload({}) === null && opportunityIdOfPayload(null) === null, "回复动作载荷里的商机 id");

  console.log("装配");
  {
    const calls: string[] = [];
    const res = await getOrgWorkload(
      viewer,
      14,
      fakeDeps({
        orgSettings: async () => ({ timezone: "Asia/Shanghai", cockpit: { workloadThresholds: { minDecisions: 2 } } }),
        agentRuns: async (orgId, since, runTypes, workDomains, limit) => {
          calls.push(`agentRuns:${orgId}:${runTypes.join(",")}:${workDomains.join(",")}:${limit}`);
          return { rows: [{ at: hoursAgo(1), runType: "fde_inbound_sales", workDomain: null }], truncated: false };
        },
        automationCounts: async (_keys, from, to) => {
          calls.push(`automation:${to ? "day" : "last7"}`);
          return to ? [] : [{ automationKey: "tender-watch", count: 42 }];
        },
        pendingActions: async () => ({
          rows: [
            pending("pa-1", { status: "rejected", decidedById: "u", decidedAt: hoursAgo(2) }),
            pending("pa-2", { status: "rejected", decidedById: "u", decidedAt: hoursAgo(3) }),
            pending("pa-3"),
            pending("pa-4", { type: "grader.email_draft" }),
            pending("pa-5", { type: "grader.project_task", projectId: "p-9" }),
          ],
          truncated: false,
        }),
        pendingPayloads: async (_orgId, ids) => {
          calls.push(`payloads:${ids.join(",")}`);
          return new Map([["pa-4", { targetType: "CUSTOMER", targetId: "c1", body: "buyer@acme.com 报价 $12,345" }]]);
        },
        projectWorkDomains: async (_orgId, ids) => {
          calls.push(`projects:${ids.join(",")}`);
          return new Map([["p-9", "tender"]]);
        },
        inquiryLinks: async (_orgId, ids) => {
          calls.push(`links:${ids.join(",")}`);
          return new Map([["pa-3", inquiry({ opportunity: opp({ source: "trade_show" }), inputContext: { email: "buyer@acme.com", quote: 12345 } })]]);
        },
      }),
    );
    const row = (key: string) => res.rows.find((r) => r.key === key)!;
    ok(res.orgId === "org-1" && res.generatedAt === NOW.toISOString() && res.timezone === "Asia/Shanghai" && res.days.length === 14, "响应带组织、生成时间、组织时区与本地日");
    ok(res.thresholds.minDecisions === 2 && res.thresholds.rejectRate === 0.5, "阈值取组织设置覆盖后的生效值");
    ok(calls.includes(`agentRuns:org-1:fde_inbound_sales,runtime_v2:sales,tender,delivery,general:${WORKLOAD_ROW_LIMIT}`), "AI 运行按注册表的运行类型与工作域读取，带上限", calls);
    ok(calls.filter((c) => c === "automation:day").length === 14 && calls.includes("automation:last7"), "平台自动化：每个本地日一次 + 近 7 天一次");
    ok(calls.includes("payloads:pa-1,pa-2,pa-4"), "只为无项目的通用动作、以及没有询盘关联的回复动作（跟进草稿）取载荷；已关联与有项目的不读", calls);
    ok(calls.includes("projects:p-9") && calls.includes("links:pa-1,pa-2,pa-3"), "项目工作域与询盘关联按需批量取");
    ok(row("inbound_sales").last7.rejected === 2 && row("inbound_sales").signals.some((s) => s.code === "high_reject_rate"), "驳回 2/2 在最小决策数 2 下命中驳回率");
    ok(row(TRADE_SHOW_ROW).last7.proposed === 1, "关联展会询盘的回复动作计入展会行");
    ok(row("inbound_sales").last7.proposed === 3 && row("tender").last7.proposed === 1, "通用动作按项目工作域归属；客户目标归询盘销售（2 条询盘回复 + 1 条客户目标）");
    ok(row("tender").last7.automationRuns === 42 && row("inbound_sales").last7.agentRuns === 1, "平台自动化与 AI 运行进入对应行");
    const json = JSON.stringify(res);
    ok(!json.includes("buyer@acme.com") && !json.includes("12,345") && !json.includes("12345"), "响应不含夹具载荷 / 询盘上下文里的邮箱与金额（spec 场景）");
    ok(!/failureReason|payload|title/.test(json), "响应不含失败原因、载荷、标题字段");
  }

  console.log("跟进草稿与跟进护栏按商机判定（测试排除、展会单列）");
  {
    const res = await getOrgWorkload(
      viewer,
      14,
      fakeDeps({
        pendingActions: async () => ({
          rows: [pending("f-trade"), pending("f-test"), pending("f-plain"), pending("f-noopp")],
          truncated: false,
        }),
        pendingPayloads: async () =>
          new Map<string, unknown>([
            ["f-trade", { opportunityId: "o-trade", body: "Hi" }],
            ["f-test", { metadata: { opportunityId: "o-test" } }],
            ["f-plain", { opportunityId: "o-plain" }],
            ["f-noopp", {}],
          ]),
        followUpGuardrailBlocks: async () => ({
          rows: [
            { at: hoursAgo(5), opportunityId: "o-trade" },
            { at: hoursAgo(6), opportunityId: "o-test" },
            { at: hoursAgo(7), opportunityId: "o-plain" },
            { at: hoursAgo(8), opportunityId: null },
          ],
          truncated: false,
        }),
        opportunityInquiries: async (_orgId, ids) =>
          new Map(
            ids.map((id) => [
              id,
              inquiry({
                opportunityId: id,
                opportunity: opp({ source: id === "o-trade" ? "trade_show" : "website" }),
                inputContext: id === "o-test" ? { meta: { utm: { source: "qingyan_onboarding_test" } } } : {},
              }),
            ]),
          ),
      }),
    );
    const row = (key: string) => res.rows.find((r) => r.key === key)!.last7;
    ok(row(TRADE_SHOW_ROW).proposed === 1 && row("inbound_sales").proposed === 2, "跟进草稿：展会商机计入展会行；测试询盘商机不计；查不到商机的计入询盘销售（spec 场景）", { trade: row(TRADE_SHOW_ROW), sales: row("inbound_sales") });
    ok(row(TRADE_SHOW_ROW).guardrailBlocked === 1 && row("inbound_sales").guardrailBlocked === 2, "跟进护栏审计：同样按商机排除测试、展会单列");
  }

  console.log("行数上限的判定");
  {
    ok(capped([1, 2, 3], 3).truncated && !capped([1, 2], 3).truncated, "读满上限即触顶");
    const t = { createdAt: NOW, runType: "fde_inbound_sales" };
    const merged = mergeAgentRunRows([t, t], [[{ createdAt: NOW }], [{ createdAt: NOW }, { createdAt: NOW }]], ["sales", "tender"], 2);
    ok(merged.rows.length === 5 && merged.truncated && merged.rows.filter((r) => r.workDomain === "tender").length === 2, "AI 运行：任一组读满即触顶，工作域按查询标注");
    ok(!mergeAgentRunRows([t], [[{ createdAt: NOW }]], ["sales"], 2).truncated, "都未读满 → 不触顶");
  }

  console.log("数据量上限");
  {
    const many = Array.from({ length: WORKLOAD_ROW_LIMIT }, (_, i) => pending(`p${i}`, { type: "tender.send_rfq" }));
    const res = await getOrgWorkload(viewer, 14, fakeDeps({ pendingActions: async () => ({ rows: many, truncated: many.length >= WORKLOAD_ROW_LIMIT }) }));
    ok(res.truncated === true, "待审批读满上限 → truncated（spec 场景）");
    ok((await getOrgWorkload(viewer, 14, fakeDeps())).truncated === false, "未触顶 → false");
  }

  console.log("近 7 天 AI 运行与岗位卡片同口径");
  {
    // 一批运行：两个组织、各种类型 / 工作域 / 时间
    type FakeRun = { orgId: string; runType: string; createdAt: Date; metadata: Record<string, unknown> | null };
    const runs: FakeRun[] = [];
    const domains = ["sales", "tender", "delivery", "general", "unknown", null];
    const types = ["fde_inbound_sales", "runtime_v2", "workforce_job", "conversation", "assistant_dispatch"];
    let k = 0;
    for (let h = 1; h < 24 * 14; h += 7) {
      for (const runType of types) {
        k++;
        const d = domains[k % domains.length];
        runs.push({ orgId: k % 5 === 0 ? "org-2" : "org-1", runType, createdAt: hoursAgo(h), metadata: runType === "workforce_job" && d ? { workDomain: d } : null });
      }
    }
    // Prisma where 的最小求值器：只支持这两个条件函数用到的形状
    const matches = (where: Record<string, unknown>, run: FakeRun) => {
      if (where.orgId !== run.orgId) return false;
      const createdAt = where.createdAt as { gte: Date };
      if (run.createdAt < createdAt.gte) return false;
      const rt = where.runType as string | { in: string[] };
      if (typeof rt === "string" ? rt !== run.runType : !rt.in.includes(run.runType)) return false;
      const meta = where.metadata as { path: string[]; equals: string } | undefined;
      if (meta && run.metadata?.[meta.path[0]] !== meta.equals) return false;
      return true;
    };
    // A-4：默认依赖同一形状（同一组条件函数）
    const agentRuns: WorkloadDeps["agentRuns"] = async (orgId, since, runTypes, workDomains) => {
      const typed = runs.filter((r) => matches(agentRunTypeCountWhere(orgId, since, runTypes), r));
      const rows: WorkloadAgentRunRow[] = [
        ...typed.map((r) => ({ at: r.createdAt, runType: r.runType, workDomain: null })),
        ...workDomains.flatMap((d) => runs.filter((r) => matches(workforceDomainCountWhere(orgId, since, d), r)).map((r) => ({ at: r.createdAt, runType: "workforce_job", workDomain: d }))),
      ];
      return { rows, truncated: false };
    };
    const workload = await getOrgWorkload(viewer, 14, fakeDeps({ agentRuns }));
    // A-2：岗位总览用同一批运行、同样的 7 天窗口
    const since = new Date(NOW.getTime() - 7 * 86_400_000);
    const runTypes = [...new Set(POST_REGISTRY.flatMap((p) => p.agentRunTypes as readonly string[]))];
    const workDomains = [...new Set(POST_REGISTRY.flatMap((p) => p.workDomains as readonly string[]))];
    const byRunType = new Map(runTypes.map((t) => [t, runs.filter((r) => matches(agentRunTypeCountWhere("org-1", since, [t]), r)).length]));
    const byWorkDomain = new Map(workDomains.map((d) => [d, runs.filter((r) => matches(workforceDomainCountWhere("org-1", since, d), r)).length]));
    const cockpit = assemblePostsCockpit({
      orgId: "org-1",
      now: NOW,
      timezone: "America/Toronto",
      env: {},
      latestRuns: new Map(),
      runCounts: new Map(),
      agentRunCounts: { byRunType, byWorkDomain },
      quotaHit: false,
      waiting: buildWaitingForYou({ pendingMine: [], pendingMineTotal: 0, pendingMineTruncated: false, jobs: [], jobsTruncated: false, lookups: { pendingActions: new Map(), projectWorkDomains: new Map(), agentRunTypes: new Map() } }),
      kpis: Object.fromEntries(POST_REGISTRY.map((p) => [p.key, { status: "unavailable", reason: "" } satisfies PostKpiView])) as Record<PostKey, PostKpiView>,
    });
    const diffs = cockpit.posts
      .map((p) => ({ post: p.key, card: p.actions7d.agentRuns, workload: workload.rows.find((r) => r.key === p.key)!.last7.agentRuns }))
      .filter((d) => d.card !== d.workload);
    ok(diffs.length === 0 && cockpit.posts.some((p) => p.actions7d.agentRuns > 0), "每个岗位：工作量近 7 天 AI 运行 = 岗位卡片 7 天 AI 次数（spec 场景）", diffs);
    ok(workload.rows.find((r) => r.key === "unattributed")!.last7.agentRuns === 0, "对话等不归岗位的运行不读（与卡片一致）");
  }

  console.log("查询条件");
  {
    const since = hoursAgo(24);
    ok(JSON.stringify(automationRunRangeWhere(["a"], since, null)) === JSON.stringify({ automationKey: { in: ["a"] }, startedAt: { gte: since } }), "自动化：不设上界");
    ok(JSON.stringify(automationRunRangeWhere(["a"], since, NOW)) === JSON.stringify({ automationKey: { in: ["a"] }, startedAt: { gte: since, lt: NOW } }), "自动化：本地日 [起点, 下一日起点)");
    ok(JSON.stringify(workloadPendingActionWhere("o", since)) === JSON.stringify({ orgId: "o", updatedAt: { gte: since } }), "待审批：按组织 + 最后更新时间");
    const inq = workloadInquiryWhere("o", since, NOW);
    ok(inq.employeeKey === WORKLOAD_FDE_EMPLOYEE_KEY && inq.actionType === WORKLOAD_INQUIRY_ACTION_TYPE && JSON.stringify(inq.opportunityId) === '{"not":null}', "询盘：与 SLA 指标同一组条件");
    ok(inquiryLinkWhere("o", ["x"]).employeeKey === WORKLOAD_FDE_EMPLOYEE_KEY && JSON.stringify(inquiryLinkWhere("o", ["x"]).pendingActionId) === '{"in":["x"]}', "询盘关联：只认 FDE 询盘");
    ok(followUpGuardrailWhere("o", since).action === WORKLOAD_FOLLOW_UP_GUARDRAIL_ACTION && workloadUsageWhere("o", since).orgId === "o", "跟进护栏与用量按组织");
  }

  console.log("常量与写入方 / SLA 指标一致（防漂移）");
  ok(read("src/lib/revenue-spine/fde/actions.ts").includes(`FDE_EMPLOYEE_KEY = "${WORKLOAD_FDE_EMPLOYEE_KEY}"`), "FDE 员工键");
  ok(read("src/lib/revenue-spine/sla-metrics.ts").includes(`INBOUND_INQUIRY_ACTION_TYPE = "${WORKLOAD_INQUIRY_ACTION_TYPE}"`), "询盘动作类型");
  ok(read("src/lib/revenue-spine/fde/inbound-sales.ts").includes(`INQUIRY_REPLY_ACTION_TYPE = "${WORKLOAD_INQUIRY_REPLY_TYPE}"`), "询盘回复动作类型");
  ok(read("src/lib/revenue-spine/fde/no-reply-followup.ts").includes(`FOLLOW_UP_GUARDRAIL_AUDIT_ACTION = "${WORKLOAD_FOLLOW_UP_GUARDRAIL_ACTION}"`), "跟进护栏审计动作");

  console.log("静态断言");
  {
    const modelSrc = stripComments(read("src/lib/cockpit/workload-read-model.ts"));
    const routeRaw = read("src/app/api/cockpit/workload/route.ts");
    const route = stripComments(routeRaw);
    for (const [name, src] of [["读模型", modelSrc], ["路由", route]] as const) {
      const writes = src.match(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw|\$queryRaw/g);
      ok(!writes, `${name}：没有写操作 / 原生 SQL（spec 场景）`, writes);
      ok(!src.includes("resolvePreferredOrgId") && !src.includes("setUserActiveOrgId"), `${name}：不用会改活动组织的解析`);
    }
    const calls = [...modelSrc.matchAll(/\bdb\.(\w+)\.(\w+)\(/g)];
    ok(calls.length >= 12, `读模型里有 ${calls.length} 处 db 查询`);
    for (const m of calls) {
      const [, model, method] = m;
      ok(["findFirst", "findMany", "findUnique", "count", "groupBy"].includes(method), `db.${model}.${method} 是读方法`);
      let depth = 0;
      let end = m.index! + m[0].length - 1;
      for (let i = end; i < modelSrc.length; i++) {
        if (modelSrc[i] === "(") depth++;
        if (modelSrc[i] === ")") depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
      const args = modelSrc.slice(m.index!, end);
      if (model === "automationRun") ok(!args.includes("orgId"), `db.automationRun.${method}：平台级，不按 orgId 过滤（显式例外）`);
      else if (model === "organization") ok(/where: \{ id: orgId \}/.test(args), "db.organization.findUnique 只读本组织设置");
      else ok(/\borgId\b/.test(args), `db.${model}.${method} 的查询条件带 orgId`);
    }
    for (const builder of ["agentRunTypeCountWhere(", "workforceDomainCountWhere(", "automationRunRangeWhere(", "workloadPendingActionWhere(", "pendingPayloadWhere(", "inquiryLinkWhere(", "workloadInquiryWhere(", "followUpGuardrailWhere(", "workloadUsageWhere(", "runLookupWhere("]) {
      ok(modelSrc.split(builder).length >= 2 + (builder.startsWith("agentRun") || builder.startsWith("workforce") ? 0 : 1), `默认依赖实际使用 ${builder.slice(0, -1)}`);
    }
    const pendingSelect = modelSrc.slice(modelSrc.indexOf("pendingActions: async"), modelSrc.indexOf("pendingPayloads: async"));
    ok(!pendingSelect.includes("payload"), "待审批主查询不取载荷（草稿正文）");
    ok(/sla\.isOnboardingTestInquiry/.test(modelSrc) && /sla\.utmSourceOf/.test(modelSrc) && /sla\.TRADE_SHOW_SOURCE/.test(modelSrc), "默认依赖从 sla-metrics 取测试询盘 / 展会判定");
    ok(/withAuth\(/.test(route) && /resolveCockpitViewer\(user\)/.test(route) && /resolved\.body, \{ status: resolved\.status \}/.test(route), "路由：withAuth → resolveCockpitViewer，失败原样返回其 403（与岗位总览同一套）");
    ok(/parseWorkloadDays\(/.test(route) && /status: 400/.test(route) && /getOrgWorkload\(resolved\.viewer, days\.days\)/.test(route), "路由：参数校验 400 → 读模型");
    ok(!/export (const|async function|function) (POST|PUT|PATCH|DELETE)\b/.test(routeRaw) && /export const GET = /.test(routeRaw), "路由只导出 GET（spec 场景）");
  }

  console.log(`\n组织驾驶舱工作量读模型: ${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
