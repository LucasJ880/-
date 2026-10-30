/**
 * A-1 组织驾驶舱岗位注册表 — 穷举与静态核对（openspec change org-cockpit-posts，spec cockpit/post-registry）
 * 运行：npx tsx src/lib/cockpit/__tests__/posts.test.ts
 *
 * 不连库：自动化键与工作域取运行时常量；PendingActionType 没有运行时数组，从类型定义源码读联合成员；
 * AgentRun runType 没有类型全集，从 src 源码扫出代码真实写入的取值。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { AUTOMATION_REGISTRY } from "@/lib/automation/registry";
import { WORK_DOMAINS } from "@/lib/workforce-runtime/work-domain";
import {
  POST_KEYS,
  POST_KPI_FORMATS,
  POST_REGISTRY,
  SHARED_PENDING_ACTION_TYPES,
  UNATTRIBUTED_AGENT_RUN_TYPES,
  getPostDefinition,
  isSharedPendingActionType,
  pickKpiMetrics,
  postForAgentRunType,
  postForAutomation,
  postForPendingAction,
  postForPendingActionType,
  postForWorkDomain,
} from "../posts";

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

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const HAN = /\p{Script=Han}/u;

interface PostLike {
  key: string;
  automationKeys: readonly string[];
  pendingActionTypes: readonly string[];
  workDomains: readonly string[];
  agentRunTypes: readonly string[];
}
type Field = "automationKeys" | "pendingActionTypes" | "workDomains" | "agentRunTypes";

/** 每个值命中的岗位；missing = 没有岗位，duplicated = 多于一个岗位，unknown = 岗位里列了但全集里没有 */
function coverage(all: readonly string[], field: Field, posts: readonly PostLike[]) {
  const hits = new Map<string, string[]>(all.map((v) => [v, []]));
  const unknown: string[] = [];
  for (const post of posts) {
    for (const value of post[field]) {
      const list = hits.get(value);
      if (list) list.push(post.key);
      else unknown.push(`${post.key}:${value}`);
    }
  }
  const missing = [...hits].filter(([, ps]) => ps.length === 0).map(([v]) => v);
  const duplicated = [...hits].filter(([, ps]) => ps.length > 1).map(([v, ps]) => `${v} → ${ps.join(" + ")}`);
  return { missing, duplicated, unknown };
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** 先剥掉整份文件的注释再截联合；返回成员与截取段里除字面量、`|`、空白之外的残留 */
function pendingActionTypesFromSource(): { members: string[]; residue: string } {
  const src = stripComments(read("src/lib/pending-actions/types.ts"));
  const body = src.match(/export type PendingActionType =([\s\S]*?);/)?.[1] ?? "";
  const members = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const residue = body.replace(/"[^"]+"/g, "").replace(/[|\s]/g, "");
  return { members, residue };
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      listSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 源码里写入 AgentRun 的 runType 取值：`runType: "x"` 字面量与 `*_RUN_TYPE = "x"` 常量 */
function agentRunTypesFromSource(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of listSourceFiles(join(root, "src"))) {
    const rel = relative(root, file);
    if (rel === "src/lib/cockpit/posts.ts") continue;
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/\brunType:\s*"([a-z0-9_]+)"/g)) if (!found.has(m[1])) found.set(m[1], rel);
    for (const m of src.matchAll(/\b[A-Z0-9_]*RUN_TYPE\s*=\s*"([a-z0-9_]+)"/g)) if (!found.has(m[1])) found.set(m[1], rel);
  }
  return found;
}

const posts: readonly PostLike[] = POST_REGISTRY;

// ── 岗位集合固定为七个 ─────────────────────────────────────────
console.log("岗位集合");
const EXPECTED_KEYS = ["inbound_sales", "tender", "marketing", "service", "projects", "ops_knowledge", "content"];
ok(JSON.stringify(POST_KEYS) === JSON.stringify(EXPECTED_KEYS), "岗位键与顺序固定为七个", POST_KEYS);
ok(new Set(POST_KEYS).size === POST_KEYS.length, "岗位键不重复");
for (const post of POST_REGISTRY) ok(HAN.test(post.name), `${post.key} 的名称「${post.name}」含汉字`);
ok(getPostDefinition("content")?.key === "content" && getPostDefinition("marketing")?.key === "marketing", "content 与 marketing 是两个独立岗位（D-5）");
ok(getPostDefinition("tender")?.name === "投标", "按键查找岗位");
for (const bogus of ["ceo", "", "__proto__", "constructor", "INBOUND_SALES"]) {
  ok(getPostDefinition(bogus) === null, `查找不存在的岗位 "${bogus}" → null，不回退默认岗位`);
}

