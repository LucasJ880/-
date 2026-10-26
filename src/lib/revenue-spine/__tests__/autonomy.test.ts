/**
 * Revenue Spine — 内部自治（B-5，openspec change fde-internal-autonomy）测试：纯函数 + 假依赖 + 源码静态断言，无 DB。
 *   默认关闭与合并规则、候选查询条件、判定各条件、执行器（流转参数 / 汇总通知 / 上限 / 失败隔离 / 预算截断 / 关闭零调用）、
 *   定时任务接入点、流转规则表不放宽、审计带 policy 键名且进时间线、FDE 婉拒键名、无外发、配额链路、seed 计划
 * 运行：npx tsx src/lib/revenue-spine/__tests__/autonomy.test.ts
 *
 * 公开仓库：只用虚构数据。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { opportunityIdOfPayload } from "@/lib/cockpit/workload-read-model";
import { TIMELINE_AUDIT_ACTION_DENYLIST } from "@/lib/cockpit/timeline";
import {
  AUTO_STALE_BATCH,
  AUTO_STALE_POLICY_KEY,
  DECLINE_POLICY_KEY,
  autoStaleCandidateWhere,
  autoStaleReason,
  buildAutoStaleNotification,
  decideAutoStale,
  inFlightApprovalWhere,
  opportunityIdOfApprovalPayload,
  planAutonomyEnable,
  runAutoStale,
  staleCutoff,
  type AutoStaleCandidate,
  type AutoStaleDeps,
  type AutoStaleNotification,
} from "../autonomy";
import { ALLOWED_TRANSITIONS, OPEN_STAGES } from "../opportunity-stage";
import { DEFAULT_REVENUE_SPINE_POLICY, mergeRevenueSpinePolicy } from "../policy";
import { scoreOpportunity, type ScoreInput } from "../scoring";
import type { TransitionInput, TransitionResult } from "../transition";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const ORG = "org_sunny_home_deco";
const NOW = new Date("2026-10-26T12:00:00Z");
const DAY = 86_400_000;
const ON = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { autonomy: { autoStale: true } }); // staleAfterDays 21
const OFF = DEFAULT_REVENUE_SPINE_POLICY;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let seq = 0;
function opp(over: Partial<AutoStaleCandidate> = {}): AutoStaleCandidate {
  seq++;
  return {
    id: `opp_${seq}`,
    title: `Bathrobe OEM — Acme ${seq}`,
    stage: "follow_up",
    createdAt: ago(60),
    lastInteractionAt: ago(30),
    lastCustomerReplyAt: null,
    assignedToId: "u_owner_a",
    createdById: "u_creator",
    ...over,
  };
}

interface Calls {
  find: Array<{ orgId: string; cutoff: Date; limit: number }>;
  inFlight: string[];
  transitions: TransitionInput[];
  notifications: Array<{ userIds: string[]; n: AutoStaleNotification }>;
}

function fakeDeps(
  rows: AutoStaleCandidate[],
  opts: { inFlight?: string[]; failIds?: string[]; throwIds?: string[]; notifyThrows?: boolean } = {},
): { deps: AutoStaleDeps; calls: Calls } {
  const calls: Calls = { find: [], inFlight: [], transitions: [], notifications: [] };
  const deps: AutoStaleDeps = {
    findCandidates: async (orgId, cutoff, limit) => {
      calls.find.push({ orgId, cutoff, limit });
      return rows.slice(0, limit);
    },
    inFlightOpportunityIds: async (orgId) => {
      calls.inFlight.push(orgId);
      return opts.inFlight ?? [];
    },
    transition: async (input): Promise<TransitionResult> => {
      calls.transitions.push(input);
      if (opts.throwIds?.includes(input.opportunityId)) throw new Error("db down");
      if (opts.failIds?.includes(input.opportunityId)) return { ok: false, code: "INVALID_STAGE_TRANSITION", error: "x" };
      return { ok: true, from: "follow_up", to: "stale", outcomes: [], nextAction: null };
    },
    notify: async (userIds, n) => {
      if (opts.notifyThrows) throw new Error("notify down");
      calls.notifications.push({ userIds, n });
      return userIds.length;
    },
  };
  return { deps, calls };
}

async function main() {
  console.log("\n默认关闭与合并");

  await ok("场景「未配置零行为」：默认 policy autonomy.autoStale = false；执行器不调用任何依赖", async () => {
    assert.equal(DEFAULT_REVENUE_SPINE_POLICY.autonomy.autoStale, false);
    assert.equal(mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { followUp: { staleAfterDays: 30 } }).autonomy.autoStale, false);
    const { deps, calls } = fakeDeps([opp()]);
    const r = await runAutoStale(ORG, { policy: OFF, now: NOW }, deps);
    assert.deepEqual(r, { enabled: false, candidates: 0, staled: 0, failed: 0, skipped: {}, notified: 0, notifyFailed: 0, truncated: false });
    assert.equal(calls.find.length + calls.inFlight.length + calls.transitions.length + calls.notifications.length, 0);
  });

  await ok("场景「非布尔值」：autoStale = \"yes\" / 1 / null → false；true 生效；存量 policy 无 autonomy → base", () => {
    for (const v of ["yes", 1, null]) {
      assert.equal(mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { autonomy: { autoStale: v } }).autonomy.autoStale, false);
    }
    assert.equal(ON.autonomy.autoStale, true);
    assert.equal(mergeRevenueSpinePolicy(ON, { notify: { wechatOnNewDraft: true } }).autonomy.autoStale, true);
  });

  console.log("\n候选查询条件");

  await ok("候选查询：组织、开放阶段、客户未归档、最后互动（无则创建时间）与买家来信都早于 cutoff", () => {
    const cutoff = staleCutoff(ON, NOW);
    assert.equal(cutoff.getTime(), NOW.getTime() - 21 * DAY);
    assert.deepEqual(autoStaleCandidateWhere(ORG, cutoff), {
      orgId: ORG,
      stage: { in: [...OPEN_STAGES] },
      customer: { archivedAt: null },
      AND: [
        { OR: [{ lastInteractionAt: { lt: cutoff } }, { lastInteractionAt: null, createdAt: { lt: cutoff } }] },
        { OR: [{ lastCustomerReplyAt: null }, { lastCustomerReplyAt: { lt: cutoff } }] },
      ],
    });
    assert.deepEqual(inFlightApprovalWhere(ORG), { orgId: ORG, status: { in: ["pending", "approved"] } });
  });

  await ok("在途审批的商机 id：payload.opportunityId 或 payload.metadata.opportunityId，与工作量面板取法一致", () => {
    const cases: unknown[] = [
      { opportunityId: "o1" },
      { metadata: { opportunityId: " o2 " } },
      { opportunityId: "" },
      { opportunityId: 3 },
      null,
      [],
      "x",
      { to: "a@b.c" },
    ];
    for (const c of cases) assert.equal(opportunityIdOfApprovalPayload(c), opportunityIdOfPayload(c), JSON.stringify(c));
    assert.equal(opportunityIdOfApprovalPayload({ metadata: { opportunityId: " o2 " } }), "o2");
  });

  console.log("\n判定");

  const ctx = (inFlight: string[] = []) => ({ policy: ON, now: NOW, inFlight: new Set(inFlight) });

  await ok("场景「超期且无在途草稿」：follow_up、30 天前最后互动、买家从未来信 → 搁置", () => {
    assert.deepEqual(decideAutoStale(opp(), ctx()), { stale: true });
  });

  await ok("无互动记录按创建时间：创建 30 天前 → 搁置；创建 10 天前 → 不动", () => {
    assert.deepEqual(decideAutoStale(opp({ lastInteractionAt: null, createdAt: ago(30) }), ctx()), { stale: true });
    assert.deepEqual(decideAutoStale(opp({ lastInteractionAt: null, createdAt: ago(10) }), ctx()), { stale: false, reason: "recent_interaction" });
  });

  await ok("场景「有在途草稿」：该商机有 pending 审批 → 不动", () => {
    const o = opp();
    assert.deepEqual(decideAutoStale(o, ctx([o.id])), { stale: false, reason: "in_flight_approval" });
  });

  await ok("场景「买家近期来信」：3 天前来信 → 不动（即使最后互动字段更早）", () => {
    assert.deepEqual(decideAutoStale(opp({ lastCustomerReplyAt: ago(3) }), ctx()), { stale: false, reason: "recent_buyer_reply" });
    assert.deepEqual(decideAutoStale(opp({ lastCustomerReplyAt: ago(25) }), ctx()), { stale: true });
  });

  await ok("场景「非开放阶段」：nurture / stale / won / lost / disqualified → 不动", () => {
    for (const stage of ["nurture", "stale", "won", "lost", "disqualified"]) {
      assert.deepEqual(decideAutoStale(opp({ stage }), ctx()), { stale: false, reason: "not_open" }, stage);
    }
  });

  await ok("最后互动未超期（20 天前、阈值 21 天）→ 不动；开关关闭 → disabled", () => {
    assert.deepEqual(decideAutoStale(opp({ lastInteractionAt: ago(20) }), ctx()), { stale: false, reason: "recent_interaction" });
    assert.deepEqual(decideAutoStale(opp(), { policy: OFF, now: NOW, inFlight: new Set() }), { stale: false, reason: "disabled" });
  });

  await ok("阈值跟 policy 走：staleAfterDays = 45 时 30 天前不动", () => {
    const p45 = mergeRevenueSpinePolicy(ON, { followUp: { staleAfterDays: 45 } });
    assert.deepEqual(decideAutoStale(opp(), { policy: p45, now: NOW, inFlight: new Set() }), { stale: false, reason: "recent_interaction" });
    assert.match(autoStaleReason(p45), /45 天/);
  });

  console.log("\n执行器");

  await ok("场景「审计内容」：经 transition 转 stale，source = system、无人工 actor、policyKey、原因含 21 天", async () => {
    const o = opp();
    const { deps, calls } = fakeDeps([o]);
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(r.staled, 1);
    const t = calls.transitions[0];
    assert.equal(t.orgId, ORG);
    assert.equal(t.opportunityId, o.id);
    assert.equal(t.to, "stale");
    assert.equal(t.source, "system");
    assert.equal(t.actorUserId, null);
    assert.equal(t.policyKey, AUTO_STALE_POLICY_KEY);
    assert.equal(t.policyKey, "autonomy.autoStale");
    assert.match(t.reason ?? "", /21 天/);
    assert.equal(t.now, NOW);
    assert.equal(calls.find[0].orgId, ORG);
    assert.equal(calls.find[0].cutoff.getTime(), NOW.getTime() - 21 * DAY);
  });

  await ok("transition.ts 把 policyKey 写进审计 afterData（未传时审计字段与原来相同）", () => {
    const src = strip(read("src/lib/revenue-spine/transition.ts"));
    assert.match(src, /policyKey\?: string \| null;/);
    assert.match(src, /action: "revenue_spine\.opportunity\.transition"/);
    assert.match(src, /\.\.\.\(input\.policyKey \? \{ policyKey: input\.policyKey \} : \{\}\)/);
    assert.match(src, /stage: input\.to,\s*source: input\.source,\s*reason: input\.reason \?\? null,\s*salesActionId: input\.salesActionId \?\? null,/);
  });

  await ok("流转审计进 company.log：动作不在时间线排除名单里", () => {
    assert.ok(!(TIMELINE_AUDIT_ACTION_DENYLIST as readonly string[]).includes("revenue_spine.opportunity.transition"));
  });

  await ok("场景「按负责人汇总」：A 3 个、B 1 个 → A、B 各一条；只有一个商机时关联到该商机", async () => {
    const a = [opp({ title: "A1" }), opp({ title: "A2" }), opp({ title: "A3" })];
    const b = opp({ assignedToId: "u_owner_b", title: "B1" });
    const { deps, calls } = fakeDeps([...a, b]);
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(r.staled, 4);
    assert.equal(r.notified, 2);
    const byUser = Object.fromEntries(calls.notifications.map((c) => [c.userIds.join(","), c.n]));
    assert.equal(byUser.u_owner_a.title, "已自动搁置 3 个长期无互动商机");
    assert.equal(byUser.u_owner_b.title, "已自动搁置 1 个长期无互动商机");
    assert.equal(byUser.u_owner_a.type, "followup");
    assert.equal(byUser.u_owner_a.entityId, undefined);
    assert.equal(byUser.u_owner_b.entityType, "revenue_opportunity");
    assert.equal(byUser.u_owner_b.entityId, b.id);
    assert.match(byUser.u_owner_a.summary, /A1；A2；A3/);
    assert.deepEqual(byUser.u_owner_a.metadata.opportunityIds, a.map((o) => o.id));
    assert.equal(byUser.u_owner_a.metadata.policyKey, "autonomy.autoStale");
    assert.equal(byUser.u_owner_a.sourceKeyPrefix, `revenue-auto-stale:${ORG}:${NOW.toISOString()}`);
  });

  await ok("场景「无负责人」：通知创建人", async () => {
    const o = opp({ assignedToId: null, createdById: "u_creator_c" });
    const { deps, calls } = fakeDeps([o]);
    await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.deepEqual(calls.notifications.map((c) => c.userIds), [["u_creator_c"]]);
  });

  await ok("通知只列标题与天数：不含邮箱、电话、金额；超过 3 个时写「等 N 个」", () => {
    const opps = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, title: `T${i}` }));
    const n = buildAutoStaleNotification(ORG, opps, { policy: ON, now: NOW });
    assert.match(n.summary, /T0；T1；T2 等 5 个/);
    assert.doesNotMatch(JSON.stringify(n), /@|\+?\d{3}[-\s]?\d{3,4}[-\s]?\d{4}|USD|\$|¥/);
    assert.equal(n.priority, "medium");
  });

  await ok("被跳过的不流转、不通知，并按原因计数；在途集合只查一次", async () => {
    const inFlightOpp = opp();
    const recentReply = opp({ lastCustomerReplyAt: ago(2) });
    const good = opp();
    const { deps, calls } = fakeDeps([inFlightOpp, recentReply, good], { inFlight: [inFlightOpp.id] });
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.deepEqual(calls.transitions.map((t) => t.opportunityId), [good.id]);
    assert.deepEqual(r.skipped, { in_flight_approval: 1, recent_buyer_reply: 1 });
    assert.equal(calls.inFlight.length, 1);
  });

  await ok("场景「单个失败」：第 2 个返回失败、第 3 个抛错 → 第 1 个照常流转，记 2 个失败，只通知成功的", async () => {
    const [o1, o2, o3] = [opp(), opp(), opp()];
    const { deps, calls } = fakeDeps([o1, o2, o3], { failIds: [o2.id], throwIds: [o3.id] });
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(calls.transitions.length, 3);
    assert.equal(r.staled, 1);
    assert.equal(r.failed, 2);
    assert.deepEqual(calls.notifications[0].n.metadata.opportunityIds, [o1.id]);
  });

  await ok("通知失败不回滚流转，计入 notifyFailed", async () => {
    const { deps, calls } = fakeDeps([opp()], { notifyThrows: true });
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(r.staled, 1);
    assert.equal(r.notifyFailed, 1);
    assert.equal(calls.transitions.length, 1);
  });

  await ok("上限：候选查询取 201 行，最多流转 200 个并标记截断", async () => {
    const rows = Array.from({ length: AUTO_STALE_BATCH + 5 }, () => opp());
    const { deps, calls } = fakeDeps(rows);
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(calls.find[0].limit, AUTO_STALE_BATCH + 1);
    assert.equal(r.candidates, AUTO_STALE_BATCH);
    assert.equal(r.staled, AUTO_STALE_BATCH);
    assert.equal(r.truncated, true);
  });

  await ok("维护预算用完：停在原地、标记截断，已流转的照常通知", async () => {
    const rows = [opp(), opp(), opp()];
    let checks = 0;
    const { deps, calls } = fakeDeps(rows);
    const r = await runAutoStale(ORG, { policy: ON, now: NOW, shouldStop: () => ++checks > 2 }, deps);
    assert.equal(calls.transitions.length, 2);
    assert.equal(r.truncated, true);
    assert.equal(r.notified, 1);
  });

  await ok("场景「第二轮」：已搁置的商机阶段为 stale，不是候选（查询限开放阶段，判定也拒绝）", async () => {
    assert.ok(!(OPEN_STAGES as readonly string[]).includes("stale"));
    const { deps, calls } = fakeDeps([opp({ stage: "stale" })]);
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(calls.transitions.length, 0);
    assert.equal(calls.notifications.length, 0);
    assert.deepEqual(r.skipped, { not_open: 1 });
  });

  await ok("没有候选：不查在途审批、不通知", async () => {
    const { deps, calls } = fakeDeps([]);
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(r.candidates, 0);
    assert.equal(calls.inFlight.length, 0);
  });

  console.log("\n接入与不放宽");

  await ok("场景「阶段规则不放宽」：流转规则表与改动前逐项相同；每个开放阶段本来就允许转 stale", () => {
    assert.deepEqual(ALLOWED_TRANSITIONS, {
      new_inquiry: ["enriching", "lost", "nurture", "stale", "disqualified"],
      enriching: ["needs_info", "qualified", "disqualified", "lost", "nurture", "stale"],
      needs_info: ["qualified", "rfq_ready", "lost", "nurture", "stale", "disqualified"],
      qualified: ["rfq_ready", "needs_info", "lost", "nurture", "stale", "disqualified"],
      rfq_ready: ["quoting", "needs_info", "lost", "nurture", "stale", "disqualified"],
      quoting: ["quoted", "needs_info", "lost", "nurture", "stale", "disqualified"],
      quoted: ["follow_up", "sample", "negotiation", "lost", "nurture", "stale"],
      follow_up: ["sample", "negotiation", "quoted", "won", "lost", "nurture", "stale"],
      sample: ["negotiation", "follow_up", "quoted", "won", "lost", "nurture", "stale"],
      negotiation: ["won", "lost", "sample", "follow_up", "nurture", "stale"],
      won: [],
      lost: ["nurture"],
      nurture: ["qualified", "rfq_ready", "follow_up", "negotiation", "lost", "stale"],
      stale: ["qualified", "follow_up", "negotiation", "nurture", "lost", "disqualified"],
      disqualified: ["nurture"],
    });
    for (const s of OPEN_STAGES) assert.ok(ALLOWED_TRANSITIONS[s].includes("stale"), s);
  });

  await ok("定时任务：开关保护、在 next action 重算之前、带维护预算、结果写进组织行", () => {
    const src = strip(read("src/app/api/cron/revenue-spine/route.ts"));
    const guard = src.indexOf("if (policy.autonomy.autoStale) {");
    const call = src.indexOf("await runAutoStale(orgId, { policy, now, shouldStop: pastMaintenanceDeadline })");
    const nextAction = src.indexOf("await applyNextAction(orgId, o.id, { policy, now })");
    assert.ok(guard > 0 && call > guard && nextAction > call, JSON.stringify({ guard, call, nextAction }));
    assert.match(src, /row\.autoStale = autoStale;/);
    assert.equal((src.match(/runAutoStale\(/g) ?? []).length, 1);
  });

  await ok("场景「静态检查」：自治模块不建审批、不发送、不调执行器；vercel.json 仍是 23 个定时任务", () => {
    const src = strip(read("src/lib/revenue-spine/autonomy.ts"));
    for (const banned of ["requestApproval", "pendingAction.create", "createPendingAction", "sendEmail", "sendMail", "exec-sales", "executePendingAction", "approvePendingAction", "rejectPendingAction", "openai", "anthropic", "llm"]) {
      assert.ok(!src.toLowerCase().includes(banned.toLowerCase()), banned);
    }
    assert.doesNotMatch(src, /\.(create|update|upsert|delete)(Many)?\(/);
    const crons = JSON.parse(read("vercel.json")).crons as Array<{ path: string }>;
    assert.equal(crons.length, 23);
    assert.equal(crons.filter((c) => c.path === "/api/cron/revenue-spine").length, 1);
  });

  console.log("\n不合格自动关闭");

  await ok("场景「decline」：FDE 判不合格且 decline 命中时传 policy 键名；不合格分支不起草", () => {
    assert.equal(DECLINE_POLICY_KEY, "businessProfile.excludedCategoryAction");
    const src = strip(read("src/lib/revenue-spine/fde/inbound-sales.ts"));
    assert.match(
      src,
      /const declinedByPolicy =\s*target === OpportunityStage\.DISQUALIFIED && score\.outOfRange && policy\.businessProfile\.excludedCategoryAction === "decline";/,
    );
    assert.match(src, /policyKey: declinedByPolicy \? DECLINE_POLICY_KEY : null,/);
    assert.match(src, /policyKey: ctx\.policyKey \?\? null,/);
    assert.match(src, /if \(score\.qualification !== "disqualified" && !score\.outOfRange\) \{/);
  });

  await ok("评分：只命中不做类目，review（默认）→ 需要信息；decline → 不合格", () => {
    const base = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, {});
    const excluded = "excluded_test_category";
    const withExcluded = (action: "review" | "decline") => ({
      ...base,
      businessProfile: { ...base.businessProfile, excludedCategories: [excluded], excludedCategoryAction: action },
    });
    const input = (policy: ScoreInput["policy"]): ScoreInput => ({
      fields: { productCategory: excluded, quantity: 5000 } as ScoreInput["fields"],
      research: { buyerType: "importer", isFreeMail: false } as unknown as ScoreInput["research"],
      message: "we need quote",
      policy,
    });
    assert.equal(DEFAULT_REVENUE_SPINE_POLICY.businessProfile.excludedCategoryAction, "review");
    assert.equal(scoreOpportunity(input(withExcluded("review"))).qualification, "needs_info");
    assert.equal(scoreOpportunity(input(withExcluded("decline"))).qualification, "disqualified");
  });

  console.log("\n配额命中可见（既有链路）");

  await ok("场景「链路静态检查」：FDE 运行 → 配额预留 → 评估 → 硬限额审计 + 通知 owner / admin → 岗位健康度读取", () => {
    const fde = strip(read("src/lib/revenue-spine/fde/inbound-sales.ts"));
    assert.match(fde, /await createAgentRun\(\{/);
    const run = strip(read("src/lib/agent-runtime/run.ts"));
    assert.match(run, /reserveQuota\(\{[\s\S]{0,200}metric: "DAILY_AGENT_RUNS"/);
    assert.match(strip(read("src/lib/capabilities/governance/reserve.ts")), /evaluateQuota\(/);
    const evaluate = strip(read("src/lib/capabilities/governance/evaluate.ts"));
    assert.match(evaluate, /"QUOTA_HARD_LIMIT_BLOCKED"/);
    assert.match(evaluate, /if \(level === "HARD_LIMIT"\) \{\s*try \{\s*await notifyQuotaHardLimitBlocked\(/);
    const notify = strip(read("src/lib/capabilities/governance/quota-notify.ts"));
    assert.match(notify, /role: \{ in: \["org_owner", "org_admin"\] \}/);
    assert.match(notify, /type: "quota_hard_limit"/);
    const posts = strip(read("src/lib/cockpit/posts-read-model.ts"));
    assert.match(posts, /action: "QUOTA_HARD_LIMIT_BLOCKED", targetType: "quota", targetId: "DAILY_AGENT_RUNS"/);
    assert.match(posts, /type: "quota_hard_limit", entityId: "DAILY_AGENT_RUNS"/);
  });

  console.log("\ndogfood 开启脚本");

  await ok("场景「计划」：保留现有覆盖，只加 autonomy.autoStale = true", () => {
    assert.deepEqual(planAutonomyEnable({ followUp: { staleAfterDays: 30 } }), { followUp: { staleAfterDays: 30 }, autonomy: { autoStale: true } });
    assert.deepEqual(planAutonomyEnable(null), { autonomy: { autoStale: true } });
    assert.deepEqual(planAutonomyEnable({ autonomy: { autoStale: false, other: 1 } }), { autonomy: { autoStale: true, other: 1 } });
    const merged = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, planAutonomyEnable({ followUp: { staleAfterDays: 30 } }));
    assert.equal(merged.autonomy.autoStale, true);
    assert.equal(merged.followUp.staleAfterDays, 30);
  });

  await ok("场景「已开启」：计划为不发布", () => {
    assert.equal(planAutonomyEnable({ autonomy: { autoStale: true } }), null);
  });

  await ok("脚本：缺省 sunny-home-deco、不带 --write 不发布、只发布 policy 规则；代码默认值仍关闭", () => {
    const src = strip(read("scripts/seed-revenue-autonomy.ts"));
    assert.match(src, /const DEFAULT_ORG_CODE = "sunny-home-deco";/);
    assert.match(src, /if \(!write\) \{\s*console\.log\("\\n\[dry-run\] 未写入；加 --write 执行。"\);\s*return;\s*\}/);
    assert.equal((src.match(/publishRevenueSpineRule\(/g) ?? []).length, 1);
    assert.match(src, /ruleKey: RULE_KEY_POLICY, config: next/);
    assert.ok(src.indexOf("if (!next)") < src.indexOf("publishRevenueSpineRule({"));
    assert.match(strip(read("src/lib/revenue-spine/policy.ts")), /autonomy: \{ autoStale: false \},/);
  });

  console.log(`\nautonomy: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
