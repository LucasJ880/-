/**
 * RFQ-AUTO-2 自动起草第 1 轮询价 — 纯逻辑测试（开关 / 判定 / 选供应商 / 对外结果）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/auto-draft-pure.test.ts
 */
import assert from "node:assert/strict";
import { isRfqAutoDraftEnabledForOrgWithEnv } from "../auto-draft-flags";
import {
  AUTO_DRAFT_MAX_SUPPLIERS, AUTO_DRAFT_REASONS, AUTO_DRAFT_TOOL_NAME, AUTO_DRAFT_TRIGGERS,
  AUTO_DRAFT_NOTE_FALLBACK, autoDraftBlocked, autoDraftDone, autoDraftedRoundNotes, autoDraftPreviewLineZh, decideAutoDraft, pickAutoDraftSuppliers,
  type AutoDraftFacts, type AutoDraftReason, type AutoDraftSupplierInput,
} from "../auto-draft-pure";
import { partitionSuppliers } from "../round-pure";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

/* ---------- 开关 ---------- */
console.log("开关");
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
ok("默认关", !isRfqAutoDraftEnabledForOrgWithEnv("org1", env({})));
ok("打开且没有白名单 → 对所有组织生效", isRfqAutoDraftEnabledForOrgWithEnv("org1", env({ TENDER_RFQ_AUTO_DRAFT_ENABLED: "1" })));
ok("白名单非空 → 只对名单内的组织生效", isRfqAutoDraftEnabledForOrgWithEnv("org1", env({ TENDER_RFQ_AUTO_DRAFT_ENABLED: "true", TENDER_RFQ_AUTO_DRAFT_ORG_ALLOWLIST: "org2, org1" })) && !isRfqAutoDraftEnabledForOrgWithEnv("org3", env({ TENDER_RFQ_AUTO_DRAFT_ENABLED: "true", TENDER_RFQ_AUTO_DRAFT_ORG_ALLOWLIST: "org2, org1" })));
ok("没有组织 → 关；RFQ-AUTO-1 的开关不影响本开关", !isRfqAutoDraftEnabledForOrgWithEnv(null, env({ TENDER_RFQ_AUTO_DRAFT_ENABLED: "1" })) && !isRfqAutoDraftEnabledForOrgWithEnv("org1", env({ TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED: "1" })));

/* ---------- 选供应商 ---------- */
console.log("选供应商");
const S = (id: string, o: Partial<AutoDraftSupplierInput> = {}): AutoDraftSupplierInput => ({ id, name: `厂 ${id}`, contactEmail: `${id}@supplier.test`, status: "active", ...o });
{
  const rows = [S("a"), S("b", { status: "inactive" }), S("c", { contactEmail: null }), S("d"), S("e", { contactEmail: "not-an-email" })];
  const r = pickAutoDraftSuppliers(["d", "b", "a", "c", "e", "ghost"], rows);
  ok("按保存的顺序取就绪的", r.picked.map((p) => p.id).join() === "d,a");
  ok("停用、没邮箱、邮箱格式不对、已被删除的都跳过并说明原因", r.skipped.map((s) => `${s.id}:${s.reason}`).join() === "b:inactive,c:no_email,e:no_email,ghost:not_found");
  ok("就绪规则与建轮次时的规则一致", partitionSuppliers(rows).ready.map((x) => x.id).sort().join() === [...r.picked.map((p) => p.id)].sort().join());
  ok("不在常用供应商里的不会被选（哪怕它就绪）", pickAutoDraftSuppliers(["a"], [S("a"), S("z")]).picked.map((p) => p.id).join() === "a");
  ok("没有常用供应商 → 一家都不选", pickAutoDraftSuppliers([], rows).picked.length === 0 && pickAutoDraftSuppliers([], rows).skipped.length === 0);
  const many = Array.from({ length: 10 }, (_, i) => S(`s${i}`));
  const capped = pickAutoDraftSuppliers(many.map((m) => m.id), many);
  ok("最多 8 家，超出的记为超出上限", AUTO_DRAFT_MAX_SUPPLIERS === 8 && capped.picked.length === 8 && capped.skipped.length === 2 && capped.skipped.every((s) => s.reason === "over_limit"));
  ok("重复的 id 只算一次", pickAutoDraftSuppliers(["a", "a"], [S("a")]).picked.length === 1);
}

