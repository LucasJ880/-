/**
 * PROC-1：申请卡 / 重复检查 / READY 闸 / 状态与期限 / 回执比对 / 旧状态映射（spec procurement/records-request）
 * 运行：npx tsx src/lib/procurement-records/__tests__/records-request-pure.test.ts
 * 数据全部为 fixture。
 */
import {
  buildCompletedAtiCopyBody,
  buildExplanationZh,
  buildFederalAtiBody,
  findPlaceholders,
  isValidIsoDate,
  scopeFingerprint,
  textHash,
} from "../request-pure";
import { checkDuplicates, intersectRange, subtractSegments, type ExistingRequestScope } from "../duplicate-check";
import { evaluateReady, type ReadyInput } from "../ready-gate";
import {
  applyImportEvidence,
  deriveFilesStatus,
  estimateDueDate,
  isSufficientReceiptKind,
  mapLegacyStatus,
  matchReceipt,
  taskKindForEvent,
  transition,
} from "../case-pure";
import { DEFAULT_RULE_SEEDS, RULE_DEADLINE_UNITS, TORONTO_INSTITUTION_KEY, ruleChannelFor } from "../rule-seeds";
import { JURISDICTIONS, normalizeInstitutionKey } from "../identity";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 900) : "");
  }
}

console.log("\n— 联邦正文模板");
{
  const body = buildFederalAtiBody({
    institution: "Public Services and Procurement Canada (PSPC)",
    projectTitle: "21C51-249059 Pillow Form",
    solicitationNumbers: ["WS4856068988"],
    contractNumbers: ["CW2379109"],
    startDate: "2021-11-01",
    endDate: "2026-10-31",
    categories: ["CONTRACT_DOCS", "CALL_UPS_USAGE", "USAGE_REPORTS", "FINANCIALS", "PRICE_SCHEDULE"],
  });
  ok(body.startsWith("Pursuant to the Access to Information Act, please provide electronic copies of existing records under the control of Public Services and Procurement Canada (PSPC) relating to 21C51-249059 Pillow Form, WS4856068988, and CW2379109, for the period 2021-11-01 to 2026-10-31."), "首句按模板替换", body.slice(0, 300));
  ok(body.includes("4. Records showing separately the amounts committed, ordered, invoiced and paid"), "五条按序编号");
  ok(body.includes("I am requesting existing records and not a new forecast or commercial analysis."), "保留不索取新分析的声明");
  ok(findPlaceholders(body).length === 0, "全部替换后无占位符");
  const partial = buildFederalAtiBody({ institution: null, projectTitle: null, solicitationNumbers: [], contractNumbers: [], startDate: null, endDate: null, categories: ["FINANCIALS"] });
  ok(["[INSTITUTION]", "[PROJECT TITLE]", "[STANDING OFFER / CONTRACT NUMBER]", "[START DATE]", "[END DATE]"].every((p) => partial.includes(p)), "缺数据保留方括号（不补造）");
  ok(partial.includes("1. Records showing separately"), "只选一类时重新编号为 1");
  ok(!partial.includes("Standing Offer, its applicable annexes"), "未选的类别不出现");
  const copy = buildCompletedAtiCopyBody({ institution: "Correctional Service Canada (CSC)", requestNumbers: ["A-2024-00012"] });
  ok(copy.includes("A-2024-00012") && copy.includes("informal request"), "既有披露副本正文（非正式）");
  const zh = buildExplanationZh({ pathType: "NEW_FORMAL_REQUEST", jurisdiction: "CA-FED", institutionDisplay: null, recordsHolderBasis: null, instrumentLabels: ["CW2379109"], startDate: null, endDate: null, categories: ["FINANCIALS"], lawLabel: "Access to Information Act (Canada)", feeCents: null, currency: "CAD", deadlineValue: 30, deadlineUnit: "CALENDAR_DAYS", purposeZh: null, gapsZh: null });
  ok(zh.includes("费用未知（待核实，不按 0 处理）"), "未知费用不写成 0");
  ok(zh.includes("不承诺何时取得") && !zh.includes("两个月"), "不承诺取得时间");
  ok(zh.includes("不默认 PSPC"), "持有依据未填时提示不默认 PSPC");
  const copyZh = buildExplanationZh({ pathType: "COMPLETED_ATI_COPY", jurisdiction: "CA-FED", institutionDisplay: "CSC", recordsHolderBasis: "x", instrumentLabels: [], startDate: null, endDate: null, categories: [], lawLabel: null, feeCents: 0, currency: "CAD", deadlineValue: null, deadlineUnit: null, purposeZh: null, gapsZh: null });
  ok(copyZh.includes("非正式副本请求不适用正式申请的法定答复时限"), "副本请求不套用正式时限");
}

