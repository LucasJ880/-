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
  AUTO_STALE_SCAN,
  DECLINE_POLICY_KEY,
  IN_FLIGHT_SCAN_LIMIT,
  approvalRefsOfPayload,
  autoStaleCandidateWhere,
  autoStaleDisabledReason,
  autoStaleMinDays,
  autoStaleReason,
  buildAutoStaleNotification,
  decideAutoStale,
  inFlightApprovalWhere,
  lastActivityAt,
  latestInteractionWhere,
  maskContactInTitle,
  opportunityIdOfApprovalPayload,
  planAutonomyEnable,
  quoteOpportunityWhere,
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
const ON = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { autonomy: { autoStale: true } }); // staleAfterDays 21，跟进 3/7/14
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
    stageChangedAt: ago(40),
    lastInteractionAt: ago(30),
    lastCustomerReplyAt: null,
    lastOutboundAt: ago(30),
    assignedToId: "u_owner_a",
    createdById: "u_creator",
    ...over,
  };
}

interface Calls {
  find: Array<{ orgId: string; cutoff: Date; limit: number }>;
  inFlight: string[];
  latest: string[][];
  reloads: string[];
  transitions: TransitionInput[];
  notifications: Array<{ userIds: string[]; n: AutoStaleNotification }>;
}

interface FakeOpts {
  inFlight?: string[];
  inFlightTruncated?: boolean;
  latest?: Record<string, Date>;
  /** reload 返回的行（缺省 = 候选原样；null = 已删除） */
  reloaded?: Record<string, AutoStaleCandidate | null>;
  failIds?: string[];
  throwIds?: string[];
  /** 抛错但阶段已写成 stale 的商机 */
  throwAfterWriteIds?: string[];
  notifyThrows?: boolean;
}

