/**
 * TI-4a 投标工作区契约与开关（纯逻辑 + 源码断言）
 * 运行：npx tsx src/lib/tender-bid-workspace/__tests__/workspace-contract.test.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  blocksIn, costSheetRequestSchema, mergeWorkspace, readStoredWorkspace, saveWorkspaceRequestSchema, storedWorkspaceSchema, BID_WORKSPACE_KEY, MAX_SCHEDULE_LINES,
} from "../contract";
import { isBidWorkspaceEnabledForOrgWithEnv } from "../flags";
import { OTTAWA_18026_LINES } from "@/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const now = new Date("2026-11-11T15:00:00Z");

console.log("tender-bid-workspace contract");

{
  ok("开关未设 → 关", !isBidWorkspaceEnabledForOrgWithEnv("org_a", env({})));
  ok("开关为假 → 关", !isBidWorkspaceEnabledForOrgWithEnv("org_a", env({ TENDER_BID_WORKSPACE_ENABLED: "0" })));
  ok("开关打开、白名单为空 → 对所有组织生效", isBidWorkspaceEnabledForOrgWithEnv("org_a", env({ TENDER_BID_WORKSPACE_ENABLED: "1" })));
  ok("组织不在白名单 → 关", !isBidWorkspaceEnabledForOrgWithEnv("org_a", env({ TENDER_BID_WORKSPACE_ENABLED: "true", TENDER_BID_WORKSPACE_ORG_ALLOWLIST: "org_b, org_c" })));
  ok("组织在白名单 → 开", isBidWorkspaceEnabledForOrgWithEnv("org_b", env({ TENDER_BID_WORKSPACE_ENABLED: "true", TENDER_BID_WORKSPACE_ORG_ALLOWLIST: "org_b, org_c" })));
  ok("没有组织 → 关", !isBidWorkspaceEnabledForOrgWithEnv(null, env({ TENDER_BID_WORKSPACE_ENABLED: "1" })));
}
{
  const req = saveWorkspaceRequestSchema.safeParse({ priceSchedule: { lines: OTTAWA_18026_LINES } });
  assert.ok(req.success);
  ok("渥太华 18 行通过保存校验", req.data.priceSchedule?.lines.length === 18 && blocksIn(req.data).join() === "priceSchedule");
  const stored = mergeWorkspace(null, req.data, "user_1", now);
  ok("首次保存得到完整形状", storedWorkspaceSchema.safeParse(stored).success && stored.version === 1 && stored.updatedById === "user_1" && stored.documentHolders === null);
  const holders = { solicitationId: "18026-93121-T01", portal: "MERX", sourceKind: "USER_UPLOAD_SCREENSHOT" as const, capturedAt: "2026-11-06T10:00:00-05:00", entries: [{ name: "A Co." }] };
  const second = mergeWorkspace(stored, { documentHolders: holders }, "user_2", now);
  ok("分块合并：只给领取方名单，价格表保持原值", second.priceSchedule.lines.length === 18 && second.documentHolders?.entries.length === 1 && second.updatedById === "user_2");
  const cleared = mergeWorkspace(second, { documentHolders: null }, "user_2", now);
  ok("显式给 null 才清空该块", cleared.documentHolders === null && cleared.priceSchedule.lines.length === 18);
  ok("从情报室 JSON 读回本键", readStoredWorkspace({ pricingInputs: { ourCostCad: 1 }, [BID_WORKSPACE_KEY]: second })?.priceSchedule.lines.length === 18);
  ok("键不存在或形状不对 → null，不抛", readStoredWorkspace({}) === null && readStoredWorkspace({ [BID_WORKSPACE_KEY]: { version: 9 } }) === null && readStoredWorkspace(null) === null);
}
{
  const badQty = saveWorkspaceRequestSchema.safeParse({ priceSchedule: { lines: [{ ...OTTAWA_18026_LINES[0], quantity: { n: 1 } }] } });
  ok("数量写成对象 → 校验失败", !badQty.success);
  const tooMany = saveWorkspaceRequestSchema.safeParse({ priceSchedule: { lines: Array.from({ length: MAX_SCHEDULE_LINES + 1 }, (_, i) => ({ ...OTTAWA_18026_LINES[0], lineNo: i + 1 })) } });
  ok("超过 300 行 → 校验失败", !tooMany.success);
  const smuggled = saveWorkspaceRequestSchema.safeParse({
    orgId: "org_other", userId: "user_other",
    priceSchedule: { lines: [{ ...OTTAWA_18026_LINES[0], unitPrice: "6.00", supplierQuote: { unitPrice: "6.00" }, costCad: 99 }] },
    costScenario: { lines: [] }, pricing: { targetMarginPct: 25 },
  });
  assert.ok(smuggled.success);
  const text = JSON.stringify(smuggled.data);
  ok("夹带的成本字段与组织 / 用户标识被剥除", !/unitPrice|supplierQuote|costCad|costScenario|pricing|org_other|user_other/.test(text));
  ok("已存契约的顶层键恰为七个，其中没有成本、报价、毛利字段",
    Object.keys(storedWorkspaceSchema.shape).join() === "version,priceSchedule,lineDetails,documentHolders,addenda,updatedAt,updatedById"
    && !/unitPrice|cost|margin|markup|quote|fx|duty|freight/i.test(Object.keys(storedWorkspaceSchema.shape).join(",")));
  const badCert = saveWorkspaceRequestSchema.safeParse({ lineDetails: { "13": { certificates: [{ id: "C1", status: "MAYBE", coverage: "WHOLE_UNIT", issuerAccreditedInCanada: true, coveredModels: [] }] } } });
  ok("证书状态不在目录内 → 校验失败", !badCert.success);
  const badKey = saveWorkspaceRequestSchema.safeParse({ lineDetails: { "line-13": {} } });
  ok("行项详情的键不是行号 → 校验失败", !badKey.success);
}
{
  const cost = costSheetRequestSchema.safeParse({
    lines: [{ lineNo: 1, sourcing: "IMPORT", quote: { unitPrice: "6.00", basis: "PER_PIECE", currency: "USD", evidenceKind: "SIGNED_QUOTE" }, fx: { rateCadPerUnit: "1.40", source: "MANUAL", asOf: "2026-11-01" }, duty: { ratePct: "18" } }],
    importGst: { ratePct: "5", itcEligible: true }, pricing: { method: "MARGIN_ON_PRICE", targetMarginPct: "25" },
  });
  ok("成本核算请求通过校验", cost.success);
  ok("采购类型不在目录内 → 失败", !costSheetRequestSchema.safeParse({ lines: [{ lineNo: 1, sourcing: "DROPSHIP", quote: null }], importGst: { ratePct: 5, itcEligible: true }, pricing: { method: "MARGIN_ON_PRICE", targetMarginPct: 25 } }).success);
}
{
  const root = process.cwd();
  const lib = join(root, "src/lib/tender-bid-workspace");
  const files = [
    ...readdirSync(lib).filter((f) => f.endsWith(".ts")).map((f) => join(lib, f)),
    join(root, "src/app/api/projects/[id]/bid-workspace/route.ts"),
    join(root, "src/app/api/projects/[id]/bid-workspace/cost-sheet/route.ts"),
  ].map((p) => ({ p, text: readFileSync(p, "utf8") }));
  // 目录里后续新增的模块文件自动进入下面的扫描（TI-4b 起不再写死文件数）
  const names = files.map((f) => f.p.slice(root.length + 1));
  ok("TI-4a 的四个模块文件与两个路由文件都在扫描范围内", ["contract.ts", "flags.ts", "store.ts", "workspace-view.ts"].every((n) => names.includes(`src/lib/tender-bid-workspace/${n}`)) && names.filter((n) => n.endsWith("/route.ts")).length === 2);
  const banned = /sendGmail|google-email|requestApproval|pending-actions|@\/lib\/ai\b|createCompletion|\bfetch\s*\(\s*["'`h]|resend/i;
  ok("没有发信、建立审批、模型调用或外部网络请求的引用", files.every((f) => !banned.test(f.text)));
  const costRoute = files.find((f) => f.p.endsWith("cost-sheet/route.ts"))!.text;
  ok("成本核算路由不写库", !/\.(create|update|upsert|delete)\s*\(|saveWorkspaceBlocks|\$transaction/.test(costRoute));
  ok("成本核算路由检查财务查看权", costRoute.includes("resolveFinancePrivilege") && costRoute.includes("canReadAll"));
}

console.log(`\ntender-bid-workspace contract: ${passed} passed`);
