/**
 * VIS-1c 工具列表按模块过滤、营销工具入口门（spec agents/tool-authorization；change vis-1c-notify-settings-search）
 * 运行：npx tsx src/lib/agent-core/__tests__/tool-list-modules.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registry } from "../tool-registry";
import "../tools";
import { toolEntryGate } from "../entry-gate";
import { canInvokeTool, toolModulesSatisfied, toolRequiredModules } from "@/lib/tenancy/tool-auth";
import { DEFAULT_MENGXIN_MODULES, DEFAULT_SUNNY_MODULES } from "@/lib/tenancy/modules";
import { gateCtx } from "@/lib/navigation/__tests__/identity-fixtures";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** 去掉注释，避免注释里的字样干扰源码断言 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ALL = registry.list();
const MARKETING = ALL.filter((t) => t.name.startsWith("marketing_"));

/** 执行期模块判定：企业管理员、有成员身份、无其他策略时，唯一可能的拒绝就是模块 */
function executionModuleDenied(tool: (typeof ALL)[number], modulesJson: unknown): boolean {
  const decision = canInvokeTool({
    tenant: { userId: "u1", orgId: "org1", orgRole: "org_admin", isPlatformAdmin: false },
    hasMembership: true,
    tool,
    modulesJson,
  });
  return !decision.ok && decision.code === "module_disabled";
}

const MODULE_CASES: Record<string, unknown> = {
  未配置: undefined,
  空配置: { enabled: [] },
  只启用sales: { enabled: ["sales"] },
  Sunny: { enabled: [...DEFAULT_SUNNY_MODULES] },
  梦馨: { enabled: [...DEFAULT_MENGXIN_MODULES] },
  无marketing: { enabled: DEFAULT_SUNNY_MODULES.filter((m) => m !== "marketing") },
  只启用marketing: { enabled: ["marketing"] },
};

console.log("tool-list-modules（工具列表按模块过滤，与执行期同一映射）");
ok(ALL.length > 50 && MARKETING.length === 12, `注册表有工具（${ALL.length}），其中营销工具 12 个`, MARKETING.length);

console.log("\n列表 = 执行期（逐工具 × 模块组合）");
for (const [label, modulesJson] of Object.entries(MODULE_CASES)) {
  const listed = new Set(registry.list({ modulesJson }).map((t) => t.name));
  const mismatch = ALL.filter((t) => listed.has(t.name) === executionModuleDenied(t, modulesJson)).map((t) => t.name);
  ok(mismatch.length === 0, `${label}：列表里有 ⇔ 执行期不以 module_disabled 拒绝`, mismatch.slice(0, 5));
}

console.log("\n具体期望（不只靠同一函数自证）");
{
  const salesOnly = registry.list({ modulesJson: { enabled: ["sales"] } }).map((t) => t.name);
  const bad = salesOnly.filter((n) => n.startsWith("trade_") || n.startsWith("marketing_") || n.startsWith("project_"));
  ok(bad.length === 0, "只启用 sales：列表没有 trade_*、marketing_*、project_*", bad);
  ok(registry.list({ modulesJson: { enabled: ["sales"] } }).every((t) => t.domain !== "project" && t.domain !== "trade"), "只启用 sales：没有 project / trade 域工具");
  ok(salesOnly.some((n) => n.startsWith("sales_")), "只启用 sales：销售工具还在");
  ok(registry.list({ modulesJson: undefined }).length === ALL.length, "未配置模块：不按模块限制（与执行期相同）");
  ok(MARKETING.every((t) => JSON.stringify(toolRequiredModules(t.name, t.domain)) === '["marketing"]'), "marketing_* 所需模块为 marketing");
  ok(JSON.stringify(toolRequiredModules("product_content_x", "trade")) === '["product_content","trade"]', "product_content_* 所需模块不变");
  const noMkt = MODULE_CASES["无marketing"];
  ok(MARKETING.every((t) => !toolModulesSatisfied(t, noMkt)), "企业没开 marketing：营销工具都不满足（此前按 operations 会满足）");
  const growth = ALL.find((t) => t.name === "marketing_get_growth_summary");
  ok(!!growth && executionModuleDenied(growth, noMkt), "未启用营销模块：执行期授权 marketing_get_growth_summary 拒绝码为 module_disabled");
  ok(!!growth && !executionModuleDenied(growth, MODULE_CASES.Sunny) && !executionModuleDenied(growth, MODULE_CASES["梦馨"]), "Sunny 与梦馨都开着 marketing：执行期照常放行");
}