function fakeDeps(rows: AutoStaleCandidate[], opts: FakeOpts = {}): { deps: AutoStaleDeps; calls: Calls } {
  const calls: Calls = { find: [], inFlight: [], latest: [], reloads: [], transitions: [], notifications: [] };
  const written = new Set<string>();
  const deps: AutoStaleDeps = {
    findCandidates: async (orgId, cutoff, limit) => {
      calls.find.push({ orgId, cutoff, limit });
      return rows.slice(0, limit);
    },
    latestInteractionAt: async (_orgId, ids) => {
      calls.latest.push(ids);
      return new Map(Object.entries(opts.latest ?? {}).filter(([id]) => ids.includes(id)));
    },
    inFlightOpportunityIds: async (orgId) => {
      calls.inFlight.push(orgId);
      return { ids: opts.inFlight ?? [], truncated: opts.inFlightTruncated === true };
    },
    reload: async (_orgId, id) => {
      calls.reloads.push(id);
      if (written.has(id)) return { ...(rows.find((r) => r.id === id) as AutoStaleCandidate), stage: "stale" };
      if (opts.reloaded && id in opts.reloaded) return opts.reloaded[id];
      return rows.find((r) => r.id === id) ?? null;
    },
    transition: async (input): Promise<TransitionResult> => {
      calls.transitions.push(input);
      if (opts.throwAfterWriteIds?.includes(input.opportunityId)) {
        written.add(input.opportunityId);
        throw new Error("applyNextAction failed");
      }
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
    assert.equal(r.enabled, false);
    assert.equal(r.disabledReason, "off");
    assert.equal(r.staled, 0);
    const total = calls.find.length + calls.inFlight.length + calls.latest.length + calls.reloads.length + calls.transitions.length + calls.notifications.length;
    assert.equal(total, 0);
  });

  await ok("场景「非布尔值」：autoStale = \"yes\" / 1 / null → false；true 生效；存量 policy 无 autonomy → base", () => {
    for (const v of ["yes", 1, null]) {
      assert.equal(mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { autonomy: { autoStale: v } }).autonomy.autoStale, false);
    }
    assert.equal(ON.autonomy.autoStale, true);
    assert.equal(mergeRevenueSpinePolicy(ON, { notify: { wechatOnNewDraft: true } }).autonomy.autoStale, true);
  });

  await ok("场景「阈值过低」：最低天数 = max(14, 最后一次无回复跟进 + 7)；默认 21 刚好够；0 / 10 / 20 天视为关闭且零调用", async () => {
    assert.equal(autoStaleMinDays(ON), 21);
    assert.equal(autoStaleDisabledReason(ON), null);
    assert.equal(autoStaleMinDays(mergeRevenueSpinePolicy(ON, { followUp: { noReplyFollowUpDays: [] } })), 14);
    for (const days of [0, 10, 20]) {
      const p = mergeRevenueSpinePolicy(ON, { followUp: { staleAfterDays: days } });
      assert.equal(autoStaleDisabledReason(p), "threshold_too_low", String(days));
      const { deps, calls } = fakeDeps([opp()]);
      const r = await runAutoStale(ORG, { policy: p, now: NOW }, deps);
      assert.deepEqual([r.enabled, r.disabledReason, calls.find.length], [false, "threshold_too_low", 0]);
    }
    const p14 = mergeRevenueSpinePolicy(ON, { followUp: { staleAfterDays: 14, noReplyFollowUpDays: [] } });
    assert.equal(autoStaleDisabledReason(p14), null);
  });

  console.log("\n查询条件");

  await ok("候选查询：组织、开放阶段、客户未归档、Revenue Spine 维护（stageChangedAt 非空）且阶段变更 / 创建 / 最后互动 / 买家来信都早于 cutoff", () => {
    const cutoff = staleCutoff(ON, NOW);
    assert.equal(cutoff.getTime(), NOW.getTime() - 21 * DAY);
    assert.deepEqual(autoStaleCandidateWhere(ORG, cutoff), {
      orgId: ORG,
      stage: { in: [...OPEN_STAGES] },
      customer: { archivedAt: null },
      stageChangedAt: { not: null, lt: cutoff },
      createdAt: { lt: cutoff },
      AND: [
        { OR: [{ lastInteractionAt: null }, { lastInteractionAt: { lt: cutoff } }] },
        { OR: [{ lastCustomerReplyAt: null }, { lastCustomerReplyAt: { lt: cutoff } }] },
      ],
    });
    assert.deepEqual(inFlightApprovalWhere(ORG), { orgId: ORG, status: { in: ["pending", "approved"] } });
    assert.deepEqual(latestInteractionWhere(ORG, ["o1"]), { orgId: ORG, opportunityId: { in: ["o1"] } });
    assert.deepEqual(quoteOpportunityWhere(ORG, ["q1"]), { orgId: ORG, id: { in: ["q1"] }, opportunityId: { not: null } });
  });

  await ok("生产查询的 where 全部来自构造函数；在途审批按创建时间倒序读 上限 + 1", () => {
    const src = strip(read("src/lib/revenue-spine/autonomy.ts"));
    const deps = src.slice(src.indexOf("export function defaultAutoStaleDeps"));
    const wheres = [...deps.matchAll(/where: (\w+\([^)]*\))/g)].map((m) => m[1]);
    assert.deepEqual(wheres, [
      "autoStaleCandidateWhere(orgId, cutoff)",
      "latestInteractionWhere(orgId, opportunityIds)",
      "inFlightApprovalWhere(orgId)",
      "quoteOpportunityWhere(orgId, [...quoteIds])",
    ]);
    assert.match(deps, /orderBy: \{ createdAt: "desc" \},\s*take: IN_FLIGHT_SCAN_LIMIT \+ 1,/);
    assert.match(deps, /if \(rows\.length > IN_FLIGHT_SCAN_LIMIT\) return \{ ids: \[\], truncated: true \};/);
    assert.match(deps, /where: \{ id: opportunityId, orgId, customer: \{ archivedAt: null \} \}/);
    assert.equal(IN_FLIGHT_SCAN_LIMIT, 2000);
  });

  await ok("在途审批引用：商机 id、报价 id（映射到商机）、targetType / resourceType；opportunityId 取法与工作量面板一致", () => {
    const cases: unknown[] = [{ opportunityId: "o1" }, { metadata: { opportunityId: " o2 " } }, { opportunityId: "" }, { opportunityId: 3 }, null, [], "x", { to: "a@b.c" }];
    for (const c of cases) assert.equal(opportunityIdOfApprovalPayload(c), opportunityIdOfPayload(c), JSON.stringify(c));
    assert.deepEqual(approvalRefsOfPayload({ opportunityId: "o1", metadata: { opportunityId: "o2" } }), { opportunityIds: ["o1", "o2"], quoteIds: [] });
    // 报价让利审批：只有 quoteId + resourceType sales_quote
    assert.deepEqual(approvalRefsOfPayload({ quoteId: "q1", resourceType: "sales_quote", resourceId: "q1", metadata: { quoteId: "q1", targetType: "sales_quote" } }), {
      opportunityIds: [],
      quoteIds: ["q1"],
    });
    // Grader 内部备注：targetType OPPORTUNITY / QUOTE
    assert.deepEqual(approvalRefsOfPayload({ targetType: "OPPORTUNITY", targetId: "o3", metadata: { orgId: "x" } }), { opportunityIds: ["o3"], quoteIds: [] });
    assert.deepEqual(approvalRefsOfPayload({ metadata: { targetType: "quote", targetId: "q2" } }), { opportunityIds: [], quoteIds: ["q2"] });
    assert.deepEqual(approvalRefsOfPayload({ targetType: "CUSTOMER", targetId: "c1" }), { opportunityIds: [], quoteIds: [] });
  });

  console.log("\n判定");

  const ctx = (o: { inFlight?: string[]; latest?: Date | null } = {}) => ({ policy: ON, now: NOW, inFlight: new Set(o.inFlight ?? []), latestInteractionAt: o.latest ?? null });

  await ok("场景「超期且无在途草稿」：follow_up、40 天前推进、30 天前最后互动、买家从未来信 → 搁置", () => {
    const d = decideAutoStale(opp(), ctx());
    assert.equal(d.stale, true);
  });

  await ok("场景「旧车道商机」：stageChangedAt 为空（Sunny 窗饰车道的 quoted / negotiation）→ 不动", () => {
    for (const stage of ["quoted", "negotiation"]) {
      assert.deepEqual(decideAutoStale(opp({ stage, stageChangedAt: null, lastInteractionAt: null, lastOutboundAt: null }), ctx()), { stale: false, reason: "not_revenue_spine" });
    }
  });

  await ok("场景「近期有人推进」：阶段 3 天前刚变更（人工推进 rfq_ready → quoting），最后互动 25 天前 → 不动", () => {
    assert.deepEqual(decideAutoStale(opp({ stage: "quoting", stageChangedAt: ago(3), lastInteractionAt: ago(25) }), ctx()), { stale: false, reason: "recent_activity" });
  });

  await ok("场景「其它入口的互动」：没经 Revenue Spine 的互动记录 2 天前（报价邮件、外贸收件箱）→ 不动", () => {
    assert.deepEqual(decideAutoStale(opp(), ctx({ latest: ago(2) })), { stale: false, reason: "recent_activity" });
    assert.equal(lastActivityAt(opp({ lastInteractionAt: ago(30), stageChangedAt: ago(40) }), ago(2)).getTime(), ago(2).getTime());
    assert.equal(lastActivityAt(opp({ lastInteractionAt: null, stageChangedAt: null }), null).getTime(), ago(60).getTime());
  });

  await ok("边界：最后活动恰好在 cutoff → 不动；早 1 毫秒 → 搁置", () => {
    const cutoff = staleCutoff(ON, NOW);
    const at = (t: Date) => opp({ stageChangedAt: t, lastInteractionAt: t, lastOutboundAt: t });
    assert.deepEqual(decideAutoStale(at(cutoff), ctx()), { stale: false, reason: "recent_activity" });
    assert.equal(decideAutoStale(at(new Date(cutoff.getTime() - 1)), ctx()).stale, true);
  });

  await ok("场景「有在途草稿」：该商机有 pending 审批 → 不动", () => {
    const o = opp();
    assert.deepEqual(decideAutoStale(o, ctx({ inFlight: [o.id] })), { stale: false, reason: "in_flight_approval" });
  });

  await ok("场景「买家近期来信」：3 天前来信 → 不动", () => {
    assert.deepEqual(decideAutoStale(opp({ lastCustomerReplyAt: ago(3), lastInteractionAt: ago(3) }), ctx()), { stale: false, reason: "recent_activity" });
    assert.deepEqual(decideAutoStale(opp({ lastCustomerReplyAt: ago(3) }), ctx()), { stale: false, reason: "recent_buyer_reply" });
  });

  await ok("场景「买家在等我们回复」：25 天前来信、我方之后没外发（含从未回复的首封询盘）→ 不动；我方已回复 → 搁置", () => {
    assert.deepEqual(decideAutoStale(opp({ lastCustomerReplyAt: ago(25), lastOutboundAt: ago(30) }), ctx()), { stale: false, reason: "awaiting_our_reply" });
    assert.deepEqual(decideAutoStale(opp({ lastCustomerReplyAt: ago(25), lastOutboundAt: null }), ctx()), { stale: false, reason: "awaiting_our_reply" });
    assert.equal(decideAutoStale(opp({ lastCustomerReplyAt: ago(28), lastOutboundAt: ago(25), lastInteractionAt: ago(25) }), ctx()).stale, true);
  });

  await ok("场景「非开放阶段」：nurture / stale / won / lost / disqualified → 不动", () => {
    for (const stage of ["nurture", "stale", "won", "lost", "disqualified"]) {
      assert.deepEqual(decideAutoStale(opp({ stage }), ctx()), { stale: false, reason: "not_open" }, stage);
    }
  });

  await ok("开关关闭 → disabled；阈值跟 policy 走：staleAfterDays = 45 时 30 天前不动", () => {
    assert.deepEqual(decideAutoStale(opp(), { policy: OFF, now: NOW, inFlight: new Set() }), { stale: false, reason: "disabled" });
    const p45 = mergeRevenueSpinePolicy(ON, { followUp: { staleAfterDays: 45 } });
    assert.deepEqual(decideAutoStale(opp(), { policy: p45, now: NOW, inFlight: new Set() }), { stale: false, reason: "recent_activity" });
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
    assert.equal(calls.find[0].limit, AUTO_STALE_SCAN);
    assert.deepEqual(calls.latest, [[o.id]]);
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

  await ok("场景「标题含联系方式」：intake 标题「产品 — 邮箱 / 电话」在通知里被遮盖；超过 3 个写「等 N 个」", () => {
    assert.equal(maskContactInTitle("Bathrobe — john.smith@acme-home.example"), "Bathrobe — [邮箱]");
    assert.equal(maskContactInTitle("Towel — +1 (416) 555-0199"), "Towel — [电话]");
    assert.equal(maskContactInTitle("+86 138 0013 8000"), "[电话]");
    assert.equal(maskContactInTitle("Hotel Towel 70x140 — Acme Ltd"), "Hotel Towel 70x140 — Acme Ltd");
    assert.equal(maskContactInTitle("MOQ 500-1000 pcs"), "MOQ 500-1000 pcs");
    const opps = [
      { id: "o0", title: "Bathrobe — buyer@example.com" },
      { id: "o1", title: "Towel — +1 (416) 555-0199" },
      { id: "o2", title: "T2" },
      { id: "o3", title: "T3" },
      { id: "o4", title: "T4" },
    ];
    const n = buildAutoStaleNotification(ORG, opps, { policy: ON, now: NOW });
    assert.match(n.summary, /\[邮箱\]；Towel — \[电话\]；T2 等 5 个/);
    const json = JSON.stringify(n);
    assert.ok(!json.includes("buyer@example.com") && !json.includes("555-0199"));
    assert.doesNotMatch(json, /USD|\$|¥/);
    assert.equal(n.priority, "medium");
  });

  await ok("被跳过的不流转、不通知、不占流转名额，并按原因计数；在途集合与最新互动各查一次", async () => {
    const inFlightOpp = opp();
    const recentReply = opp({ lastCustomerReplyAt: ago(2) });
    const good = opp();
    const { deps, calls } = fakeDeps([inFlightOpp, recentReply, good], { inFlight: [inFlightOpp.id] });
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.deepEqual(calls.transitions.map((t) => t.opportunityId), [good.id]);
    assert.deepEqual(r.skipped, { in_flight_approval: 1, recent_buyer_reply: 1 });
    assert.equal(calls.inFlight.length, 1);
    assert.equal(calls.latest.length, 1);
  });

  await ok("在途审批读满上限：本轮整个组织不搁置（fail closed）", async () => {
    const { deps, calls } = fakeDeps([opp()], { inFlightTruncated: true });
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.deepEqual([r.enabled, r.disabledReason, r.staled, calls.transitions.length], [false, "in_flight_scan_truncated", 0, 0]);
  });

  await ok("流转前重读：期间刚来信 / 刚推进 → 不动；已删除 → gone", async () => {
    const [a, b, c] = [opp(), opp(), opp()];
    const { deps, calls } = fakeDeps([a, b, c], {
      reloaded: { [a.id]: { ...a, lastInteractionAt: NOW, lastCustomerReplyAt: NOW }, [b.id]: { ...b, stage: "quoting", stageChangedAt: NOW }, [c.id]: null },
    });
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(calls.transitions.length, 0);
    assert.deepEqual(r.skipped, { recent_activity: 2, gone: 1 });
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

  await ok("阶段已写入但后半段抛错（重算下一步失败）：按已搁置计并通知", async () => {
    const o = opp();
    const { deps, calls } = fakeDeps([o], { throwAfterWriteIds: [o.id] });
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.deepEqual([r.staled, r.failed, calls.notifications.length], [1, 0, 1]);
  });

  await ok("通知失败不回滚流转，计入 notifyFailed", async () => {
    const { deps, calls } = fakeDeps([opp()], { notifyThrows: true });
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(r.staled, 1);
    assert.equal(r.notifyFailed, 1);
    assert.equal(calls.transitions.length, 1);
  });

  await ok("上限：每轮最多流转 200 个并标记截断；被跳过的不占名额（100 个在途 + 150 个可搁置 → 150 个、不截断）", async () => {
    const many = Array.from({ length: 250 }, () => opp());
    const r1 = await runAutoStale(ORG, { policy: ON, now: NOW }, fakeDeps(many).deps);
    assert.deepEqual([r1.staled, r1.truncated], [AUTO_STALE_BATCH, true]);
    const busy = Array.from({ length: 100 }, () => opp());
    const free = Array.from({ length: 150 }, () => opp());
    const r2 = await runAutoStale(ORG, { policy: ON, now: NOW }, fakeDeps([...busy, ...free], { inFlight: busy.map((o) => o.id) }).deps);
    assert.deepEqual([r2.staled, r2.truncated, r2.skipped.in_flight_approval], [150, false, 100]);
    assert.ok(AUTO_STALE_SCAN > AUTO_STALE_BATCH);
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

  await ok("没有候选：不查在途审批、不查互动、不通知", async () => {
    const { deps, calls } = fakeDeps([]);
    const r = await runAutoStale(ORG, { policy: ON, now: NOW }, deps);
    assert.equal(r.candidates, 0);
    assert.equal(calls.inFlight.length + calls.latest.length, 0);
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
    // 单独兜错：自动搁置失败不影响本组织的 next action 与跟进草稿
    assert.match(src, /if \(policy\.autonomy\.autoStale\) \{\s*try \{\s*const autoStale = await runAutoStale\([\s\S]{0,200}\} catch \(error\) \{\s*row\.autoStaleError = /);
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