// ── 自动化 ────────────────────────────────────────────────────
console.log("自动化归属");
const automationKeys = AUTOMATION_REGISTRY.map((a) => a.key as string);
ok(automationKeys.length >= 31, `自动化注册表读到 ${automationKeys.length} 项（≥ 31，含 A-5 post-daily-digest）`);
{
  const c = coverage(automationKeys, "automationKeys", posts);
  ok(c.missing.length === 0, "每个自动化键都有岗位", c.missing);
  ok(c.duplicated.length === 0, "没有自动化键归属两个岗位", c.duplicated);
  ok(c.unknown.length === 0, "岗位里没有注册表之外的自动化键", c.unknown);
}
for (const key of automationKeys) {
  const post = postForAutomation(key);
  ok(post !== null && POST_REGISTRY.find((p) => p.key === post)?.automationKeys.some((k) => k === key) === true, `反查 ${key} → ${post}`);
}
ok(postForAutomation("approval-timeout") === "ops_knowledge", "approval-timeout → ops_knowledge（全组织审批过期，不是投标专属）");
ok(postForAutomation("post-daily-digest") === "ops_knowledge", "post-daily-digest → ops_knowledge（A-5 岗位日结：组织运转留痕）");
ok(postForAutomation("tender-watch") === "tender", "tender-watch → tender（不按 registry category=projects 推导）");
ok(postForAutomation("inquiry-sla") === "inbound_sales", "inquiry-sla → inbound_sales（不按 registry category=service 推导）");
ok(postForAutomation("aivora-sync") === "content", "aivora-sync → content");
ok(postForAutomation("no-such-automation") === null, "未知自动化键 → null");

// ── 待审批动作类型 ────────────────────────────────────────────
console.log("待审批动作类型归属");
const { members: actionTypes, residue } = pendingActionTypesFromSource();
ok(residue === "", "PendingActionType 截取段只含双引号字面量与 |（出现新写法立刻失败）", residue);
ok(actionTypes.length >= 19, `从 pending-actions/types.ts 读到 ${actionTypes.length} 个联合成员（≥ 19）`, actionTypes);
{
  const fixedOrShared = actionTypes.map((t) => {
    const fixedPosts = POST_REGISTRY.filter((p) => (p.pendingActionTypes as readonly string[]).includes(t)).map((p) => p.key);
    const shared = (SHARED_PENDING_ACTION_TYPES as readonly string[]).includes(t);
    return { t, ways: fixedPosts.length + (shared ? 1 : 0), fixedPosts, shared };
  });
  const bad = fixedOrShared.filter((x) => x.ways !== 1);
  ok(bad.length === 0, "每个动作类型恰好一种归属方式（固定一个岗位，或通用动作类型）", bad);
  ok(fixedOrShared.filter((x) => x.fixedPosts.length === 1 && !x.shared).length === 16, "16 个固定归属");
  ok(fixedOrShared.filter((x) => x.shared && x.fixedPosts.length === 0).length === 4, "4 个通用动作类型");
  const listed = [...POST_REGISTRY.flatMap((p) => p.pendingActionTypes as readonly string[]), ...SHARED_PENDING_ACTION_TYPES];
  const outside = listed.filter((t) => !actionTypes.includes(t));
  ok(outside.length === 0, "注册表里没有联合之外的动作类型", outside);
}
ok(postForPendingActionType("sales.send_inquiry_reply") === "inbound_sales", "sales.send_inquiry_reply → inbound_sales");
ok(postForPendingActionType("tender.send_chase") === "tender", "tender.send_chase → tender");
ok(postForPendingActionType("marketing.activate_campaign") === "marketing", "marketing.activate_campaign → marketing");
for (const t of SHARED_PENDING_ACTION_TYPES) {
  ok(postForPendingActionType(t) === null && isSharedPendingActionType(t), `${t} 没有固定岗位（通用动作类型）`);
}
ok(postForPendingActionType("revenue_spine.propose_commercial_fact") === "inbound_sales", "revenue_spine.propose_commercial_fact → inbound_sales（B-2）");
ok(postForPendingActionType("revenue_spine.not_a_type") === null, "联合之外的类型 → null");

