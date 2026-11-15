/**
 * MAIL-1 读信工具的可见性：开关 × 入口 × 受众 × 模块，工具列表与执行期一致
 * （spec mail/assistant-read；change mail-read-tools）
 * 运行：npx tsx src/lib/agent-core/__tests__/mail-tool-visibility.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registry } from "../tool-registry";
import "../tools";
import { MAIL_ENTRY_HREF, toolEntryGate } from "../entry-gate";
import { toolLabel } from "../streaming";
import { TOOL_POLICY } from "../tools/_policy";
import { createMailTools } from "../tools/mail";
import type { ToolEntryGate, ToolExecutionContext } from "../types";
import { canInvokeTool, toolRequiredModules } from "@/lib/tenancy/tool-auth";
import { DEFAULT_SUNNY_MODULES } from "@/lib/tenancy/modules";
import { PLATFORM_DEFAULT_AGENT_TOOL_POLICY } from "@/lib/org-rules/types";
import { canOpenHref } from "@/lib/navigation/landing";
import { IDENTITIES, gateCtx, type IdentityName } from "@/lib/navigation/__tests__/identity-fixtures";

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

const MAIL_TOOLS = ["mail_search", "mail_read_thread"] as const;
const SUNNY = { enabled: [...DEFAULT_SUNNY_MODULES] };
const hasMail = (names: string[]) => MAIL_TOOLS.every((n) => names.includes(n));
const noMail = (names: string[]) => names.every((n) => !n.startsWith("mail_"));
/** 给模型的工具列表（引擎两条运行路径都只经 toOpenAITools 取列表） */
const listNames = (entryGate: ToolEntryGate | undefined, modulesJson: unknown = SUNNY) =>
  registry.toOpenAITools({ role: "user", modulesJson, ...(entryGate ? { entryGate } : {}) }).map((t) => t.function.name);
/** 工具列表接口（GET /api/agent-core/tools）：registry.list + 入口门 */
const apiListNames = (entryGate: ToolEntryGate, modulesJson: unknown = SUNNY) =>
  registry.list({ role: "user", modulesJson, entryGate }).map((t) => t.name);

/** 注入假依赖的读信工具：只数 Gmail 与客户查询被调用了几次 */
function instrumented(flagOn: boolean) {
  const counts = { gmail: 0, customer: 0, audit: 0 };
  const [search, readThread] = createMailTools({
    isEnabled: () => flagOn,
    searchMailbox: async () => {
      counts.gmail++;
      return { messages: [], hasMore: false };
    },
    getThreadText: async () => {
      counts.gmail++;
      return null;
    },
    findCustomer: async () => {
      counts.customer++;
      return null;
    },
    writeAudit: async () => {
      counts.audit++;
    },
  });
  return { search, readThread, counts };
}

function execCtx(entryGate: ToolEntryGate | undefined, args: Record<string, unknown> = {}): ToolExecutionContext {
  return {
    args,
    userId: "u_lynn",
    orgId: "org_sunny",
    role: "sales",
    orgRole: "org_member",
    hasMembership: true,
    modulesJson: SUNNY,
    scopeGuard: { orgId: "org_sunny", principalUserId: "u_lynn" },
    ...(entryGate ? { entryGate } : {}),
  };
}