/* ---------- 判定 ---------- */
console.log("判定");
const facts = (o: Partial<AutoDraftFacts> = {}): AutoDraftFacts => ({ flagEnabled: true, run: { isCurrent: true, status: "APPROVED" }, roundCount: 0, entryBlock: null, pickedSupplierCount: 3, ...o });
const reasonOf = (o: Partial<AutoDraftFacts>): AutoDraftReason | "DRAFT" => { const d = decideAutoDraft(facts(o)); return d.draft ? "DRAFT" : d.reason; };
ok("全部满足 → 起草", reasonOf({}) === "DRAFT");
const cases: Array<[string, Partial<AutoDraftFacts>, AutoDraftReason]> = [
  ["开关关闭", { flagEnabled: false }, "FLAG_OFF"],
  ["分析还在等待审核", { run: { isCurrent: true, status: "REVIEW_REQUIRED" } }, "RUN_NOT_APPROVED"],
  ["分析已被新的一份取代", { run: { isCurrent: false, status: "APPROVED" } }, "RUN_NOT_APPROVED"],
  ["项目已有轮次（含已取消的）", { roundCount: 1 }, "ROUND_EXISTS"],
  ["入口：有待批的发送卡", { entryBlock: "pending_approval" }, "ROUND_EXISTS"],
  ["入口：近期已发", { entryBlock: "recently_sent" }, "ROUND_EXISTS"],
  ["入口：没有已确认的要求", { entryBlock: "no_confirmed_requirements" }, "NO_CONFIRMED_REQUIREMENTS"],
  ["入口：询价单含不能外发的内容", { entryBlock: "sensitive_leak" }, "SENSITIVE_LEAK"],
  ["入口：授权邮箱未连接", { entryBlock: "sender_not_connected" }, "SENDER_NOT_READY"],
  ["入口：授权邮箱缺发信权限", { entryBlock: "sender_no_compose_scope" }, "SENDER_NOT_READY"],
  ["入口：组织里没有就绪的供应商", { entryBlock: "no_ready_suppliers" }, "NO_DEFAULT_SUPPLIERS"],
  ["操作者没有就绪的常用供应商", { pickedSupplierCount: 0 }, "NO_DEFAULT_SUPPLIERS"],
];
for (const [name, o, reason] of cases) ok(`${name} → 不起草（${reason}）`, reasonOf(o) === reason);
ok("检查顺序固定：先看分析，再看轮次，再看入口与供应商", reasonOf({ flagEnabled: false, run: { isCurrent: false, status: "x" }, roundCount: 1 }) === "FLAG_OFF" && reasonOf({ run: { isCurrent: true, status: "REVIEW_REQUIRED" }, roundCount: 1 }) === "RUN_NOT_APPROVED" && reasonOf({ roundCount: 1, entryBlock: "sensitive_leak" }) === "ROUND_EXISTS" && reasonOf({ entryBlock: "sensitive_leak", pickedSupplierCount: 0 }) === "SENSITIVE_LEAK");
ok("批准时还有没确认的要求不拦起草（批准分析即视为审核完成；判定的输入里根本没有这一项）", !("pendingRequirementCount" in facts()) && reasonOf({}) === "DRAFT");
ok("判定是确定性的：同样的输入两次结果相同", JSON.stringify(decideAutoDraft(facts())) === JSON.stringify(decideAutoDraft(facts())));
ok("八个原因：除起草失败（执行阶段才有）外都被判定用例覆盖", AUTO_DRAFT_REASONS.length === 8 && AUTO_DRAFT_REASONS.filter((r) => r !== "DRAFT_FAILED").every((r) => cases.some((c) => c[2] === r)));