console.log("\n— hash 与指纹");
{
  ok(textHash("a\r\nb  \n") === textHash("a\nb"), "text hash 规范换行与行尾空白");
  ok(textHash("Please provide records") !== textHash("Kindly provide records"), "措辞变化 → text hash 变化");
  const base = { applicantKey: "sunny shutter", jurisdiction: "CA-FED", institutionKey: "PSPC", numbers: ["CW2379109"], categories: ["FINANCIALS", "CONTRACT_DOCS"], startDate: "2021-11-01", endDate: "2026-10-31" };
  ok(scopeFingerprint(base) === scopeFingerprint({ ...base, numbers: ["cw2379109-001"], categories: ["CONTRACT_DOCS", "FINANCIALS"] }), "指纹与编号写法 / 类别顺序无关");
  ok(scopeFingerprint(base) !== scopeFingerprint({ ...base, endDate: "2026-11-05" }), "日期变化 → 指纹变化");
  ok(isValidIsoDate("2026-02-28") && !isValidIsoDate("2026-02-30") && !isValidIsoDate("26-2-1"), "ISO 日期校验");
}

console.log("\n— 重复检查");
const existing = (over: Partial<ExistingRequestScope>): ExistingRequestScope => ({
  requestId: "old",
  title: "旧申请",
  status: "SUBMITTED",
  governmentOutcome: null,
  archived: false,
  channel: "FORMAL",
  applicantKey: "sunny shutter",
  jurisdiction: "CA-FED",
  institutionKey: "PSPC",
  numbers: ["CW2379109"],
  categories: ["FINANCIALS", "CALL_UPS_USAGE"],
  startDate: "2021-11-01",
  endDate: "2026-10-31",
  ...over,
});
const cand = { requestId: "new", applicantKey: "sunny shutter", jurisdiction: "CA-FED", institutionKey: "PSPC", numbers: ["CW2379109"], categories: ["FINANCIALS"], startDate: "2021-11-01", endDate: "2026-11-05" };
{
  const r = checkDuplicates({ candidate: cand, existing: [existing({})], ledgerAttested: true });
  ok(r.result === "BLOCKING", "同主体 / 机关 / 合同 / 类别 / 日期重叠 → BLOCKING", r);
  ok(r.newSegments.length === 1 && r.newSegments[0].start === "2026-11-01" && r.newSegments[0].end === "2026-11-05" && r.newSegments[0].days === 5, "旧至 10-31、新至 11-05 → 新增 5 天", r.newSegments);
  ok(r.overlaps[0].overlap?.end === "2026-10-31" && r.reasonsZh.some((x) => x.includes("新增部分")), "展示已有覆盖与新增部分");
  const rw = checkDuplicates({ candidate: { ...cand, numbers: ["cw 2379109-001"] }, existing: [existing({ channel: "INFORMAL", title: "完全不同的标题" })], ledgerAttested: true });
  ok(rw.result === "BLOCKING", "改编号写法 / 标题 / formal→informal 渠道仍检出", rw.result);
  ok(checkDuplicates({ candidate: { ...cand, numbers: ["CW2370017"] }, existing: [existing({})], ledgerAttested: true }).result === "CLEAR", "不同合同 → CLEAR");
  ok(checkDuplicates({ candidate: { ...cand, categories: ["PRICE_SCHEDULE"] }, existing: [existing({})], ledgerAttested: true }).result === "CLEAR", "类别不相交 → CLEAR");
  ok(checkDuplicates({ candidate: { ...cand, startDate: "2026-11-01" }, existing: [existing({})], ledgerAttested: true }).result === "CLEAR", "只申请新增段 → CLEAR");
  ok(checkDuplicates({ candidate: { ...cand, institutionKey: "CSC" }, existing: [existing({})], ledgerAttested: true }).result === "CLEAR", "两个已映射的不同机关 → 不重叠（每份申请范围独立）");
  const unk = checkDuplicates({ candidate: cand, existing: [existing({ institutionKey: null, applicantKey: null })], ledgerAttested: true });
  ok(unk.result === "BLOCKING" && unk.overlaps[0].institutionUncertain && unk.overlaps[0].applicantUncertain, "历史记录机关 / 主体未知 → 保守命中并标人工复核", unk.overlaps);
  ok(checkDuplicates({ candidate: cand, existing: [existing({ institutionKey: "RAW:pspc-ottawa-office" })], ledgerAttested: true }).overlaps[0]?.institutionUncertain === true, "机关别名未确定 → 人工复核（不擅自合并也不放过）");
  ok(checkDuplicates({ candidate: cand, existing: [existing({ status: "DRAFT" })], ledgerAttested: true }).result === "DRAFT_EXISTS", "未提交草稿 → 优先续改");
  ok(checkDuplicates({ candidate: cand, existing: [existing({ status: "DRAFT" })], ledgerAttested: true, overlapReason: "保留两份：另一份给 CSC" }).result === "CLEAR", "写明理由后解除 DRAFT_EXISTS");
  ok(checkDuplicates({ candidate: cand, existing: [existing({ status: "DRAFT", archived: true })], ledgerAttested: true }).result === "CLEAR", "本地归档的未提交草稿不算重复");
  for (const s of ["HANDOFF_PENDING", "USER_REPORTED_SUBMISSION", "SUBMISSION_UNKNOWN", "ACKNOWLEDGED", "PROCESSING"]) {
    ok(checkDuplicates({ candidate: cand, existing: [existing({ status: s })], ledgerAttested: true }).result === "BLOCKING", `${s} → BLOCKING`);
  }
  ok(checkDuplicates({ candidate: cand, existing: [existing({ status: "CLOSED", governmentOutcome: "PARTIAL_DISCLOSURE" })], ledgerAttested: true }).result === "BLOCKING", "已披露（部分）→ BLOCKING");
  const closed = checkDuplicates({ candidate: cand, existing: [existing({ status: "CLOSED", governmentOutcome: "NO_RECORDS" })], ledgerAttested: true });
  ok(closed.result === "NEEDS_REASON", "无记录 / 拒绝 / 撤回的历史 → 须说明理由（不视作从未申请）", closed.result);
  ok(checkDuplicates({ candidate: cand, existing: [existing({ status: "CLOSED", governmentOutcome: "WITHDRAWN" })], ledgerAttested: true, overlapReason: "上次撤回，范围缩小后重新申请" }).result === "CLEAR", "写明理由后可继续");
  ok(checkDuplicates({ candidate: cand, existing: [], ledgerAttested: false }).result === "UNVERIFIED", "台账未确认 → UNVERIFIED，不返回没有重复");
  ok(checkDuplicates({ candidate: cand, existing: [], ledgerAttested: true, readFailed: true }).result === "UNVERIFIED", "读取失败 → UNVERIFIED");
  const bad = checkDuplicates({ candidate: cand, existing: [existing({ status: "WEIRD_LEGACY" })], ledgerAttested: true });
  ok(bad.result === "BLOCKING" && bad.ledgerVerified === false, "状态无法解析 → 不放行且台账未核实", bad);
  ok(checkDuplicates({ candidate: cand, existing: [existing({ categories: ["UNKNOWN"] })], ledgerAttested: true }).result === "BLOCKING", "历史类别未知 → 与所有类别相交");
  ok(intersectRange({ startDate: "2021-01-01", endDate: "2021-12-31" }, { startDate: "2022-01-01", endDate: null }) === null, "日期不相交");
  ok(subtractSegments({ startDate: "2021-01-01", endDate: "2021-01-10" }, [{ start: "2021-01-03", end: "2021-01-04", days: 2 }]).map((s) => s.days).join(",") === "2,6", "区间相减");
}

