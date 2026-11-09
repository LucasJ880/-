/**
 * T-1 询价进展通知 — 执行测试（注入 deps，无 DB）
 * - 催单扫描：runForItems 真跑 decideChases → 一轮多张卡只调一次 onRoundDrafted（带齐 3 张卡、缺字段、催单天数）；
 *   未响应带轮次上下文；起草失败的卡不进通知；本轮全失败不调
 * - 投递：notifyInboundTracking / notifyChaseRoundDrafted / notifyChaseNoResponse 经 deliverCollabNotification 写入，
 *   负责人 = 发起人只一条、发起人不在组织只发负责人、重跑不重复、上下文 / 写库出错被吞掉
 * 运行：npx tsx src/lib/tender-rfq/__tests__/tracking-notify.test.ts
 */
import assert from "node:assert/strict";
import type { CollabDeliverDeps, CollabNotificationRow } from "@/lib/notifications/collab/deliver";
import { runForItems, type ChaseRoundDrafted, type ChaseRunDeps, type LoadedItem } from "../chase-service";
import type { ChaseNote } from "../chase-pure";
import { notifyChaseNoResponse, notifyChaseRoundDrafted, notifyInboundTracking, type InboundTrackingContext } from "../tracking-notify";
import { chaseReadyNotice, type RoundRef } from "../tracking-notify-pure";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const DAY = 86_400_000;
const NOW = new Date("2026-11-10T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function loaded(o: {
  itemId: string;
  inquiryId: string;
  supplierName: string;
  status: string;
  roundNumber: number;
  chases?: ChaseNote[];
  quote?: Partial<LoadedItem["snapshot"]["quote"]>;
}): LoadedItem {
  return {
    snapshot: {
      itemId: o.itemId,
      inquiryId: o.inquiryId,
      projectId: "proj-1",
      supplierName: o.supplierName,
      status: o.status,
      sentAt: daysAgo(5),
      threadId: `thread-${o.itemId}`,
      chases: o.chases ?? [],
      cards: [],
      quote: { unitPrice: null, totalPrice: null, deliveryDays: null, validUntil: null, quoteNotes: null, updatedAt: daysAgo(1), ...o.quote },
    },
    supplierEmail: `${o.itemId}@supplier.example`,
    inquiryId: o.inquiryId,
    roundDueDate: null,
    projectName: "Alberta 露营装备",
    ownerId: "owner-1",
    roundNumber: o.roundNumber,
    roundCreatorId: "creator-1",
  };
}

function runDeps(opts: { failFor?: Set<string> } = {}) {
  const marked: string[] = [];
  let n = 0;
  const deps: ChaseRunDeps = {
    loadOrgSettingsJson: async () => ({}),
    markItemNoResponse: async (scope) => {
      marked.push(scope.itemId);
    },
    loadRfqMail: async () => new Map(),
    requestApproval: (async (input: { idempotencyKey?: string }) => {
      const key = input.idempotencyKey ?? "";
      if ([...(opts.failFor ?? [])].some((id) => key.includes(`:${id}:`))) {
        return { ok: false, kind: "pending_action", errorCode: "DRAFT_CREATION_FAILED", error: "boom" };
      }
      n += 1;
      return { ok: true, kind: "pending_action", actionIds: [`act-${n}`], normalizedRisk: {} };
    }) as unknown as ChaseRunDeps["requestApproval"],
  };
  return { deps, marked };
}

