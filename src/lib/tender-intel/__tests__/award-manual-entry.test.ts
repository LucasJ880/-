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
import { normalizeBuyerName } from "../../corporate-memory/normalize";

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
  ok("规整：统一写成 https://purchasing.alberta.ca/posting/AB-…（主机小写、编号大写、去掉 ? # 与末尾 /）", normalizeApcUrl(" https://Purchasing.Alberta.ca/posting/ab-2026-07664/?x=1#top ") === "https://purchasing.alberta.ca/posting/AB-2026-07664" && normalizeApcUrl("https://purchasing.alberta.ca/posting/AB-2026-07664///") === "https://purchasing.alberta.ca/posting/AB-2026-07664" && normalizeApcUrl("https://purchasing.alberta.ca/posting/AB-2026-07664") === "https://purchasing.alberta.ca/posting/AB-2026-07664");
  const bad = [
    "http://purchasing.alberta.ca/posting/AB-2026-07664", "https://purchasing.alberta.ca:8443/posting/AB-2026-07664", "https://user:pw@purchasing.alberta.ca/posting/AB-2026-07664", "https://purchasing.alberta.ca./posting/AB-2026-07664", "https://evil.example/posting/AB-2026-07664",
    "http://purchasing.alberta.ca/x", "https://purchasing.alberta.ca/", "https://purchasing.alberta.ca//", "https://purchasing.alberta.ca/posting/AB-1", "https://purchasing.alberta.ca/posting/AB-2026-07664/extra", "https://purchasing.alberta.ca/x/AB-2026-07664", "https://purchasing.alberta.ca/posting/XY-2026-07664", "https://purchasing.alberta.ca/posting/AB-26-07664", "https://purchasing.alberta.ca", "https://purchasing.alberta.ca:8443/x",
    "https://evil.example/purchasing.alberta.ca", "https://purchasing.alberta.ca.evil.example/x", "https://user:pw@purchasing.alberta.ca/x", "https://evil.example\\@purchasing.alberta.ca/x",
    "https://purchasing.alberta.ca@evil.example/x", "javascript:alert(1)", "https://purchasing.alberta.ca./x", "not a url", "",
  ];
  const leaked = bad.filter((u) => normalizeApcUrl(u) !== null);
  ok("拒：http、首页、不是 /posting/AB-年份-编号 的路径、带端口、别的主机、用户名密码、@ 把戏、javascript:、末尾带点、不是链接", leaked.length === 0, leaked);
  ok("只复制了主机名开头的替人补上 https://", normalizeApcUrl("purchasing.alberta.ca/posting/AB-2026-07664") === "https://purchasing.alberta.ca/posting/AB-2026-07664" && normalizeApcUrl("PURCHASING.alberta.ca/posting/AB-2026-07664/") === "https://purchasing.alberta.ca/posting/AB-2026-07664" && normalizeApcUrl("purchasing.alberta.ca.evil.example/x") === null);
  ok("反斜杠与 :443 由解析器收敛", normalizeApcUrl("https://purchasing.alberta.ca\\posting\\AB-2026-07664") === "https://purchasing.alberta.ca/posting/AB-2026-07664" && normalizeApcUrl("https://purchasing.alberta.ca:443/posting/AB-2026-07664") === "https://purchasing.alberta.ca/posting/AB-2026-07664");
}

console.log("授标日期");
{
  ok("真实日期、今天、明天（时区容差）通过", parseAwardDate("2026-11-20", NOW) instanceof Date && parseAwardDate("2026-11-21", NOW) instanceof Date && parseAwardDate("2024-02-29", NOW) instanceof Date);
  ok("后天、2023-02-29、2024-02-30、不是年-月-日、1900 年以前 拒绝", ["2026-11-22", "2023-02-29", "2024-02-30", "2026/11/20", "20-11-2026", "1899-12-31", "0000-01-01"].every((d) => parseAwardDate(d, NOW) === "INVALID") && parseAwardDate("1900-01-01", NOW) instanceof Date);
  ok("不填是 null", parseAwardDate("  ", NOW) === null);
}