console.log("\n— READY 闸");
const okInput = (): ReadyInput => ({
  archived: false,
  pathType: "NEW_FORMAL_REQUEST",
  recipientInstitution: "Public Services and Procurement Canada",
  recordsHolderBasis: "PSPC 发出 SO 与价格附件",
  pathChecks: { publicRecords: { checkedAt: "2026-11-05T00:00:00Z" }, completedAti: { checkedAt: "2026-11-05T00:00:00Z" } },
  version: { bodyEn: "Pursuant to ... complete", startDate: "2021-11-01", endDate: "2026-10-31", categories: ["FINANCIALS"], instrumentNumbers: ["CW2379109"], applicantProfileVersion: 2 },
  applicant: { verificationStatus: "CONFIRMED", version: 2, archived: false, fields: { legalName: "Sunny Fixture Inc.", representativeName: "测试代表", addressLine1: "1 Fixture St", city: "Toronto", province: "ON", postalCode: "M5V 0A0", country: "Canada", email: "fixture@example.test" } },
  rule: { verificationStatus: "VERIFIED", applicationFeeCents: 500, officialPortalUrl: "https://example.test/portal", selfServeSupported: true },
  duplicate: { result: "CLEAR", ledgerVerified: true, reasonsZh: [] },
});
{
  ok(evaluateReady(okInput()).ready === true, "全部满足 → READY");
  const codes = (i: ReadyInput) => evaluateReady(i).blockers.map((b) => b.code);
  const a = okInput();
  a.applicant!.verificationStatus = "UNCONFIRMED";
  a.rule!.applicationFeeCents = null;
  const c1 = codes(a);
  ok(c1.includes("APPLICANT_UNCONFIRMED") && c1.includes("FEE_UNKNOWN"), "缺申请人确认、费用未知 → 阻塞（未知费用不是零）", c1);
  const b = okInput();
  b.applicant!.fields.addressLine1 = "";
  b.applicant!.fields.email = null;
  ok(codes(b).includes("APPLICANT_FIELD_MISSING"), "必填字段缺失");
  const c = okInput();
  c.applicant = null;
  ok(codes(c).includes("APPLICANT_MISSING"), "无申请人");
  const d = okInput();
  d.version!.applicantProfileVersion = 1;
  ok(codes(d).includes("APPLICANT_SNAPSHOT_STALE"), "申请人改动后版本快照过期");
  const e = okInput();
  e.rule!.verificationStatus = "UNVERIFIED";
  e.rule!.officialPortalUrl = null;
  e.rule!.selfServeSupported = false;
  const ce = codes(e);
  ok(ce.includes("RULE_UNVERIFIED") && ce.includes("PORTAL_UNVERIFIED") && ce.includes("SELF_SERVE_NOT_SUPPORTED"), "规则未核实 / 入口未核实 / 辖区不支持自助", ce);
  const f = okInput();
  f.duplicate = { result: "UNVERIFIED", ledgerVerified: false, reasonsZh: [] };
  ok(codes(f).includes("LEDGER_UNVERIFIED"), "台账未核实 → 阻塞");
  const g = okInput();
  g.duplicate = { result: "BLOCKING", ledgerVerified: true, reasonsZh: ["x"] };
  ok(codes(g).includes("OVERLAP_BLOCKING"), "重叠 → 阻塞");
  const h = okInput();
  h.version!.bodyEn = "Pursuant ... [INSTITUTION]";
  ok(codes(h).includes("BODY_PLACEHOLDER"), "占位符 → 阻塞");
  const i = okInput();
  i.version!.startDate = "2026-11-06";
  ok(codes(i).includes("DATE_RANGE_INVALID"), "起 > 止 → 阻塞");
  const j = okInput();
  j.pathChecks = { publicRecords: null, completedAti: null };
  const cj = codes(j);
  ok(cj.includes("PUBLIC_RECORDS_NOT_CHECKED") && cj.includes("COMPLETED_ATI_NOT_CHECKED"), "新正式申请须先查公开资料与既有披露", cj);
  const k = okInput();
  k.recordsHolderBasis = null;
  k.recipientInstitution = " ";
  const ck = codes(k);
  ok(ck.includes("RECIPIENT_MISSING") && ck.includes("RECORDS_HOLDER_BASIS_MISSING"), "机关与持有依据必填", ck);
  const l = okInput();
  l.pathType = "PUBLIC_RECORD";
  ok(codes(l).includes("PATH_NOT_SUBMITTABLE"), "公开资料路径不进入提交");
}