async function main() {
  console.log("催单扫描：一轮一次 onRoundDrafted");
  {
    const items = [
      loaded({ itemId: "it-c", inquiryId: "inq-2", supplierName: "丙厂", status: "sent", roundNumber: 2 }),
      loaded({ itemId: "it-d", inquiryId: "inq-2", supplierName: "丁厂", status: "sent", roundNumber: 2 }),
      // 入站写下的 [auto] 段说缺有效期（与 chase-pure.test 同一写法）→ 追问
      loaded({
        itemId: "it-a",
        inquiryId: "inq-2",
        supplierName: "甲厂",
        status: "quoted",
        roundNumber: 2,
        quote: {
          unitPrice: "12.5",
          deliveryDays: 30,
          quoteNotes: "[auto 2026-11-08T08:00:00.000Z msg=gm-a] 单价=12.5；起订量=500；贸易条款=FOB；缺：有效期",
          updatedAt: new Date("2026-11-08T08:00:05Z"),
        },
      }),
      loaded({
        itemId: "it-e",
        inquiryId: "inq-2",
        supplierName: "戊厂",
        status: "sent",
        roundNumber: 2,
        chases: [
          { index: 1, kind: "no_reply", messageId: "c1", at: daysAgo(10) },
          { index: 2, kind: "no_reply", messageId: "c2", at: daysAgo(5) },
        ],
      }),
      loaded({ itemId: "it-f", inquiryId: "inq-3", supplierName: "己厂", status: "sent", roundNumber: 3 }),
    ];
    const rounds: ChaseRoundDrafted[] = [];
    const noResp: Array<{ itemId: string; reason: string; supplierName: string; roundNumber: number; roundCreatorId: string }> = [];
    const { deps, marked } = runDeps();
    const out = await runForItems(
      "org-1",
      items,
      NOW,
      {
        manual: false,
        onRoundDrafted: async (r) => {
          rounds.push(r);
        },
        onNoResponse: async (itemId, reason, ctx) => {
          noResp.push({ itemId, reason, supplierName: ctx.supplierName, roundNumber: ctx.roundNumber, roundCreatorId: ctx.roundCreatorId });
        },
      },
      deps,
    );
    ok("一共起草 4 张卡（第 2 轮 3 张、第 3 轮 1 张）", out.drafted.length === 4, out.drafted);
    ok("两轮各调一次 onRoundDrafted", rounds.length === 2, rounds.map((r) => r.inquiryId));
    const r2 = rounds.find((r) => r.inquiryId === "inq-2")!;
    ok("第 2 轮：一次带齐 3 张卡", r2?.cards.length === 3, r2?.cards);
    ok("第 2 轮：2 封催单 + 1 封追问", r2.cards.filter((c) => c.kind === "no_reply").length === 2 && r2.cards.filter((c) => c.kind === "missing_fields").length === 1);
    ok("追问卡带缺字段（有效期）", r2.cards.find((c) => c.kind === "missing_fields")!.missingFields.join() === "validUntil", r2.cards);
    ok("每张卡带审批卡 id", r2.cards.every((c) => c.actionId.startsWith("act-")));
    ok("轮次上下文：序号、项目、负责人、发起人", r2.roundNumber === 2 && r2.projectId === "proj-1" && r2.projectName === "Alberta 露营装备" && r2.ownerId === "owner-1" && r2.roundCreatorId === "creator-1");
    ok("轮次上下文：催单天数 = decideChases 用的默认 3 天", r2.days === 3);
    ok("第 3 轮：1 张卡", rounds.find((r) => r.inquiryId === "inq-3")?.cards.length === 1);
    ok("催满两次的戊厂标未响应", marked.join() === "it-e" && out.noResponse.length === 1);
    ok("onNoResponse 带供应商名与轮次上下文", noResp.length === 1 && noResp[0].supplierName === "戊厂" && noResp[0].reason === "two_chases" && noResp[0].roundNumber === 2 && noResp[0].roundCreatorId === "creator-1", noResp);
    const notice = chaseReadyNotice({ round: { inquiryId: r2.inquiryId, projectId: r2.projectId, projectName: r2.projectName, roundNumber: r2.roundNumber }, days: r2.days, cards: r2.cards })!;
    ok("把第 2 轮交给文案：一条「3 封催单 / 追问已起草」", notice.title === "3 封催单 / 追问已起草，等你批准 · Alberta 露营装备", notice.title);
  }
  {
    const items = [
      loaded({ itemId: "it-c", inquiryId: "inq-2", supplierName: "丙厂", status: "sent", roundNumber: 2 }),
      loaded({ itemId: "it-d", inquiryId: "inq-2", supplierName: "丁厂", status: "sent", roundNumber: 2 }),
    ];
    const rounds: ChaseRoundDrafted[] = [];
    const { deps } = runDeps({ failFor: new Set(["it-d"]) });
    const out = await runForItems("org-1", items, NOW, { manual: false, onRoundDrafted: async (r) => { rounds.push(r); } }, deps);
    ok("起草失败的卡不进通知", rounds.length === 1 && rounds[0].cards.map((c) => c.itemId).join() === "it-c" && out.failed.length === 1);
    const rounds2: ChaseRoundDrafted[] = [];
    const { deps: deps2 } = runDeps({ failFor: new Set(["it-c", "it-d"]) });
    await runForItems("org-1", items, NOW, { manual: false, onRoundDrafted: async (r) => { rounds2.push(r); } }, deps2);
    ok("本轮全部起草失败 → 不调 onRoundDrafted", rounds2.length === 0);
    const rounds3: ChaseRoundDrafted[] = [];
    const fresh = items.map((i) => ({ ...i, snapshot: { ...i.snapshot, sentAt: daysAgo(1) } }));
    await runForItems("org-1", fresh, NOW, { manual: false, onRoundDrafted: async (r) => { rounds3.push(r); } }, runDeps().deps);
    ok("没到催单天数 → 不起草、不调", rounds3.length === 0);
  }

  console.log("投递（注入 deps）");
  const round: RoundRef = { inquiryId: "inq-2", projectId: "proj-1", projectName: "Alberta 露营装备", roundNumber: 2 };
  function deliverDeps(o: { active?: string[]; members?: string[]; failCreate?: boolean } = {}) {
    const rows: CollabNotificationRow[] = [];
    const errors: string[] = [];
    const active = new Set(o.active ?? ["A", "B"]);
    const members = new Set(o.members ?? ["A", "B"]);
    const deps: CollabDeliverDeps = {
      findActiveUserIds: async (ids) => ids.filter((id) => active.has(id)),
      findActiveMemberIds: async (_org, ids) => ids.filter((id) => members.has(id)),
      shouldDeliver: async () => true,
      findBySourceKey: async (key) => (rows.some((r) => r.sourceKey === key) ? { id: key } : null),
      createNotification: async (row) => {
        if (o.failCreate) throw new Error("db down");
        rows.push(row);
        return { id: row.sourceKey };
      },
      logError: (m) => {
        errors.push(m);
      },
    };
    return { deps, rows, errors };
  }
  const ctx = (ownerId: string | null, roundCreatorId: string | null): InboundTrackingContext => ({ round, supplierName: "甲厂", ownerId, roundCreatorId });
  {
    const d = deliverDeps();
    await notifyInboundTracking(
      { orgId: "org-1", itemId: "it-a", transition: "quoted", messageId: "m-1", missingFields: ["validUntil"] },
      { loadContext: async () => ctx("A", "A"), deliver: d.deps },
    );
    ok("负责人 = 发起人：只建一条", d.rows.length === 1 && d.rows[0].userId === "A", d.rows);
    const row = d.rows[0];
    ok("报价通知：类型、对象、项目", row.type === "rfq_quote_received" && row.entityType === "tender_rfq_round" && row.entityId === "inq-2" && row.projectId === "proj-1" && row.orgId === "org-1");
    ok("报价通知：标题与摘要", row.title === "甲厂报价了 · Alberta 露营装备" && row.summary === "第 2 轮询价：报价已自动进表；还缺：有效期。", row);
    ok("报价通知：去重键 = 前缀 + 收件人", row.sourceKey === "rfq_quote_received:it-a:m-1:A");
    ok("报价通知：metadata 只有对象名", row.metadata === JSON.stringify({ objectLabel: "项目「Alberta 露营装备」第 2 轮询价" }));
    ok("系统触发：负责人没有被当作操作人排除", d.rows.some((r) => r.userId === "A"));
    await notifyInboundTracking(
      { orgId: "org-1", itemId: "it-a", transition: "quoted", messageId: "m-1", missingFields: ["validUntil"] },
      { loadContext: async () => ctx("A", "A"), deliver: d.deps },
    );
    ok("同一封回信再处理一次 → 不重复", d.rows.length === 1);
  }
  {
    const d = deliverDeps({ members: ["A"] });
    await notifyInboundTracking({ orgId: "org-1", itemId: "it-b", transition: "replied", messageId: "m-2", missingFields: [] }, { loadContext: async () => ctx("A", "B"), deliver: d.deps });
    ok("发起人已不是 active 成员：只发负责人", d.rows.map((r) => r.userId).join() === "A");
    ok("回信通知类型", d.rows[0]?.type === "rfq_reply_received" && d.rows[0].title === "甲厂回信了，没有报价 · Alberta 露营装备");
  }
  {
    const d = deliverDeps();
    await notifyInboundTracking({ orgId: "org-1", itemId: "it-b", transition: "replied", messageId: "m-3", missingFields: [] }, { loadContext: async () => ctx("A", "B"), deliver: d.deps });
    ok("负责人与发起人不同：各一条", d.rows.map((r) => r.userId).sort().join() === "A,B");
  }
  {
    const d = deliverDeps();
    await notifyInboundTracking({ orgId: "org-1", itemId: "gone", transition: "quoted", messageId: "m-4", missingFields: [] }, { loadContext: async () => null, deliver: d.deps });
    ok("查不到询价项 → 不写、不抛错", d.rows.length === 0);
    let threw = false;
    try {
      await notifyInboundTracking({ orgId: "org-1", itemId: "it-a", transition: "quoted", messageId: "m-5", missingFields: [] }, { loadContext: async () => { throw new Error("db down"); }, deliver: d.deps });
    } catch {
      threw = true;
    }
    ok("补上下文出错 → 吞掉，不抛给入站", !threw && d.rows.length === 0);
    const f = deliverDeps({ failCreate: true });
    await notifyInboundTracking({ orgId: "org-1", itemId: "it-a", transition: "quoted", messageId: "m-6", missingFields: [] }, { loadContext: async () => ctx("A", "B"), deliver: f.deps });
    ok("写通知出错 → 只记错误", f.rows.length === 0 && f.errors.length === 2);
  }
  {
    const d = deliverDeps();
    const cards = [
      { actionId: "a1", supplierName: "丙厂", kind: "no_reply" as const, missingFields: [] },
      { actionId: "a2", supplierName: "丁厂", kind: "no_reply" as const, missingFields: [] },
    ];
    await notifyChaseRoundDrafted({ orgId: "org-1", round, ownerId: "A", days: 3, cards }, d.deps);
    ok("催单待批：只给负责人一条", d.rows.length === 1 && d.rows[0].userId === "A" && d.rows[0].type === "rfq_chase_ready" && d.rows[0].priority === "high");
    await notifyChaseRoundDrafted({ orgId: "org-1", round, ownerId: "A", days: 3, cards: [...cards].reverse() }, d.deps);
    ok("同一批卡（顺序不同）再触发 → 不重复", d.rows.length === 1);
    await notifyChaseRoundDrafted({ orgId: "org-1", round, ownerId: "A", days: 3, cards: [] }, d.deps);
    ok("没有新卡 → 不写", d.rows.length === 1);
  }
  {
    const d = deliverDeps();
    await notifyChaseNoResponse({ orgId: "org-1", round, ownerId: "A", roundCreatorId: "B", itemId: "it-e", supplierName: "戊厂", reason: "two_chases" }, d.deps);
    ok("未响应：负责人与发起人各一条", d.rows.map((r) => r.userId).sort().join() === "A,B" && d.rows.every((r) => r.type === "rfq_no_response"));
    ok("未响应：去重键按询价项", d.rows.map((r) => r.sourceKey).sort().join() === "rfq_no_response:it-e:A,rfq_no_response:it-e:B");
  }

  console.log(`\nT-1 tracking-notify: ${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