// ── 通用动作类型按行上下文归属 ────────────────────────────────
console.log("通用动作按上下文归属");
ok(postForPendingAction({ type: "grader.project_task", projectWorkDomain: "tender" }) === "tender", "项目工作域 tender → tender");
ok(postForPendingAction({ type: "grader.internal_note", projectWorkDomain: "delivery", targetType: "CUSTOMER" }) === "projects", "项目工作域优先于目标类型");
ok(postForPendingAction({ type: "grader.email_draft", targetType: "customer" }) === "inbound_sales", "目标类型 customer（不区分大小写）→ inbound_sales");
ok(postForPendingAction({ type: "grader.internal_note", targetType: "QUOTE" }) === "inbound_sales", "目标类型 QUOTE → inbound_sales");
ok(postForPendingAction({ type: "grader.internal_note", targetType: "PROJECT" }) === "projects", "目标类型 PROJECT（工作域未知）→ projects");
ok(postForPendingAction({ type: "calendar.create_event", agentRunType: "runtime_v2" }) === "inbound_sales", "产出 run 类型 runtime_v2 → inbound_sales");
ok(postForPendingAction({ type: "grader.internal_note", projectWorkDomain: "general", targetType: "PROJECT" }) === "projects", "未分类项目（general）不归 ops_knowledge，落到目标类型规则");
ok(postForPendingAction({ type: "grader.project_task", projectWorkDomain: "general" }) === null, "未分类项目且无其他上下文 → 未归属");
ok(postForPendingAction({ type: "calendar.create_event", targetType: "UNKNOWN", agentRunType: "fde_inbound_sales" }) === "inbound_sales", "未知目标类型落到下一条规则");
ok(postForPendingAction({ type: "calendar.create_event", projectWorkDomain: "nonsense", agentRunType: "conversation" }) === null, "未知工作域 + 不归属的 run 类型 → 未归属");
ok(postForPendingAction({ type: "calendar.create_event" }) === null, "无上下文 → 未归属，不回退默认岗位");
ok(postForPendingAction({ type: "tender.send_rfq", projectWorkDomain: "sales", targetType: "CUSTOMER" }) === "tender", "固定类型不受上下文影响");
ok(postForPendingAction({ type: "no.such_type", projectWorkDomain: "tender" }) === null, "未知动作类型 → null");

// ── workforce 工作域 ──────────────────────────────────────────
console.log("工作域归属");
{
  const c = coverage(WORK_DOMAINS, "workDomains", posts);
  ok(c.missing.length === 0 && c.duplicated.length === 0 && c.unknown.length === 0, "四个工作域各恰好一个岗位", c);
}
const EXPECTED_DOMAINS: Record<string, string> = { sales: "inbound_sales", tender: "tender", delivery: "projects", general: "ops_knowledge" };
for (const [domain, post] of Object.entries(EXPECTED_DOMAINS)) {
  ok(postForWorkDomain(domain) === post, `工作域 ${domain} → ${post}`);
}
ok(postForWorkDomain("system") === null && postForWorkDomain("") === null, "未知工作域 → null");

// ── AgentRun runType ─────────────────────────────────────────
console.log("AgentRun 类型归属");
{
  const written = agentRunTypesFromSource();
  ok(written.size >= 7, `源码扫出 ${written.size} 个 runType 写入取值（≥ 7）`, [...written.keys()]);
  const unattributed = UNATTRIBUTED_AGENT_RUN_TYPES as readonly string[];
  for (const [runType, file] of written) {
    const attributed = postForAgentRunType(runType) !== null;
    const listedAsUnattributed = unattributed.includes(runType);
    ok(attributed !== listedAsUnattributed, `runType ${runType}（${file}）恰好"归属"或"不归属"之一`);
  }
  const attributedLists = POST_REGISTRY.flatMap((p) => p.agentRunTypes as readonly string[]);
  const stale = [...attributedLists, ...unattributed].filter((rt) => !written.has(rt));
  ok(stale.length === 0, "归属 / 不归属清单里没有源码不再写入的取值", stale);
  const c = coverage([...written.keys()], "agentRunTypes", posts);
  ok(c.duplicated.length === 0, "每个 runType 至多一个岗位", c.duplicated);
  ok(c.unknown.length === 0, "岗位里没有源码之外的 runType（防拼写错误）", c.unknown);
  ok(!attributedLists.includes("workforce_job"), "没有岗位按 runType 认领 workforce_job（它按工作域归属）");
}
ok(postForAgentRunType("fde_inbound_sales") === "inbound_sales", "fde_inbound_sales → inbound_sales");
ok(postForAgentRunType("runtime_v2") === "inbound_sales", "runtime_v2（销售跟进分诊）→ inbound_sales");
for (const rt of ["workforce_job", "conversation", "assistant_dispatch", "background_conversation", "supervisor", "unknown_type"]) {
  ok(postForAgentRunType(rt) === null, `runType ${rt} → null（不猜、不回退）`);
}