console.log("\n— 状态转换");
{
  ok(!transition("DRAFT", "VERIFY_RECEIPT").ok, "DRAFT 不能直接 SUBMITTED（INVALID_TRANSITION）");
  ok(!transition("DRAFT", "REPORT_SUBMITTED").ok, "DRAFT 不能直接报告提交（须先就绪 + 交接）");
  ok(transition("READY", "START_HANDOFF").ok && transition("HANDOFF_PENDING", "REPORT_SUBMITTED").ok, "READY → 交接 → 用户报告提交");
  ok(transition("HANDOFF_PENDING", "REPORT_UNKNOWN").ok && transition("SUBMISSION_UNKNOWN", "VERIFY_RECEIPT").ok, "不确定 → 有回执才 SUBMITTED");
  ok(transition("SUBMISSION_UNKNOWN", "RESOLVE_UNKNOWN_NOT_SUBMITTED").ok && (transition("SUBMISSION_UNKNOWN", "RESOLVE_UNKNOWN_NOT_SUBMITTED") as { to: string }).to === "READY", "确认未提交 → READY");
  ok(!transition("SUBMISSION_UNKNOWN", "START_HANDOFF").ok, "不确定状态不能再次交接（不自动重试）");
  ok(!transition("CLOSED", "FINAL_RESPONSE").ok, "已结案不能再结案");
  ok(!transition("DRAFT", "FINAL_RESPONSE").ok, "未提交不能结案");
  ok((transition("PROCESSING", "ACKNOWLEDGE") as { to: string }).to === "PROCESSING", "处理中补录案件编号不回退");
}

