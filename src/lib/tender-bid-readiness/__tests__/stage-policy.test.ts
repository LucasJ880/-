/**
 * TI-3b 阶段策略表（纯逻辑 + 源码断言）
 * 运行：npx tsx src/lib/tender-bid-readiness/__tests__/stage-policy.test.ts
 * 对应 Lucas 2026-11-11 的要求：只读的事不再逐项询问，只有对外动作才停。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_INTEL_SOURCES, type IntelSource } from "@/lib/tender-competition/source-status";
import { decideStages, MATERIAL_KEYS, STAGE_DECISIONS, TENDER_INTEL_STAGES, type MaterialKey } from "../stage-policy";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const run = (materials: MaterialKey[], o: { sources?: IntelSource[]; overrides?: Record<string, "OFF" | "AUTO"> } = {}) => {
  const r = decideStages({ materials, ...o });
  assert.ok(r.ok);
  return r;
};
const decisionOf = (r: ReturnType<typeof run>, key: string) => r.stages.find((s) => s.key === key)!.decision;
const APPROVAL = ["owner_decision", "supplier_outreach", "records_request", "submission"];

console.log("tender-bid-readiness stage-policy");

{
  ok("恰有 13 个阶段，各有一类", TENDER_INTEL_STAGES.length === 13 && new Set(TENDER_INTEL_STAGES.map((s) => s.key)).size === 13);
  ok("要批准的恰为 Owner 决定、供应商外联、政府资料申请、提交", TENDER_INTEL_STAGES.filter((s) => s.stageClass === "APPROVAL").map((s) => s.key).join() === APPROVAL.join());
  ok("决定的取值是封闭的六个，其中没有「询问」", STAGE_DECISIONS.join() === "RUN,WAIT_MATERIAL,NOT_CONNECTED,MANUAL_ONLY,STOP_FOR_APPROVAL,OFF" && !STAGE_DECISIONS.some((d) => /ASK|CONFIRM|PROMPT/i.test(d)));
}
{
  const r = run(["TENDER_DOCUMENTS", "DOCUMENT_HOLDER_LIST", "SUPPLIER_QUOTES"]);
  ok("材料齐备：六个只读阶段全部直接执行", ["intake", "document_holders", "supplier_matching", "compliance", "costing", "bid_preparation"].every((k) => decisionOf(r, k) === "RUN"));
  ok("每个阶段恰有一个决定，且都在六个取值之内", r.stages.length === 13 && r.stages.every((s) => (STAGE_DECISIONS as readonly string[]).includes(s.decision)));
  const noHolders = run(["TENDER_DOCUMENTS", "SUPPLIER_QUOTES"]);
  const dh = noHolders.stages.find((s) => s.key === "document_holders")!;
  ok("没有领取方名单 → 该阶段等材料，写明缺什么", dh.decision === "WAIT_MATERIAL" && dh.detailZh.includes("文件领取方名单"));
  ok("缺材料不阻塞其它阶段：合规对照与成本核算仍执行", decisionOf(noHolders, "compliance") === "RUN" && decisionOf(noHolders, "costing") === "RUN");
}
{
  const r = run(["TENDER_DOCUMENTS"]);
  const leads = r.stages.find((s) => s.key === "import_leads")!;
  ok("贸易数据未接通 → 进口线索阶段为未接通，不是执行", leads.decision === "NOT_CONNECTED" && leads.detailZh.includes("授权贸易") && leads.detailZh.includes("没有查"));
  const manual = run(["TENDER_DOCUMENTS", "IMPORT_LEADS"]);
  ok("人工录入了进口线索 → 执行（只处理已录入的）", decisionOf(manual, "import_leads") === "RUN" && manual.stages.find((s) => s.key === "import_leads")!.detailZh.includes("人工提供"));
  const connected = run(["TENDER_DOCUMENTS"], { sources: DEFAULT_INTEL_SOURCES.map((s) => (s.key === "LICENSED_TRADE_DATA" ? { ...s, configuredState: "CONNECTED" as const } : s)) });
  ok("贸易数据已接通 → 直接执行，不询问", decisionOf(connected, "import_leads") === "RUN");
  ok("官方授标缺省仅人工、没有人工记录 → 仅人工", decisionOf(r, "historical_awards") === "MANUAL_ONLY");
  const portal = run(["TENDER_DOCUMENTS"], { sources: DEFAULT_INTEL_SOURCES.map((s) => (s.key === "OFFICIAL_AWARDS" ? { ...s, access: "AUTHENTICATED_PORTAL" as const, configuredState: "CONNECTED" as const } : s)) });
  ok("来源若是需要登录的门户 → 阶段已关闭", decisionOf(portal, "historical_awards") === "OFF");
}
{
  const all = run([...MATERIAL_KEYS], { sources: DEFAULT_INTEL_SOURCES.filter((s) => s.access !== "AUTHENTICATED_PORTAL").map((s) => ({ ...s, configuredState: "CONNECTED" as const })) });
  ok("材料齐备、来源全接通：四个要批准的阶段仍然停下", APPROVAL.every((k) => decisionOf(all, k) === "STOP_FOR_APPROVAL"));
  ok("其余九个阶段全部执行", all.stages.filter((s) => !APPROVAL.includes(s.key)).every((s) => s.decision === "RUN"));
}
{
  const r = run(["TENDER_DOCUMENTS", "DOCUMENT_HOLDER_LIST"]);
  ok("渥太华缺省情形：缺材料清单含供应商报价", r.lists.missingMaterials.some((m) => m.stageKey === "costing" && m.materials.includes("供应商报价")));
  ok("未接通清单含授权贸易数据", r.lists.notConnected.some((n) => n.sourceKey === "LICENSED_TRADE_DATA" && n.stateZh === "未接通"));
  ok("等批准清单恰为四项", r.lists.awaitingApproval.map((a) => a.stageKey).join() === APPROVAL.join());
  ok("三张清单一次列全：缺材料 2、未接通 / 仅人工 2、等批准 4", r.lists.missingMaterials.length === 2 && r.lists.notConnected.length === 2 && r.lists.awaitingApproval.length === 4);
}
{
  const off = run(["TENDER_DOCUMENTS"], { overrides: { import_leads: "OFF" } });
  ok("组织关闭进口线索阶段 → 已关闭，不出现在未接通清单里", decisionOf(off, "import_leads") === "OFF" && !off.lists.notConnected.some((n) => n.stageKey === "import_leads"));
  const offApproval = run(["TENDER_DOCUMENTS"], { overrides: { supplier_outreach: "OFF" } });
  ok("要批准的阶段可以被关闭（收紧）", decisionOf(offApproval, "supplier_outreach") === "OFF" && offApproval.lists.awaitingApproval.length === 3);
  const auto = decideStages({ materials: ["TENDER_DOCUMENTS"], overrides: { supplier_outreach: "AUTO" } });
  ok("把供应商外联设为自动 → 拒绝并说明", !auto.ok && auto.code === "APPROVAL_STAGE_CANNOT_BE_AUTO" && auto.messageZh.includes("不能改成自动"));
  ok("提交、政府资料申请、Owner 决定同样不能设为自动", ["submission", "records_request", "owner_decision"].every((k) => { const x = decideStages({ materials: [], overrides: { [k]: "AUTO" } }); return !x.ok && x.code === "APPROVAL_STAGE_CANNOT_BE_AUTO"; }));
  const unknown = decideStages({ materials: [], overrides: { customs_lookup: "OFF" } });
  ok("未知的阶段名 → 拒绝", !unknown.ok && unknown.code === "UNKNOWN_STAGE");
  ok("对只读阶段设 AUTO 不改变结果", decisionOf(run(["TENDER_DOCUMENTS"], { overrides: { compliance: "AUTO" } }), "compliance") === "RUN");
}
{
  const text = readFileSync(join(process.cwd(), "src/lib/tender-bid-readiness/stage-policy.ts"), "utf8");
  const banned = /@\/lib\/db\b|@\/lib\/ai\b|\bfetch\s*\(|createCompletion|workforce-runtime|agent-runtime|\/cron\/|setTimeout|setInterval|sendGmail|requestApproval/;
  ok("阶段策略没有数据库 / 网络 / 模型 / 运行时 / 定时任务的引用", !banned.test(text));
}

console.log(`\ntender-bid-readiness stage-policy: ${passed} passed`);
