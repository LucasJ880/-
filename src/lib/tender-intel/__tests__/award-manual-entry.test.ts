/**
 * CHAIN-1b Alberta 授标人工录入：校验与规整、来源键、结果说法、接线（源码断言）
 *
 * 运行：npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MANUAL_ENTRY_TEXT,
  attachCause,
  listableApcUrl,
  manualEntryMessageZh,
  normalizeApcUrl,
  parseAwardDate,
  parseManualEntry,
} from "../award-manual-entry";
import { manualApcSourceKey } from "../award-manual-entry-key";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 600) : ""); }
}
const NOW = new Date("2026-11-20T15:00:00Z");
const base = { buyerName: "Alberta Health Services", winnerName: "Glacier Linen Supply Inc.", apcUrl: "https://purchasing.alberta.ca/posting/AB-2026-01234" };
const err = (body: Record<string, unknown>) => {
  const r = parseManualEntry(body, NOW);
  return r.ok ? null : r.messageZh;
};

console.log("链接规整（只解析字符串）");
{
  ok("规整：主机小写、去掉 # 与末尾 /，保留 query", normalizeApcUrl(" https://Purchasing.Alberta.ca/posting/AB-1/?x=1#top ") === "https://purchasing.alberta.ca/posting/AB-1?x=1" && normalizeApcUrl("https://purchasing.alberta.ca/posting/AB-1///") === "https://purchasing.alberta.ca/posting/AB-1");
  const bad = [
    "http://purchasing.alberta.ca/x", "https://purchasing.alberta.ca/", "https://purchasing.alberta.ca//", "https://purchasing.alberta.ca", "https://purchasing.alberta.ca:8443/x",
    "https://evil.example/purchasing.alberta.ca", "https://purchasing.alberta.ca.evil.example/x", "https://user:pw@purchasing.alberta.ca/x", "https://evil.example\\@purchasing.alberta.ca/x",
    "https://purchasing.alberta.ca@evil.example/x", "javascript:alert(1)", "https://purchasing.alberta.ca./x", "not a url", "",
  ];
  const leaked = bad.filter((u) => normalizeApcUrl(u) !== null);
  ok("拒：http、首页、带端口、别的主机、用户名密码、@ 把戏、javascript:、末尾带点、不是链接", leaked.length === 0, leaked);
  ok("反斜杠与 :443 由解析器收敛", normalizeApcUrl("https://purchasing.alberta.ca\\posting\\AB-1") === "https://purchasing.alberta.ca/posting/AB-1" && normalizeApcUrl("https://purchasing.alberta.ca:443/posting/AB-1") === "https://purchasing.alberta.ca/posting/AB-1");
}

console.log("授标日期");
{
  ok("真实日期、今天、明天（时区容差）通过", parseAwardDate("2026-11-20", NOW) instanceof Date && parseAwardDate("2026-11-21", NOW) instanceof Date && parseAwardDate("2024-02-29", NOW) instanceof Date);
  ok("后天、2023-02-29、2024-02-30、不是年-月-日 拒绝", ["2026-11-22", "2023-02-29", "2024-02-30", "2026/11/20", "20-11-2026"].every((d) => parseAwardDate(d, NOW) === "INVALID"));
  ok("不填是 null", parseAwardDate("  ", NOW) === null);
}

console.log("逐项校验（第一处错误的那句话）");
{
  ok("漏填三项", err({ ...base, buyerName: " " }) === "请填写采购方。" && err({ ...base, winnerName: "" }) === "请填写中标方。" && err({ ...base, apcUrl: "" }) === "请填写 APC 公告链接。");
  ok("四种坏链接", ["http://purchasing.alberta.ca/x", "https://purchasing.alberta.ca//", "https://purchasing.alberta.ca:8443/x", "https://evil.example/purchasing.alberta.ca"].every((u) => err({ ...base, apcUrl: u }) === "APC 公告链接要以 https://purchasing.alberta.ca/ 开头，并指向具体的公告。"));
  ok("日期：后天与 2023-02-29", err({ ...base, awardDate: "2026-11-22" }) === "授标日期要写成 年-月-日，且不能晚于今天。" && err({ ...base, awardDate: "2023-02-29" }) === "授标日期要写成 年-月-日，且不能晚于今天。");
  ok("金额：-1 与 1.234", err({ ...base, contractAmount: -1 }) === "合同金额要是不小于 0 的数字，最多两位小数。" && err({ ...base, contractAmount: "1.234" }) === "合同金额要是不小于 0 的数字，最多两位小数。" && err({ ...base, contractAmount: 1e13 }) !== null);
  ok("币种 EUR；没填金额时忽略币种", err({ ...base, contractAmount: 100, currency: "EUR" }) === "币种只能是 CAD 或 USD。" && err({ ...base, currency: "EUR" }) === null);
  ok("太长的字段", err({ ...base, scopeSummary: "x".repeat(2001) }) === "范围摘要太长了（最多 2000 字）。" && err({ ...base, buyerName: "x".repeat(201) }) === "采购方太长了（最多 200 字）。" && err({ ...base, solicitationNumber: "x".repeat(101) }) === "招标编号太长了（最多 100 字）。" && err({ ...base, apcUrl: `https://purchasing.alberta.ca/${"a".repeat(2100)}` }) === "APC 公告链接太长了（最多 2048 字）。");
  ok("顺序：采购方先于链接、链接先于日期", err({ buyerName: "", winnerName: "", apcUrl: "x", awardDate: "x" }) === "请填写采购方。" && err({ ...base, apcUrl: "x", awardDate: "x" }) === MANUAL_ENTRY_TEXT.badUrl);
  const good = parseManualEntry({ ...base, solicitationNumber: " AB-2026-01234 ", awardDate: "2026-03-01", contractAmount: "12,345.60", currency: "usd", scopeSummary: " Linen " }, NOW);
  ok("合格：规整后的值", good.ok && good.value.apcUrl === base.apcUrl && good.value.solicitationNumber === "AB-2026-01234" && good.value.awardDate?.toISOString() === "2026-03-01T00:00:00.000Z" && good.value.contractAmount === 12345.6 && good.value.currency === "USD" && good.value.scopeSummary === "Linen", good);
  const minimal = parseManualEntry(base, NOW);
  ok("只填必填项：其余为 null，币种 null", minimal.ok && minimal.value.solicitationNumber === null && minimal.value.awardDate === null && minimal.value.contractAmount === null && minimal.value.currency === null && minimal.value.scopeSummary === null);
  ok("请求体不是对象：按漏填采购方", err(null as unknown as Record<string, unknown>) === "请填写采购方。" && parseManualEntry("x", NOW).ok === false);
}

console.log("来源键与结果");
{
  const k = manualApcSourceKey(base.apcUrl, "glacier linen supply");
  ok("来源键：manual:apc: + 32 位十六进制，确定性；中标方不同则不同", /^manual:apc:[0-9a-f]{32}$/.test(k) && k === manualApcSourceKey(base.apcUrl, "glacier linen supply") && k !== manualApcSourceKey(base.apcUrl, "other winner"));
  ok("五种结果的那句话", manualEntryMessageZh("CREATED") === "已录入，等组织管理员复核。" && manualEntryMessageZh("NEEDS_REVIEW") === "已录入；和已有的一条记录可能重复，等组织管理员裁决。" && manualEntryMessageZh("ATTACHED_BY_SOLICITATION") === "已有同一条授标（招标编号与中标方相同），这条公告链接已挂到那条记录上。" && manualEntryMessageZh("ATTACHED_BY_DATE_AMOUNT") === "已有同一条授标（中标方、授标日期、金额都相同），这条公告链接已挂到那条记录上。" && manualEntryMessageZh("ALREADY_ENTERED") === "这条公告的这个中标方已经录过了。");
  ok("挂到既有的原因", attachCause("AB-1", "AB-1") === "ATTACHED_BY_SOLICITATION" && attachCause(null, "AB-1") === "ATTACHED_BY_DATE_AMOUNT" && attachCause("AB-1", null) === "ATTACHED_BY_DATE_AMOUNT");
  ok("列表链接：只认 USER_ENTRY + manual:apc:，再校验主机", listableApcUrl({ sourceType: "USER_ENTRY", sourceKey: k, sourceUrl: base.apcUrl }) === base.apcUrl && listableApcUrl({ sourceType: "USER_ENTRY", sourceKey: "own-result:p1", sourceUrl: base.apcUrl }) === null && listableApcUrl({ sourceType: "WEB_SEARCH", sourceKey: k, sourceUrl: base.apcUrl }) === null && listableApcUrl({ sourceType: "USER_ENTRY", sourceKey: k, sourceUrl: "https://evil.example/x" }) === null);
  ok("固定文字", MANUAL_ENTRY_TEXT.formTitle === "录入 Alberta 授标（APC）" && MANUAL_ENTRY_TEXT.formNote === "只录入你在 Alberta Purchasing Connection（APC）上自己看到的授标公告。系统不会打开这个链接。录入后标为「待人工复核」，组织管理员确认属实后才进入统计、可比价格和历史中标者。" && MANUAL_ENTRY_TEXT.buyerHint === "照公告原文填写；与项目里的采购方写法一致，系统才能把它们对上。" && MANUAL_ENTRY_TEXT.scopeHint === "同类采购照公告标题写同一句，可比价格才算得上。" && MANUAL_ENTRY_TEXT.listSource === "人工录入 · APC 公告" && MANUAL_ENTRY_TEXT.pendingStat === "待确认（AI 提取 / 人工录入）" && MANUAL_ENTRY_TEXT.flagOff === "组织授标情报尚未启用");
}

console.log("接线（源码断言）");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const files = ["src/lib/tender-intel/award-manual-entry.ts", "src/lib/tender-intel/award-manual-entry-key.ts", "src/app/api/organizations/[orgId]/tender-awards/manual/route.ts", "src/components/tender-intel/award-manual-entry-form.tsx"];
  for (const f of files) ok(`${f}：没有网络请求`, !/\bfetch\s*\(|axios|undici|from ["'](node:)?https?["']|\bgot\(/.test(strip(read(f)).replace(/apiFetch\(/g, "")));
  const lib = read("src/lib/tender-intel/award-manual-entry.ts");
  ok("给页面用的模块不依赖 node 模块", !/from "node:/.test(lib));
  const route = read("src/app/api/organizations/[orgId]/tender-awards/manual/route.ts");
  ok("接口：先鉴权、再看组织、再看开关、再校验", route.indexOf('requireOrgRole(request, orgId, "org_member")') < route.indexOf("db.organization.findUnique") && route.indexOf("db.organization.findUnique") < route.indexOf("isT4AwardSchemaReady()") && route.indexOf("isT4AwardSchemaReady()") < route.indexOf("parseManualEntry(body, now)"));
  ok("接口：来源人工录入、待人工复核、可信度中、不挂项目", route.includes('sourceType: "USER_ENTRY"') && route.includes('verificationStatus: "NEEDS_REVIEW"') && route.includes('confidence: "MEDIUM"') && route.includes("projectId: null") && !/SYSTEM_VERIFIED|HUMAN_CONFIRMED/.test(route.replace(/res\.record\.verificationStatus/g, "")));
  ok("接口：撤回过的换后继键；并发撞唯一约束重读", route.includes('res.outcome === "ALREADY_OBSERVED" && res.record.status === "RETRACTED"') && route.includes("key = `${baseKey}:after:${res.record.id}`;") && route.includes('err.code === "P2002"'));
  ok("接口：重录不写审计，其余在同一事务写", route.includes('if (outcome !== "ALREADY_ENTERED") {') && route.includes("await writeAuditLog(tx, {"));
  const page = read("src/app/(main)/projects/intelligence/awards/page.tsx");
  ok("页面：人工录入的链接是原生 <a>、新窗口、不带来源页信息；统计条改名", /<a href=\{r\.manualApcUrl\} target="_blank" rel="noopener noreferrer"/.test(page) && page.includes("{MANUAL_ENTRY_TEXT.listSource}") && page.includes("{MANUAL_ENTRY_TEXT.pendingStat} {intel.basis.aiOnly}") && !page.includes("AI 待确认 {") && !/next\/link/.test(page) && !/<iframe|<img[^>]*manualApcUrl|prefetch|preconnect/.test(page));
  ok("页面：表单只对能录入的人显示", page.includes("{canEnterManual && orgId ? <AwardManualEntryForm"));
  const form = read("src/components/tender-intel/award-manual-entry-form.tsx");
  ok("表单：说明、采购方候选与提示、范围提示、提交中禁用", form.includes("{MANUAL_ENTRY_TEXT.formNote}") && form.includes('list="award-manual-buyers"') && form.includes("{MANUAL_ENTRY_TEXT.buyerHint}") && form.includes("{MANUAL_ENTRY_TEXT.scopeHint}") && form.includes("disabled={busy}") && form.includes("if (busy) return;"));
  const list = read("src/app/api/org/tender-awards/route.ts");
  ok("列表接口：只取人工录入的 APC 来源、再校验；返回 canEnterManual 与采购方候选", list.includes('sourceType: "USER_ENTRY", sourceKey: { startsWith: MANUAL_APC_SOURCE_PREFIX }') && list.includes("listableApcUrl(src)") && list.includes("canEnterManual,") && list.includes("buyerSuggestions,") && list.includes("manualApcUrl: apcByRecord.get(r.id) ?? null,"));
}

console.log(`\naward-manual-entry: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