async function main() {
  console.log("mail-tool-visibility（读信工具：列表与执行期同一判定）");

  console.log("\n注册与策略");
  {
    const all = registry.list().map((t) => t.name);
    ok(hasMail(all) && all.filter((n) => n.startsWith("mail_")).length === 2, "注册表里有且只有两个 mail_* 工具", all.filter((n) => n.startsWith("mail_")));
    ok(MAIL_TOOLS.every((n) => TOOL_POLICY[n]?.risk === "l0_read" && TOOL_POLICY[n]?.allowRoles === "*"), "策略表：两者 l0_read、allowRoles 为 *（受众由入口门决定）");
    ok(MAIL_TOOLS.every((n) => registry.get(n)?.risk === "l0_read"), "注册表里的风险等级为只读");
    ok(toolLabel("mail_search") === "搜索邮箱" && toolLabel("mail_read_thread") === "读取邮件", "工具事件的中文名：搜索邮箱 / 读取邮件");
  }

  console.log("\n入口 × 受众 × 开关（8 格）：列表");
  type Cell = { flag: boolean; web: boolean; audience: boolean };
  const cells: Cell[] = [];
  for (const flag of [true, false]) for (const web of [true, false]) for (const audience of [true, false]) cells.push({ flag, web, audience });
  const gateOf = (c: Cell) =>
    toolEntryGate(gateCtx(c.audience ? "sales_rep" : "installer"), {
      ...(c.web ? { surface: "web_assistant" as const } : {}),
      mailReadEnabled: c.flag,
    });
  const label = (c: Cell) => `开关${c.flag ? "开" : "关"} × ${c.web ? "网页助手" : "其它入口"} × 邮箱绑定页${c.audience ? "放行" : "不放行"}`;
  for (const c of cells) {
    const expected = c.flag && c.web && c.audience;
    const names = listNames(gateOf(c));
    ok(expected ? hasMail(names) : noMail(names), `${label(c)}：列表${expected ? "含" : "不含"}读信工具`, names.filter((n) => n.startsWith("mail_")));
  }
  ok(cells.filter((c) => hasMail(listNames(gateOf(c)))).length === 1, "只有「开 × 网页助手 × 放行」一格含读信工具");
  ok(!("mail" in toolEntryGate(gateCtx("sales_rep"))) && !("mail" in toolEntryGate(gateCtx("sales_rep"), { surface: "web_assistant", mailReadEnabled: false })), "非网页助手入口 / 开关关：入口门里没有 mail 键（返回与改动前相同）");
  ok(JSON.stringify(toolEntryGate(gateCtx("sales_rep"))) === JSON.stringify({ marketing: canOpenHref("/marketing", gateCtx("sales_rep")) }), "不带入口声明：入口门只有 marketing 一项");
  ok(noMail(listNames(undefined)) && noMail(registry.toOpenAITools({ modulesJson: SUNNY }).map((t) => t.function.name)) && noMail(registry.toOpenAITools().map((t) => t.function.name)) && noMail(registry.toOpenAITools({ names: undefined, domains: ["secretary"] }).map((t) => t.function.name)), "给模型的列表不传入口门（数字员工 / 后台运行 / 技能 / 外贸对话）：不给读信工具");
  ok(noMail(listNames({ marketing: true })) && noMail(listNames({ marketing: true, mail: false })), "入口门没有 mail 或 mail=false：不给");
  ok(noMail(apiListNames({ marketing: true })) && noMail(apiListNames(toolEntryGate(gateCtx("sales_rep")))) && noMail(apiListNames(toolEntryGate(gateCtx("super_admin")))), "工具列表接口（带入口门、不声明网页助手）：不含读信工具");
  ok(hasMail(apiListNames({ marketing: false, mail: true })), "带 mail=true 的入口门：registry.list 与给模型的列表结论相同");
  ok(hasMail(registry.list().map((t) => t.name)) && hasMail(registry.list({ names: undefined }).map((t) => t.name)), "不传入口门的 registry.list 是注册表枚举（策略打标签 / 测试用），不给模型");
  ok(toolEntryGate(null, { surface: "web_assistant", mailReadEnabled: true }).mail === false, "判定输入缺失：不放行");

  console.log("\n入口 × 受众 × 开关（8 格）：执行期逐格相同");
  for (const c of cells) {
    const listed = hasMail(listNames(gateOf(c)));
    const t = instrumented(c.flag);
    const r1 = await t.search.execute(execCtx(gateOf(c), { query: "报价" }));
    const r2 = await t.readThread.execute(execCtx(gateOf(c), { threadId: "18c2f0a9b7d1e234" }));
    const denied1 = (r1.data as { code?: string } | null)?.code === "MAIL_READ_UNAVAILABLE";
    const denied2 = (r2.data as { code?: string } | null)?.code === "MAIL_READ_UNAVAILABLE";
    if (listed) {
      ok(!denied1 && !denied2 && t.counts.gmail === 2, `${label(c)}：执行不因入口判定被拒`, [r1.data, r2.data]);
    } else {
      ok(denied1 && denied2 && r1.success === false && t.counts.gmail === 0 && t.counts.customer === 0 && t.counts.audit === 0, `${label(c)}：执行返回 MAIL_READ_UNAVAILABLE，Gmail / 客户查询 / 审计调用 0 次`, [r1.data, t.counts]);
    }
  }
  {
    const t = instrumented(true);
    const noGate = await t.search.execute(execCtx(undefined, { customerId: "c1" }));
    ok((noGate.data as { code?: string }).code === "MAIL_READ_UNAVAILABLE" && t.counts.customer === 0 && t.counts.gmail === 0, "不带入口门直接执行（带 customerId）：拒绝，且不读取客户档案");
    const noMember = await t.search.execute({ ...execCtx({ marketing: false, mail: true }), hasMembership: false });
    ok((noMember.data as { code?: string }).code === "MAIL_READ_UNAVAILABLE" && t.counts.gmail === 0, "没有企业成员身份：拒绝");
  }

  console.log("\n经注册表直接以工具名调用（列表不含读信工具的运行）");
  {
    const prev = process.env.MAIL_READ_ENABLED;
    process.env.MAIL_READ_ENABLED = "true";
    try {
      // 微信对话 / Agent Core 对话：有入口门但没有 mail；技能 / 外贸对话：没有入口门
      for (const [name, gate] of [["有入口门但没有 mail", { marketing: true } as ToolEntryGate], ["没有入口门", undefined]] as const) {
        const r = await registry.execute("mail_search", execCtx(gate, { query: "x" }));
        const r2 = await registry.execute("mail_read_thread", execCtx(gate, { threadId: "18c2f0a9b7d1e234" }));
        ok(r.success === false && (r.data as { code?: string }).code === "MAIL_READ_UNAVAILABLE" && (r2.data as { code?: string }).code === "MAIL_READ_UNAVAILABLE", `${name}：真实注册的工具返回 MAIL_READ_UNAVAILABLE（没有访问 Gmail 或数据库）`, [r, r2]);
      }
    } finally {
      if (prev === undefined) delete process.env.MAIL_READ_ENABLED;
      else process.env.MAIL_READ_ENABLED = prev;
    }
    delete process.env.MAIL_READ_ENABLED;
    const off = await registry.execute("mail_search", execCtx({ marketing: false, mail: true }, { query: "x" }));
    ok((off.data as { code?: string }).code === "MAIL_READ_UNAVAILABLE", "开关关：即使入口门带 mail=true，真实工具也拒绝");
    if (prev !== undefined) process.env.MAIL_READ_ENABLED = prev;
  }

  console.log("\n受众与邮箱绑定页一致（逐岗位）");
  {
    const names = Object.keys(IDENTITIES) as IdentityName[];
    const mismatch = names.filter((n) => {
      const ctx = gateCtx(n);
      const gate = toolEntryGate(ctx, { surface: "web_assistant", mailReadEnabled: true });
      const mods = { enabled: [...(ctx.modules?.enabled ?? DEFAULT_SUNNY_MODULES)] };
      return hasMail(listNames(gate, mods)) !== canOpenHref(MAIL_ENTRY_HREF, ctx);
    });
    ok(mismatch.length === 0, `全部 ${names.length} 个岗位：「列表里有读信工具」⇔「/settings/email 放行」`, mismatch);
    const mail = (n: IdentityName) => toolEntryGate(gateCtx(n), { surface: "web_assistant", mailReadEnabled: true }).mail === true;
    ok(mail("sales_rep") && mail("bids") && mail("owner") && mail("mx_trade_rep") && mail("super_admin"), "销售、招投标、老板、梦馨外贸、平台 super_admin：放行");
    ok(!mail("installer") && !mail("no_position"), "安装工、无岗位：不放行");
    ok(mail("ops_staff") === canOpenHref("/settings/email", gateCtx("ops_staff")), "ops_staff：与邮箱绑定页同结论", mail("ops_staff"));
    ok(MAIL_ENTRY_HREF === "/settings/email" && /canOpenHref\(MAIL_ENTRY_HREF, ctx\)/.test(read("src/lib/agent-core/entry-gate.ts")), "入口门与路由门同源（canOpenHref(\"/settings/email\")）");
  }

  console.log("\n模块组合（列表与执行期同一映射）");
  {
    const open: ToolEntryGate = { marketing: false, mail: true };
    const moduleDenied = (modulesJson: unknown) => {
      const tool = registry.get("mail_search")!;
      const d = canInvokeTool({ tenant: { userId: "u1", orgId: "o1", orgRole: "org_member", isPlatformAdmin: false }, hasMembership: true, tool, modulesJson });
      return !d.ok && d.code === "module_disabled";
    };
    for (const m of ["sales", "bids", "trade"]) {
      ok(hasMail(listNames(open, { enabled: [m] })) && !moduleDenied({ enabled: [m] }), `只开 ${m}：列表含读信工具，执行期模块判定通过`);
    }
    ok(noMail(listNames(open, { enabled: ["operations"] })) && moduleDenied({ enabled: ["operations"] }), "只开 operations：列表不含，执行期拒绝码为 module_disabled");
    ok(hasMail(listNames(open, undefined)) && !moduleDenied(undefined), "企业未配置模块：不按模块限制");
    ok(JSON.stringify(toolRequiredModules("mail_search", "secretary")) === '["sales","bids","trade"]', "mail_* 所需模块：sales / bids / trade 任一");
    ok(JSON.stringify(toolRequiredModules("secretary_get_briefing", "secretary")) === '["operations","sales","trade"]', "同域其它工具的所需模块不变");
  }

  console.log("\n不弹审批卡");
  {
    for (const n of MAIL_TOOLS) {
      const d = canInvokeTool({
        tenant: { userId: "u1", orgId: "o1", orgRole: "org_member", isPlatformAdmin: false },
        hasMembership: true,
        tool: registry.get(n)!,
        modulesJson: SUNNY,
        toolPolicy: PLATFORM_DEFAULT_AGENT_TOOL_POLICY,
        maxRisk: "l0_read",
      });
      ok(d.ok && d.requiresApproval === false && d.needsApproval === false, `${n}：企业默认强制审批清单下授权通过且不要求审批（风险上限 l0_read 也放行）`, d);
    }
    ok(!PLATFORM_DEFAULT_AGENT_TOOL_POLICY.forceApprovalTools?.some((n) => n.startsWith("mail_")), "强制审批清单里没有读信工具");
    const viewer = canInvokeTool({ tenant: { userId: "u1", orgId: "o1", orgRole: "org_viewer", isPlatformAdmin: false }, hasMembership: true, tool: registry.get("mail_search")!, modulesJson: SUNNY });
    ok(viewer.ok, "org_viewer：只读工具可调用（是否可用仍由入口门决定）");
  }

  console.log("\n各入口（源码断言）");
  {
    // WEB_ASSISTANT_ROUTE_ASSERTION
    for (const p of ["src/app/api/agent-core/chat/route.ts", "src/app/api/agent-core/tools/route.ts", "src/lib/agent-runtime/process.ts"]) {
      ok(!/web_assistant/.test(code(p)) && /loadToolEntryGate\(/.test(code(p)), `${p}：取入口门但不声明网页助手入口`);
    }
    for (const p of ["src/lib/mention-gateway/handle.ts", "src/lib/mention-gateway/policy.ts", "src/lib/agent-core/skills/runtime.ts", "src/lib/trade/chat-assistant.ts", "src/lib/agent-core/conversation/adapter.ts"]) {
      ok(!/entryGate|web_assistant/.test(code(p)), `${p}：不传入口门`);
    }
    const adapter = code("src/lib/agent-core/conversation/adapter.ts");
    ok(/tools: \[\],/.test(adapter), "项目会话（会把工具结果落库的入口）：以 tools: [] 运行，不暴露注册表工具");
    const MAIL_NAME = /["'`]mail_|\bmail_(search|read_thread)\b/;
    ok(!MAIL_NAME.test(code("src/lib/agent-runtime-v2/tool-catalog.ts")) && !MAIL_NAME.test(code("src/lib/agent-runtime-v2/adapters.ts")), "运行时 v2 的工具目录与执行表没有登记读信工具");
    ok(!MAIL_NAME.test(code("src/lib/mention-gateway/policy.ts")), "提及网关的白名单里没有读信工具");
    const engine = code("src/lib/agent-core/engine.ts");
    ok(/entryGate: options\.entryGate,\s*\};\s*\}/.test(engine.slice(engine.indexOf("export function buildToolContextBase"))), "引擎把入口门原样带进执行上下文");
    const reg = code("src/lib/agent-core/tool-registry.ts");
    ok(/const mailOpen = filters\?\.entryGate\?\.mail === true;\s*return this\.list\(filters\)\.filter\(\(tool\) => mailOpen \|\| !isMailToolName\(tool\.name\)\)/.test(reg), "给模型的列表（toOpenAITools）：mail 不是 true 一律剔除 mail_*");
    ok(/if \(filters\?\.entryGate && filters\.entryGate\.mail !== true\)/.test(reg), "registry.list：传了入口门而 mail 不是 true 时剔除 mail_*");
    ok((engine.match(/registry\.toOpenAITools\(/g) ?? []).length === 2 && !/registry\.list\(/.test(engine), "引擎两条运行路径都只经 toOpenAITools 取列表");
    ok(/isMailReadAllowed\(\)/.test(code("src/lib/agent-core/entry-gate-server.ts")), "入口门加载函数从服务端开关取读信是否开启");
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