console.log("\n— 期限");
{
  const e1 = estimateDueDate({ receivedDate: "2026-08-07", deadlineValue: 30, deadlineUnit: "CALENDAR_DAYS", channel: "FORMAL" });
  ok(e1.estimatedDueAt === "2026-09-06" && e1.basisZh.includes("估算") && e1.basisZh.includes("未计延期"), "2026-08-07 + 30 个日历日 = 2026-09-06（估算）", e1);
  ok(estimateDueDate({ receivedDate: "2026-08-07", deadlineValue: 30, deadlineUnit: "BUSINESS_DAYS", channel: "FORMAL" }).estimatedDueAt === null, "工作日规则不估算");
  ok(estimateDueDate({ receivedDate: "2026-08-07", deadlineValue: 30, deadlineUnit: "CALENDAR_DAYS", channel: "INFORMAL" }).estimatedDueAt === null, "非正式副本请求不估算");
  ok(!estimateDueDate({ receivedDate: "2026-08-07", deadlineValue: 30, deadlineUnit: "CALENDAR_DAYS", channel: "FORMAL" }).basisZh.includes("82"), "不把单案实耗 82 天写成时限");
}

console.log("\n— 回执比对");
{
  const t = "Access to Information and Privacy Online Request\nConfirmation number: EA2026_0187844\nInstitution: Public Services and Procurement Canada\nAmount paid: $5.00";
  const m = matchReceipt({ receiptText: t, submissionReference: "EA2026-0187844", institutionKey: "PSPC", institutionName: "Public Services and Procurement Canada" });
  ok(m.referenceFound && m.institutionFound, "编号（分隔符无关）与机关名都找到", m);
  ok(!matchReceipt({ receiptText: t, submissionReference: "EA2026_9999999", institutionKey: "PSPC", institutionName: null }).referenceFound, "编号不符 → 不通过");
  ok(!matchReceipt({ receiptText: t, submissionReference: "EA2026_0187844", institutionKey: "CSC", institutionName: "Correctional Service Canada" }).institutionFound, "机关不符 → 不通过");
  ok(matchReceipt({ receiptText: "", submissionReference: "X", institutionKey: null, institutionName: null }).textAvailable === false, "无文本 → 不可自动比对");
  ok(!isSufficientReceiptKind("PAYMENT_PROOF") && !isSufficientReceiptKind("PORTAL_SCREENSHOT") && isSufficientReceiptKind("RECEIPT"), "付款凭证 / 截图不能单独证明提交");
}