// ── KPI 来源 ──────────────────────────────────────────────────
console.log("KPI 来源");
const SENSITIVE =
  /margin|profit|revenue|cost|spend|payable|bidprice|bidamount|awardedvalue|estimatedvalue|indicativetendervalue|valuation|winningbid|ourbid|cad$|毛利|利润|营收|收入|成本|花费|估值|标的额|报价|中标金额/i;
const postsSrc = read("src/lib/cockpit/posts.ts");
const formats = POST_KPI_FORMATS as readonly string[];
for (const post of POST_REGISTRY) {
  const kpi = post.kpi;
  if (kpi.kind === "unavailable") {
    ok(kpi.reason.trim().length > 0, `${post.key}：KPI 未接入且写明原因`);
    continue;
  }
  const [modulePath, exportName] = kpi.source.split("#");
  const exists = existsSync(join(root, modulePath));
  ok(exists, `${post.key}：KPI 模块 ${modulePath} 存在`);
  if (!exists) continue;
  ok(new RegExp(`export async function ${exportName}\\b`).test(read(modulePath)), `${post.key}：${modulePath} 导出 async ${exportName}`);
  const alias = modulePath.replace(/^src\//, "@/").replace(/\.ts$/, "");
  const mapping = new RegExp(
    `"${kpi.source}":\\s*Awaited<\\s*ReturnType<\\(typeof import\\("${alias}"\\)\\)\\["${exportName}"\\]>`,
  );
  ok(mapping.test(postsSrc), `${post.key}：类型映射把 ${kpi.source} 指向 import("${alias}")["${exportName}"]`);
  const w = kpi.window;
  ok(
    (w.kind === "rolling_days" && Number.isInteger(w.days) && w.days > 0) || ["month_to_date", "point_in_time", "all_time"].includes(w.kind),
    `${post.key}：统计窗口合法（${JSON.stringify(w)}）`,
  );
  for (const metric of kpi.metrics) {
    ok(formats.includes(metric.format), `${post.key}：${metric.path} 的格式 ${metric.format} 在白名单内`);
    ok(HAN.test(metric.label), `${post.key}：${metric.path} 有中文标签`);
    ok(!SENSITIVE.test(metric.path) && !SENSITIVE.test(metric.label), `${post.key}：指标 ${metric.path}（${metric.label}）不含敏感字段`);
  }
}
ok(getPostDefinition("service")?.kpi.kind === "unavailable", "service 的 KPI 为未接入（无既有只读读函数）");
ok(getPostDefinition("content")?.kpi.kind === "unavailable", "content 的 KPI 为未接入（无既有只读读函数）");
for (const sensitive of [
  "wonProjects.finalizedMarginPercentage",
  "funnel.economics.attributedGrossProfit",
  "awardedValueCad",
  "ourBidPrice",
  "winningBidAmountCad",
  "summary.revenue",
  "summary.spend",
  "totalBidCostCad",
  "wonProjects.forecastRevenueCad",
  "标的额",
  "中标金额",
]) {
  ok(SENSITIVE.test(sensitive), `敏感词正则拦得住 ${sensitive}`);
}

// ── 只取声明的路径 ────────────────────────────────────────────
console.log("按声明取值");
{
  const tender = getPostDefinition("tender");
  const summary = {
    tenderSubmittedCount: 12,
    wonCount: 3,
    winRatePercentage: "25.0",
    awardedValueCad: 880000,
    wonProjects: { finalizedMarginPercentage: "31.2", finalizedProfitCad: 120000 },
  };
  const picked = tender ? pickKpiMetrics(tender.kpi, summary) : null;
  ok(JSON.stringify(picked?.map((m) => m.value)) === JSON.stringify([12, 3, "25.0"]), "tender 只取三个声明字段", picked);
  const serialized = JSON.stringify(picked);
  ok(!/Margin|Profit|awarded|31\.2|120000|880000/.test(serialized), "取值结果里没有毛利率 / 利润 / 中标金额", serialized);

  const sales = getPostDefinition("inbound_sales");
  const sla = { inquiries: { medianFirstResponseMinutes: 42, answeredWithin24hRate: null }, guardrail: { total: 2, firstReply: 1 } };
  ok(JSON.stringify(sales ? pickKpiMetrics(sales.kpi, sla)?.map((m) => m.value) : null) === JSON.stringify([42, null, 2]), "嵌套路径取值，null 原样保留");
  ok(JSON.stringify(sales ? pickKpiMetrics(sales.kpi, { inquiries: {}, guardrail: { total: { n: 1 } } })?.map((m) => m.value) : null) === JSON.stringify([null, null, null]), "缺失路径与非标量 → null");
  ok(JSON.stringify(sales ? pickKpiMetrics(sales.kpi, { inquiries: { medianFirstResponseMinutes: Number.NaN } })?.[0].value : "x") === "null", "NaN → null");
  ok(sales ? pickKpiMetrics(sales.kpi, null)?.every((m) => m.value === null) === true : false, "结果为 null 时三个值都是 null");
  const service = getPostDefinition("service");
  ok(service ? pickKpiMetrics(service.kpi, { anything: 1 }) === null : false, "未接入的 KPI 取值 → null");
}

// ── 跳转页面 ──────────────────────────────────────────────────
console.log("跳转页面");
for (const post of POST_REGISTRY) {
  ok(post.nav.startsWith("/"), `${post.key}：跳转路径以 / 开头`);
  ok(existsSync(join(root, "src/app/(main)", post.nav, "page.tsx")), `${post.key}：${post.nav} 对应的 page.tsx 存在`);
}

// ── 注册表是代码事实 ──────────────────────────────────────────
console.log("零运行时依赖");
{
  const code = stripComments(postsSrc);
  const imports = code.split("\n").filter((line) => /^\s*import\s/.test(line));
  ok(imports.length > 0 && imports.every((line) => /^\s*import type\s/.test(line)), "posts.ts 的 import 语句全是 import type", imports);
  const dynamic = [...code.matchAll(/(.{0,7})\bimport\(/g)].map((m) => m[1]);
  ok(dynamic.length > 0 && dynamic.every((prefix) => prefix.endsWith("typeof ")), "每个 import( 都在类型位置（紧跟 typeof）", dynamic);
  ok(!/\brequire\(/.test(code), "posts.ts 不出现 require(");
  ok(!/^\s*export\s[^\n]*\sfrom\s/m.test(code), "posts.ts 不出现 export … from");
  for (const banned of ["process.env", "settingsJson", "@/lib/db"]) {
    ok(!postsSrc.includes(banned), `posts.ts 不出现 ${banned}`);
  }
}

// ── 校验器自检：注入未归属 / 重复归属必须被检出 ─────────────────
console.log("校验器自检");
{
  const fake: PostLike[] = [
    { key: "a", automationKeys: ["x", "y"], pendingActionTypes: [], workDomains: [], agentRunTypes: [] },
    { key: "b", automationKeys: ["y", "ghost"], pendingActionTypes: [], workDomains: [], agentRunTypes: [] },
  ];
  const c = coverage(["x", "y", "z"], "automationKeys", fake);
  ok(JSON.stringify(c.missing) === JSON.stringify(["z"]), "未归属的键被检出", c.missing);
  ok(JSON.stringify(c.duplicated) === JSON.stringify(["y → a + b"]), "重复归属的键被检出", c.duplicated);
  ok(JSON.stringify(c.unknown) === JSON.stringify(["b:ghost"]), "全集之外的键被检出", c.unknown);
  const tricky = 'export type PendingActionType =\n  | "a.b" // 注释里有 ; 分号\n  /* "phantom.member" */\n  | "c.d";';
  const body = stripComments(tricky).match(/export type PendingActionType =([\s\S]*?);/)?.[1] ?? "";
  ok(JSON.stringify([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1])) === JSON.stringify(["a.b", "c.d"]), "注释里的分号与引号不影响截取");
  const withSubUnion = 'export type PendingActionType =\n  | "a.b"\n  | OtherTypes;';
  const subBody = withSubUnion.match(/export type PendingActionType =([\s\S]*?);/)?.[1] ?? "";
  ok(subBody.replace(/"[^"]+"/g, "").replace(/[|\s]/g, "") === "OtherTypes", "子联合引用会留下残留（被检出）");
}

console.log(`\n组织驾驶舱岗位注册表: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