console.log("\n营销工具入口门（人类对话）");
{
  const sunnyMods = MODULE_CASES.Sunny;
  const salesList = registry.list({ role: "sales", modulesJson: sunnyMods, entryGate: toolEntryGate(gateCtx("sales_rep")) }).map((t) => t.name);
  ok(!salesList.some((n) => n.startsWith("marketing_")), "Sunny 只持 sales_rep：人类对话的列表没有 marketing_*");
  ok(!salesList.some((n) => n.startsWith("trade_")), "Sunny 只持 sales_rep：没有 trade_*（平台角色 sales 不在 trade 工具白名单）");
  const opsList = registry.list({ role: "user", modulesJson: sunnyMods, entryGate: toolEntryGate(gateCtx("ops_staff")) }).map((t) => t.name);
  ok(opsList.filter((n) => n.startsWith("marketing_")).length === 12, "Sunny 只持 ops_staff：有全部 12 个 marketing_*", opsList.filter((n) => n.startsWith("marketing_")).length);
  ok(toolEntryGate(gateCtx("super_admin")).marketing && toolEntryGate(gateCtx("owner")).marketing, "平台 super_admin 与老板：品牌增长放行");
  ok(!toolEntryGate(gateCtx("accounting")).marketing && !toolEntryGate(gateCtx("installer")).marketing, "会计、安装工：品牌增长不放行");
  ok(!toolEntryGate(null).marketing, "判定输入缺失：不放行");
  ok(registry.list({ modulesJson: sunnyMods }).filter((t) => t.name.startsWith("marketing_")).length === 12, "不传入口门（数字员工与后台运行）：营销工具照旧在列表里");
}

console.log("\n接线（源码断言）");
{
  const auth = code("src/lib/tenancy/tool-auth.ts");
  ok(/export function toolRequiredModules/.test(auth) && /export function toolModulesSatisfied/.test(auth), "tool-auth 导出模块映射与判定");
  ok(/if \(!toolModulesSatisfied\(tool, modulesJson\)\)/.test(auth) && (auth.match(/parseOrgModulesJson\(/g) ?? []).length === 1, "canInvokeTool 改调 toolModulesSatisfied（模块解析只此一处）");
  const reg = code("src/lib/agent-core/tool-registry.ts");
  ok(/toolModulesSatisfied\(t, modulesJson\)/.test(reg), "registry.list 调同一个 toolModulesSatisfied");
  ok(!/DOMAIN_MODULES|\["operations"\]/.test(reg), "tool-registry 没有复制域 → 模块表");
  const engine = code("src/lib/agent-core/engine.ts");
  ok((engine.match(/modulesJson: options\.modulesJson,\s*entryGate: options\.entryGate,/g) ?? []).length === 2, "engine 两处 toOpenAITools 都传 modulesJson 与 entryGate");
  for (const p of ["src/app/api/ai/threads/[threadId]/messages/route.ts", "src/app/api/agent-core/chat/route.ts", "src/app/api/agent-core/tools/route.ts"]) {
    ok(/loadToolEntryGate\(user, orgId\)/.test(code(p)), `${p}：传入入口门`);
  }
  // 微信对话（executeConversationRun）是人类入口：按平台角色（不是派生角色）取入口门
  const proc = code("src/lib/agent-runtime/process.ts");
  ok(/loadToolEntryGate\(\{ id: userId, role: rawInput\.userRole \}, orgId\)/.test(proc) && /\.\.\.tenantRunFields,\s*entryGate,/.test(proc), "微信对话：传入入口门（平台角色判定）");
  ok(/modulesJson: org\?\.modulesJson \?\? undefined/.test(code("src/app/api/agent-core/tools/route.ts")), "工具列表接口按该企业 modulesJson 过滤");
  // 外贸对话只取 trade / secretary 域（到不了 marketing_*）；提及网关是数字员工通道：不传
  for (const p of ["src/lib/trade/chat-assistant.ts", "src/lib/mention-gateway/handle.ts"]) {
    ok(!/entryGate/.test(read(p)), `${p}：不传入口门`);
  }
  const gate = read("src/lib/agent-core/entry-gate.ts");
  ok(/canOpenHref\(MARKETING_ENTRY_HREF, ctx\)/.test(gate) && /MARKETING_ENTRY_HREF = "\/marketing"/.test(gate), "入口门与路由门同源（canOpenHref(\"/marketing\")）");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