console.log("\n— 文件状态与待办");
{
  ok(deriveFilesStatus({ hasLetter: true, disclosureFileCount: 0, userConfirmedAllFiles: false }) === "NOTICE_RECEIVED", "只有来信（哪怕写 105 页）→ NOTICE_RECEIVED");
  ok(deriveFilesStatus({ hasLetter: true, disclosureFileCount: 1, userConfirmedAllFiles: false }) === "PARTIAL_FILES_RECEIVED", "有披露文件未确认全部 → PARTIAL");
  ok(deriveFilesStatus({ hasLetter: false, disclosureFileCount: 0, userConfirmedAllFiles: true }) === "NONE", "没文件确认也无效");
  ok(taskKindForEvent("RESPONSE_LETTER", { hasDisclosureFiles: false }) === "UPLOAD_DISCLOSURE", "回复信无附件 → 待上传待办");
  ok(taskKindForEvent("CLARIFICATION_REQUEST", { hasDisclosureFiles: false }) === "SUPPLY_INFO", "澄清 → 补充资料待办");
  ok(taskKindForEvent("TRANSFERRED", { hasDisclosureFiles: false }) === "USER_DECISION", "转交 → 需用户决定（不自动二次提交）");
}

console.log("\n— 旧 Skill 单状态映射");
{
  const m1 = mapLegacyStatus("RELEASE_NOTICE_RECEIVED");
  ok(m1.ok && m1.mapping.filesStatus === "NOTICE_RECEIVED" && m1.mapping.status === "PROCESSING", "RELEASE_NOTICE_RECEIVED → 文件 NOTICE_RECEIVED");
  const m2 = mapLegacyStatus("PARTIAL_RELEASE");
  ok(m2.ok && m2.mapping.governmentOutcome === "PARTIAL_DISCLOSURE", "PARTIAL_RELEASE → 部分披露");
  if (m2.ok) {
    const adj = applyImportEvidence(m2.mapping, { hasFinalLetter: false, hasDisclosureFiles: false, hasLetterReported: true });
    ok(adj.status === "PROCESSING" && adj.governmentOutcome === null && adj.filesStatus === "NOTICE_RECEIVED" && adj.noteZh.length === 2, "无来信 / 无文件导入时降级（不 CLOSED、不标已取得）", adj);
  }
  const m3 = mapLegacyStatus("SOMETHING_ELSE");
  ok(!m3.ok && m3.code === "UNMAPPED_LEGACY_STATUS", "未知旧状态 → 报错，不静默丢弃");
  const m4 = mapLegacyStatus("submitted");
  ok(m4.ok && m4.mapping.status === "USER_REPORTED_SUBMISSION", "旧 SUBMITTED（无回执）→ USER_REPORTED_SUBMISSION");
}