/* ---------- 对外结果 ---------- */
console.log("对外结果");
{
  const done = autoDraftDone({ projectId: "p 1", inquiryId: "q1", roundNumber: 1, supplierCount: 3, skippedCount: 1, unconfirmedCount: 4 });
  ok("起草了：轮次号、家数、跳过的家数、链接到这一轮", done.drafted && done.roundNumber === 1 && done.supplierCount === 3 && done.skippedCount === 1 && done.href === "/projects/p%201?tab=bid#rfq-round-q1" && !done.quiet);
  ok("起草了：说明里写明还没有发出、批准后才发，并提到跳过的家数", done.messageZh.includes("还没有发出，批准后才发") && done.messageZh.includes("3 家常用供应商") && done.messageZh.includes("1 家"));
  const clean = autoDraftDone({ projectId: "p", inquiryId: "q", roundNumber: 1, supplierCount: 2, skippedCount: 0, unconfirmedCount: 0 });
  ok("没有跳过时不提跳过；要求都确认了就不提「没带上」", !clean.messageZh.includes("跳过") && !clean.messageZh.includes("没带上"));
  ok("还有没确认的要求：写明询价单只带已确认的、有几条没带上", done.drafted && done.unconfirmedCount === 4 && done.messageZh.includes("只带已确认的要求") && done.messageZh.includes("另有 4 条没有确认的没带上"));
  ok("结果对象只有白名单里的字段", Object.keys(done).sort().join() === "drafted,href,messageZh,quiet,roundNumber,skippedCount,supplierCount,unconfirmedCount,withFollowUp");
  // RFQ-AUTO-3：卡上带跟进授权时结果里写明
  const withAuth = autoDraftDone({ projectId: "p", inquiryId: "q", roundNumber: 1, supplierCount: 2, skippedCount: 0, unconfirmedCount: 0, withFollowUp: true });
  ok("不带授权：标记为 false，说明里不提授权", done.drafted && done.withFollowUp === false && !done.messageZh.includes("授权") && clean.drafted && clean.withFollowUp === false);
  ok("带授权：标记为 true，说明里写明「批准它会一并批准后面的催单和追问」，仍写明还没有发出", withAuth.drafted && withAuth.withFollowUp === true && withAuth.messageZh.includes("这张卡带自动跟进授权：批准它会一并批准后面的催单和追问。") && withAuth.messageZh.endsWith("还没有发出，批准后才发。"));

  const blockedReasons = AUTO_DRAFT_REASONS.filter((r): r is Exclude<AutoDraftReason, "FLAG_OFF"> => r !== "FLAG_OFF");
  const all = blockedReasons.map((r) => autoDraftBlocked(r, { projectId: "p1", trigger: "approve_run" }));
  ok("没起草：每个原因都有一句中文说明", all.every((b) => !b.drafted && b.messageZh.length > 0));
  ok("没起草：结果对象只有白名单里的字段", all.every((b) => Object.keys(b).sort().join() === "action,drafted,messageZh,quiet,reason"));
  const by = (r: AutoDraftReason) => all.find((b) => !b.drafted && b.reason === r)!;
  const act = (r: AutoDraftReason) => { const b = by(r); return b.drafted ? null : b.action; };
  ok("没有常用供应商 → 去询价入口", act("NO_DEFAULT_SUPPLIERS")?.href === "/projects/p1?tab=bid" && by("NO_DEFAULT_SUPPLIERS").messageZh.includes("常用供应商"));
  ok("邮箱没连好 → 去连接邮箱", act("SENDER_NOT_READY")?.href === "/settings/email");
  ok("没有已确认的要求 / 含不能外发的内容 → 去「需求」", act("NO_CONFIRMED_REQUIREMENTS")?.href === "/projects/p1?tab=requirements" && act("SENSITIVE_LEAK")?.href === "/projects/p1?tab=requirements");
  ok("「分析未批准」在四种触发动作下都不提示（批准之前逐条确认 / 驳回时的常态）", AUTO_DRAFT_TRIGGERS.every((t) => autoDraftBlocked("RUN_NOT_APPROVED", { projectId: "p", trigger: t }).quiet));
  ok("「分析未批准」「已有轮次」不提示（审核过程中的常态）；其余原因都提示", by("RUN_NOT_APPROVED").quiet && by("ROUND_EXISTS").quiet && (["NO_CONFIRMED_REQUIREMENTS", "SENSITIVE_LEAK", "SENDER_NOT_READY", "NO_DEFAULT_SUPPLIERS", "DRAFT_FAILED"] as const).every((r) => !by(r).quiet));
  ok("说明里没有价格、估值、毛利之类的字样", [done, ...all].every((b) => !/毛利|估值|底价|\$|¥|CAD|CNY/.test(b.messageZh)));
}

/* ---------- 标记 ---------- */
console.log("标记");
{
  const line = autoDraftPreviewLineZh("Lucas", { confirmedCount: 5, unconfirmedCount: 2 });
  ok("摘要行写明供应商取自谁的常用供应商、带了几条已确认的要求、有几条没带上，并提醒核对后再批", line.includes("Lucas 的常用供应商") && line.includes("带了 5 条已确认的要求") && line.includes("另有 2 条没有确认的没带上") && line.includes("核对"));
  ok("要求都确认了：摘要行不提「没带上」；没有名字时写「操作者」", !autoDraftPreviewLineZh("", { confirmedCount: 3, unconfirmedCount: 0 }).includes("没带上") && autoDraftPreviewLineZh("", { confirmedCount: 3, unconfirmedCount: 0 }).includes("操作者"));
}
{
  const note = autoDraftPreviewLineZh("Lucas", { confirmedCount: 2, unconfirmedCount: 1 });
  const notes = autoDraftedRoundNotes([
    { payload: { inquiryId: "q1", metadata: { sourceToolName: AUTO_DRAFT_TOOL_NAME } }, preview: `第 1 轮 · 3 封\n发件 x\n${note}` },
    { payload: { inquiryId: "q2", metadata: { sourceToolName: "tender_send_rfq_web" } }, preview: note },
    { payload: { inquiryId: "q3" }, preview: note },
    { payload: null },
    { payload: { inquiryId: "q4", metadata: { sourceToolName: AUTO_DRAFT_TOOL_NAME } }, preview: "第 1 轮 · 3 封" },
  ]);
  ok("从审批卡认出自动起草的轮次：只认来源标记", Object.keys(notes).sort().join() === "q1,q4");
  ok("轮次上显示的说明就是卡摘要里的那一行（带了几条、有几条没带上）；取不到时用固定的兜底句", notes.q1.noteZh === note && notes.q1.noteZh.includes("另有 1 条没有确认的没带上") && notes.q4.noteZh === AUTO_DRAFT_NOTE_FALLBACK);
}

console.log(`\n✓ auto-draft-pure: ${passed} 项断言全部通过`);