console.log("逐项校验（第一处错误的那句话）");
{
  ok("漏填三项", err({ ...base, buyerName: " " }) === "请填写采购方。" && err({ ...base, winnerName: "" }) === "请填写中标方。" && err({ ...base, apcUrl: "" }) === "请填写 APC 公告链接。");
  ok("四种坏链接", ["http://purchasing.alberta.ca/x", "https://purchasing.alberta.ca//", "https://purchasing.alberta.ca:8443/x", "https://evil.example/purchasing.alberta.ca"].every((u) => err({ ...base, apcUrl: u }) === "这不是一条 APC 公告的链接。请在 APC 打开这条公告，复制地址栏里形如 https://purchasing.alberta.ca/posting/AB-2026-07664 的链接（搜索结果页、附件链接都不行）。"));
  ok("日期：后天与 2023-02-29", err({ ...base, awardDate: "2026-11-22" }) === "授标日期要写成 年-月-日，且在 1900 年到今天之间。" && err({ ...base, awardDate: "2023-02-29" }) === "授标日期要写成 年-月-日，且在 1900 年到今天之间。");
  const BAD_AMOUNT = "合同金额只填数字（可以带千分位逗号和 $），不能为负，最多两位小数。";
  ok("金额：-1 与 1.234", err({ ...base, contractAmount: -1 }) === BAD_AMOUNT && err({ ...base, contractAmount: "1.234" }) === BAD_AMOUNT && err({ ...base, contractAmount: 1e13 }) !== null);
  const amt = (v: unknown) => {
    const r = parseManualEntry({ ...base, contractAmount: v }, NOW);
    return r.ok ? r.value.contractAmount : "BAD";
  };
  ok("金额：逗号只认千分位（当小数点用的逗号不认，免得差 100 倍）", amt("1,234,567.89") === 1234567.89 && amt("48,000") === 48000 && amt("1234,56") === "BAD" && amt("1,2,3") === "BAD" && amt(",5") === "BAD" && amt("12,34") === "BAD", [amt("1234,56"), amt("1,2,3")]);
  ok("金额：开头的 $、全角数字与全角逗号可以", amt("$1,250,000.00") === 1250000 && amt("$ 900") === 900 && amt("１，２３４") === 1234 && amt("CAD 1,000") === "BAD");
  const fieldOf = (body: Record<string, unknown>) => {
    const r = parseManualEntry(body, NOW);
    return r.ok ? null : `${r.code}:${r.field}`;
  };
  ok("1899 年与当小数点用的逗号：那句话", err({ ...base, awardDate: "1899-12-31" }) === "授标日期要写成 年-月-日，且在 1900 年到今天之间。" && err({ ...base, contractAmount: "1234,56" }) === BAD_AMOUNT);
  ok("出错时带字段（表单据此标出那一格）", fieldOf({ ...base, buyerName: "" }) === "MISSING_BUYER:buyerName" && fieldOf({ ...base, apcUrl: "x" }) === "BAD_URL:apcUrl" && fieldOf({ ...base, awardDate: "x" }) === "BAD_DATE:awardDate" && fieldOf({ ...base, contractAmount: "x" }) === "BAD_AMOUNT:contractAmount" && fieldOf({ ...base, contractAmount: 1, currency: "EUR" }) === "BAD_CURRENCY:currency" && fieldOf({ ...base, scopeSummary: "x".repeat(2001) }) === "TOO_LONG:scopeSummary" && fieldOf({ ...base, winnerName: "x".repeat(201) }) === "TOO_LONG:winnerName");
  ok("接口传数字：编号按字符串收、日期写成数字报错（不静默丢掉）", (() => { const r = parseManualEntry({ ...base, solicitationNumber: 123 }, NOW); return r.ok && r.value.solicitationNumber === "123"; })() && fieldOf({ ...base, awardDate: 20261120 }) === "BAD_DATE:awardDate");
  ok("币种 EUR；没填金额时忽略币种", err({ ...base, contractAmount: 100, currency: "EUR" }) === "币种只能是 CAD 或 USD。" && err({ ...base, currency: "EUR" }) === null);
  ok("太长的字段", err({ ...base, scopeSummary: "x".repeat(2001) }) === "范围摘要太长了（最多 2000 字）。" && err({ ...base, buyerName: "x".repeat(201) }) === "采购方太长了（最多 200 字）。" && err({ ...base, solicitationNumber: "x".repeat(101) }) === "招标编号太长了（最多 100 字）。" && err({ ...base, apcUrl: `https://purchasing.alberta.ca/posting/AB-2026-07664?${"a".repeat(2100)}` }) === "APC 公告链接太长了（最多 2048 字）。");
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
  ok("五种结果的那句话", manualEntryMessageZh("CREATED") === "已录入，等组织管理员复核。" && manualEntryMessageZh("NEEDS_REVIEW") === "已录入；和已有的一条记录可能重复，等组织管理员裁决。" && manualEntryMessageZh("ATTACHED_BY_SOLICITATION") === "已有同一条授标（招标编号与中标方相同），这条公告链接已挂到那条记录上。那条记录原有的内容和可信度不变（你这次填的没有写进去）；有出入请告诉组织管理员。" && manualEntryMessageZh("ATTACHED_BY_DATE_AMOUNT") === "已有同一条授标（中标方、授标日期、金额都相同），这条公告链接已挂到那条记录上。那条记录原有的内容（含招标编号与采购方）和可信度不变（你这次填的没有写进去）；有出入请告诉组织管理员。" && manualEntryMessageZh("ALREADY_ENTERED") === "这条公告的这个中标方已经录过了（同一公告同一中标方只录一条；中了几个标段的请合成一条，金额合计或留空）。");
  ok("挂到既有的原因", attachCause("AB-1", "AB-1") === "ATTACHED_BY_SOLICITATION" && attachCause("pw 2024 001", "PW-2024-001") === "ATTACHED_BY_SOLICITATION" && attachCause(null, "AB-1") === "ATTACHED_BY_DATE_AMOUNT" && attachCause("AB-1", null) === "ATTACHED_BY_DATE_AMOUNT");
  ok("列表链接：只认 USER_ENTRY + manual:apc:，再校验主机", listableApcUrl({ sourceType: "USER_ENTRY", sourceKey: k, sourceUrl: base.apcUrl }) === base.apcUrl && listableApcUrl({ sourceType: "USER_ENTRY", sourceKey: "own-result:p1", sourceUrl: base.apcUrl }) === null && listableApcUrl({ sourceType: "WEB_SEARCH", sourceKey: k, sourceUrl: base.apcUrl }) === null && listableApcUrl({ sourceType: "USER_ENTRY", sourceKey: k, sourceUrl: "https://evil.example/x" }) === null);
  const T = MANUAL_ENTRY_TEXT;
  ok("固定文字", T.formTitle === "录入 Alberta 授标（APC）" && T.formNote === "只录入你在 Alberta Purchasing Connection（APC）上亲眼看到的授标公告。系统只保存这个链接，不会自动访问它；复核的人会点开核对。录入后先列在下表、标为「待人工复核」，不计入金额、周期、可比价格和已确认的竞争对手；经人工确认属实后才计入（一般由组织管理员在下表确认）。" && T.collapsedNote === "把在 APC 上看到的中标结果录进来，经人工确认后计入统计。" && T.buyerHint === "先从候选里选（本组织招标项目和已有授标里用过的写法）；候选里没有，再照公告上的采购方原文填。大小写、标点、开头的 The 不影响匹配，其余要和项目里的采购方一字不差，系统才能对上。" && T.solicitationHint === "照公告上的招标编号原样填，用来区分同一采购方的不同招标。公告上找不到就留空，不要填链接里的 AB-… 编号：编号和已有记录对不上时，系统会把它标为疑似重复，等组织管理员裁决。" && T.urlHint === "在 APC 打开这条公告，从浏览器地址栏复制，只要到编号为止（…/posting/AB-年份-编号）。搜索结果页、附件下载链接不行。" && T.amountHint === "一条公告有几个中标方就录几条；金额填这个中标方自己的合同金额。公告只给总额或预估值时留空。" && T.scopeHint === "写一句能反复用的采购内容，不带年份、编号、地点（例如 Snow removal services）。大小写和标点不影响；同一采购方、同一句、同一币种的已确认记录满 3 条，才会算出可比价格。" && T.listSource === "人工录入 · APC 公告" && T.pendingStat === "待确认（AI 提取 / 人工录入，不计入统计）" && T.duplicateStat === "疑似重复待裁决（不计入统计）" && T.flagOff === "组织授标情报尚未启用" && T.hiddenByFilter === "已录入，但被当前筛选条件挡住了，清空筛选可以看到。" && T.forbidden === "你在本组织没有录入权限（需要成员及以上角色），请联系组织管理员。" && T.tooManyRetracted === "这条公告的这个中标方撤回过太多次，没有录入；请联系组织管理员。");
  ok("其余固定文字", T.noticeGroup === "公告信息" && T.winnerGroup === "这个中标方" && T.clearNotice === "换一条公告（清空）" && T.submit === "录入" && T.submitting === "正在录入…" && T.failed === "没有录入成功，请稍后再试。" && T.network === "网络出错，请稍后再试。" && T.listSourceAria === "在新窗口打开 APC 公告" && T.orgMissing === "组织不存在" && T.tooLarge === "请求太大" && T.adminHint === "你是组织管理员：「AI 提取·待确认」「待人工复核」（含人工录入）和「疑似重复」可以确认或撤回。人工录入的记录，确认前先点「人工录入 · APC 公告」打开原公告核对。填错的撤回后重录：项目结果回项目里重新标记，人工录入在上方表单重新录入。" && T.emptyManual === "在 APC 上看到的 Alberta 授标，也可以用上方「录入 Alberta 授标（APC）」直接录入，经人工确认后计入。");
  ok("提示里说的规则与代码一致：大小写、标点、开头的 The 不影响采购方匹配", normalizeBuyerName("The City of Calgary.") === normalizeBuyerName("city of calgary") && normalizeBuyerName("City of Calgary") !== normalizeBuyerName("Calgary"));
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
  ok("页面：人工录入的链接是原生 <a>、新窗口、不带来源页信息；统计条改名", /<a\s+href=\{r\.manualApcUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/.test(page) && page.includes("{MANUAL_ENTRY_TEXT.listSource} ↗") && page.includes("aria-label={MANUAL_ENTRY_TEXT.listSourceAria}") && page.includes("{MANUAL_ENTRY_TEXT.pendingStat} {intel.basis.aiOnly}") && page.includes("{MANUAL_ENTRY_TEXT.duplicateStat} {intel.basis.needsReview}") && !page.includes("AI 待确认 {") && !page.includes("待复核（不计入统计）") && !/next\/link/.test(page) && !/<iframe|<img[^>]*manualApcUrl|prefetch|preconnect/.test(page));
  ok("页面：表单只对能录入的人显示，按组织换表单；管理员提示与空状态提到人工录入；刚录的高亮、被筛选挡住照实说", page.includes("{canEnterManual && orgId ? (") && page.includes("key={orgId}") && page.includes("{MANUAL_ENTRY_TEXT.adminHint}") && page.includes("{canEnterManual ? <p>{MANUAL_ENTRY_TEXT.emptyManual}</p> : null}") && page.includes("{MANUAL_ENTRY_TEXT.hiddenByFilter}") && page.includes('r.id === enteredId ? "bg-[var(--accent)]/10"'));
  const form = read("src/components/tender-intel/award-manual-entry-form.tsx");
  ok("表单：说明、采购方与范围候选、各项提示、提交中禁用、按钮文字", form.includes("{MANUAL_ENTRY_TEXT.formNote}") && form.includes('list="award-manual-buyers"') && form.includes('list="award-manual-scopes"') && ["buyerHint", "solicitationHint", "urlHint", "amountHint", "scopeHint", "collapsedNote", "clearNotice"].every((k) => form.includes(`{MANUAL_ENTRY_TEXT.${k}}`)) && form.includes("disabled={busy}") && form.includes("if (busy) return;") && form.includes("MANUAL_ENTRY_TEXT.submitting : MANUAL_ENTRY_TEXT.submit"));
  ok("表单：录完一条只清空中标方与金额（重录不清）、焦点回中标方；403 换成白话；错误指向字段", form.includes('if (json.outcome !== "ALREADY_ENTERED") {') && form.includes('setForm((f) => ({ ...f, winnerName: "", contractAmount: "" }));') && form.includes("winnerRef.current?.focus();") && form.includes("res.status === 403 ? MANUAL_ENTRY_TEXT.forbidden") && form.includes("aria-invalid={invalid(") && form.includes('role="alert"') && form.includes('role="status" aria-live="polite"') && form.includes("encodeURIComponent(orgId)"));
  const list = read("src/app/api/org/tender-awards/route.ts");
  ok("列表接口：只取人工录入的 APC 来源、再校验；返回 canEnterManual 与采购方候选", list.includes('sourceType: "USER_ENTRY", sourceKey: { startsWith: MANUAL_APC_SOURCE_PREFIX }') && list.includes("listableApcUrl(src)") && list.includes("canEnterManual,") && list.includes("buyerSuggestions,") && list.includes("manualApcUrl: apcByRecord.get(r.id) ?? null,"));
  ok("列表接口：采购方候选经项目可见性、只取已分派的招标项目、按规整名去重、不用 distinct", list.includes("buildProjectVisibilityWhere(user)") && list.includes('{ orgId, workDomain: "tender", intakeStatus: { not: "pending_dispatch" }, clientOrganization: { not: null } }') && list.includes("normalizeBuyerName(name)") && !/distinct:/.test(list));
  ok("接口：同一来源键最多跟随 10 次（撤回满 10 次后再录 409）", route.includes("const MAX_RETRACTED_HOPS = 10;") && route.includes("for (let i = 0; i < MAX_RETRACTED_HOPS; i++) {") && route.indexOf("throw new RetractedChainTooLong(baseKey);") > route.indexOf("for (let i = 0; i < MAX_RETRACTED_HOPS; i++) {"));
  ok("表单：两组、成功句带中标方名、没填金额时币种不可选、收起显示一句展开显示说明", form.includes("{MANUAL_ENTRY_TEXT.noticeGroup}") && form.includes("{MANUAL_ENTRY_TEXT.winnerGroup}") && form.includes("setOk(`「${winner}」：${json.messageZh ?? MANUAL_ENTRY_TEXT.created}`);") && form.includes("disabled={!form.contractAmount.trim()}") && /\{!open \? <p[^>]*>\{MANUAL_ENTRY_TEXT\.collapsedNote\}<\/p> : null\}/.test(form) && form.indexOf("{open ? (") < form.indexOf("{MANUAL_ENTRY_TEXT.formNote}") && form.includes("json.error ?? MANUAL_ENTRY_TEXT.failed") && form.includes("MANUAL_ENTRY_TEXT.network"));
  ok("接口：撤回太多次 409 不是 500；请求体边读边数；400 带字段", route.includes('code: "RETRACTED_TOO_MANY" }, { status: 409 }') && route.includes("request.body?.getReader()") && route.includes("field: parsed.field"));
}

console.log(`\naward-manual-entry: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