console.log("\n— 机关规则种子（联邦 + 省级；全部未核实）");
{
  const key = (r: { jurisdiction: string; institutionKey: string; channel: string }) => `${r.jurisdiction}|${r.institutionKey}|${r.channel}`;
  ok(new Set(DEFAULT_RULE_SEEDS.map(key)).size === DEFAULT_RULE_SEEDS.length, "种子键（辖区 + 机关 + 渠道）不重复");
  ok(DEFAULT_RULE_SEEDS.every((r) => (JURISDICTIONS as readonly string[]).includes(r.jurisdiction)), "种子辖区都在 JURISDICTIONS 内");
  ok(
    DEFAULT_RULE_SEEDS.every((r) => r.applicationFeeCents === null || (Number.isInteger(r.applicationFeeCents) && r.applicationFeeCents >= 0)),
    "费用为非负整数分或 null",
  );
  ok(DEFAULT_RULE_SEEDS.every((r) => r.deadlineUnit === null || (RULE_DEADLINE_UNITS as readonly string[]).includes(r.deadlineUnit)), "时限单位合法");
  ok(DEFAULT_RULE_SEEDS.every((r) => (r.deadlineValue === null) === (r.deadlineUnit === null)), "时限数值与单位同时有或同时无");
  ok(DEFAULT_RULE_SEEDS.every((r) => r.effectiveFrom === null || isValidIsoDate(r.effectiveFrom)), "适用起始日为有效 ISO 日期");
  ok(
    DEFAULT_RULE_SEEDS.every((r) => [r.guidanceUrl, ...r.sourceRefs.map((x) => x.url)].every((u) => u === null || new URL(u).protocol === "https:")),
    "指引与来源链接都是 https",
  );
  const filled = DEFAULT_RULE_SEEDS.filter((r) => r.applicationFeeCents !== null || r.deadlineValue !== null);
  ok(filled.every((r) => r.sourceRefs.length > 0 && r.seedBasis.includes("尚未")), "凡填了费用或时限的种子都带来源，且依据写明尚未核实");
  ok(DEFAULT_RULE_SEEDS.every((r) => r.seedBasis.length > 0 && !/已核实|verified/i.test(r.seedBasis)), "种子依据不得自称已核实");

  const find = (j: string, inst = "*", ch = "FORMAL_ONLINE") => DEFAULT_RULE_SEEDS.find((r) => r.jurisdiction === j && r.institutionKey === inst && r.channel === ch);
  const on = find("CA-ON");
  ok(on?.applicationFeeCents === 500 && on.deadlineValue === 45 && on.deadlineUnit === "BUSINESS_DAYS" && on.effectiveFrom === "2026-07-01", "安省 FIPPA：$5、45 个工作日、2026-07-01 起", on);
  ok(Boolean(on?.otherFeesRule?.includes("30 个日历日") && on.otherFeesRule.includes("MFIPPA")), "安省说明保留旧时限并提示市级机关适用 MFIPPA");
  ok(TORONTO_INSTITUTION_KEY === "TORONTO" && normalizeInstitutionKey("City of Toronto – PMMD").key === "TORONTO", "多伦多市机构键稳定（含分段写法）");
  const tor = find("CA-ON", TORONTO_INSTITUTION_KEY);
  ok(Boolean(tor?.lawLabel.startsWith("Municipal Freedom of Information")) && tor?.applicationFeeCents === 500, "多伦多市单独走 MFIPPA 规则", tor);
  const bc = find("CA-BC");
  ok(bc?.applicationFeeCents === 1000 && bc.deadlineValue === 30 && bc.deadlineUnit === "BUSINESS_DAYS", "BC：$10、30 个工作日", bc);
  const mb = find("CA-MB");
  ok(mb?.applicationFeeCents === 0 && mb.deadlineValue === 45 && mb.deadlineUnit === "CALENDAR_DAYS", "曼省：免申请费、45 个日历日", mb);
  const qc = find("CA-QC");
  ok(qc?.applicationFeeCents === 0 && qc.deadlineValue === 20 && qc.deadlineUnit === "CALENDAR_DAYS" && qc.lawLabel.includes("A-2.1"), "魁省：免申请费、20 日、A-2.1", qc);
  const ab = find("CA-AB");
  ok(ab?.applicationFeeCents === 2500 && ab.deadlineValue === 30 && ab.deadlineUnit === "BUSINESS_DAYS" && ab.effectiveFrom === "2025-06-11", "阿省 ATIA：$25、30 个工作日、2025-06-11 起", ab);
  const sk = find("CA-SK");
  ok(sk?.applicationFeeCents === null && sk.deadlineValue === null && sk.selfServeSupported === false && sk.sourceRefs.length === 0, "萨省保持占位：未知即 null、不支持自助", sk);
  ok(!find("CA-ON", "*", "INFORMAL_COPY") && ruleChannelFor("FORMAL") === "FORMAL_ONLINE", "省级只有正式渠道种子；非正式副本只属联邦");

  // 省级种子即使费用已知，仍因未核实、入口未填而不能 READY（READY 闸只认真实用户核实）
  const r = evaluateReady({ ...okInput(), rule: { verificationStatus: "UNVERIFIED", applicationFeeCents: on!.applicationFeeCents, officialPortalUrl: null, selfServeSupported: on!.selfServeSupported } });
  const codes = r.blockers.map((b) => b.code);
  ok(!r.ready && codes.includes("RULE_UNVERIFIED") && codes.includes("PORTAL_UNVERIFIED") && !codes.includes("FEE_UNKNOWN"), "省级种子：RULE_UNVERIFIED + PORTAL_UNVERIFIED，费用已知", codes);
  // 工作日时限不做估算（节假日规则各省不同），日历日时限照常估算
  ok(estimateDueDate({ receivedDate: "2026-11-02", deadlineValue: on!.deadlineValue, deadlineUnit: on!.deadlineUnit, channel: "FORMAL" }).estimatedDueAt === null, "安省 45 个工作日：不估算到期日");
  ok(estimateDueDate({ receivedDate: "2026-11-02", deadlineValue: qc!.deadlineValue, deadlineUnit: qc!.deadlineUnit, channel: "FORMAL" }).estimatedDueAt !== null, "魁省 20 个日历日：给出估算到期日");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
