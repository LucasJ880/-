/**
 * KPI-2：期间看板 AI 解读纯函数核心（spec sales/period-narrative）
 * 运行：npx tsx src/lib/sales/__tests__/period-narrative-pure.test.ts
 */
import {
  ACTION_LABELS,
  allowedActionsFor,
  buildNarrativeUserPrompt,
  checkReferences,
  collectInputNumbers,
  extractNumberTokens,
  fallbackForError,
  finalizeNarrative,
  findUnknownNumber,
  isAllowedNumber,
  isPeriodNarrativeEnabled,
  NARRATIVE_SYSTEM_PROMPT,
  parseNarrativeOutput,
  projectNarrativeInput,
} from "../period/narrative-pure";
import type { PeriodSummaryResponse } from "../period/load";
import type { PeriodTotals } from "../period/types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const TOTALS: PeriodTotals = {
  wonCount: 23,
  wonAmount: 61230.5,
  wonPreTax: 54186.3,
  quotedCount: 57,
  quotedAmount: 182400,
  conversionRate: 0.4035,
  openQuotedCount: 21,
  openQuotedAmount: 70100,
  staleOpenCount: 6,
  staleOpenAmount: 19800,
  depositAmount: 18200,
  wonWithoutDepositCount: 4,
  wonWithoutDepositAmount: 9100,
  nonCadExcludedCount: 0,
};
const PREV: PeriodTotals = { ...TOTALS, wonCount: 19, wonAmount: 51890, quotedAmount: 196100, conversionRate: 0.35 };
const DELTA = Object.fromEntries(Object.keys(TOTALS).map((k) => [k, null])) as Record<keyof PeriodTotals, number | null>;
DELTA.wonAmount = 0.18;
DELTA.quotedAmount = -0.0699;

function summary(p: Partial<PeriodSummaryResponse> = {}): PeriodSummaryResponse {
  return {
    period: { from: "2026-10-01", to: "2026-10-28", days: 28, timezone: "America/Toronto" },
    scope: "org",
    totals: TOTALS,
    comparison: { kind: "prev_period", period: { from: "2026-09-03", to: "2026-09-30", days: 28, timezone: "America/Toronto" }, totals: PREV, delta: DELTA },
    byRep: [
      { userId: "u_alex", name: "Alex", wonCount: 9, wonAmount: 24100, quotedCount: 20, quotedAmount: 66000, conversionRate: 0.45 },
      { userId: "u_bo", name: "Bo", wonCount: 14, wonAmount: 37130.5, quotedCount: 37, quotedAmount: 116400, conversionRate: 0.3784 },
    ],
    insights: [
      { code: "I3_STALE_OPEN", severity: "warn", text: "6 份报价报出超过 14 天未签，合计 19,800", evidence: { staleOpenCount: 6, staleOpenAmount: 19800 } },
      { code: "I7_DEPOSIT_GAP", severity: "warn", text: "4 份已签报价未登记定金，合计 9,100", evidence: { wonWithoutDepositCount: 4, wonWithoutDepositAmount: 9100 } },
    ],
    calendar: { bySource: { qingyan: 2, member: 6, website: 4, unknown: 1 }, byActor: [{ userId: "u_alex", name: "Alex", bucket: "sales", created: 6 }] },
    narrative: null,
    narrativeEnabled: true,
    truncated: false,
    ...p,
  } as PeriodSummaryResponse;
}

const INPUT = projectNarrativeInput(summary());

function out(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}
const GOOD = {
  conclusion: ["本期成单 23 单，合计 $61,230.50，较上一期 +18%；转化率 40.4%。"],
  reasons: [{ text: "6 份报价报出超过 14 天未签，合计 19,800。", insightCodes: ["I3_STALE_OPEN"] }],
  nextSteps: [
    { action: "chase_signature", text: "先催 6 份超过 14 天的报价。", repName: null },
    { action: "review_rep", text: "看看 Alex 的 20 份报价。", repName: "Alex" },
  ],
};

console.log("开关");
{
  ok(isPeriodNarrativeEnabled({}) === false, "未设置 → 关");
  ok(isPeriodNarrativeEnabled({ SALES_PERIOD_NARRATIVE_ENABLED: "true" }) === true, "\"true\" → 开");
  ok(isPeriodNarrativeEnabled({ SALES_PERIOD_NARRATIVE_ENABLED: "1" }) === false && isPeriodNarrativeEnabled({ SALES_PERIOD_NARRATIVE_ENABLED: "TRUE" }) === false, "其它值 → 关");
}

console.log("输入投影");
{
  const s = JSON.stringify(INPUT);
  ok(!s.includes("u_alex") && !s.includes("userId"), "不含 userId", s.slice(0, 200));
  ok(INPUT.byRep.length === 2 && INPUT.byRep[0].name === "Alex", "全企业范围含按人姓名");
  ok(INPUT.calendar?.bySource.unknown === 1 && INPUT.calendar.byActor[0].name === "Alex", "全企业范围含日程来源");
  ok(INPUT.thresholds.staleOpenDays === 14 && INPUT.thresholds.lowConversionRate === 0.3, "阈值随输入给出");
  ok(INPUT.comparison.from === "2026-09-03" && INPUT.comparison.kind === "prev_period", "对比期日期与类型");
  ok(!("narrative" in INPUT) && !("narrativeEnabled" in INPUT), "不含解读字段本身");
  const keys = Object.keys(INPUT).sort().join(",");
  ok(keys === "allowedActions,byRep,calendar,comparison,insights,period,scope,thresholds,totals,truncated", "只有约定的键", keys);

  const own = projectNarrativeInput(summary({ scope: "own", byRep: [summary().byRep[1]] }));
  ok(own.byRep.length === 1 && own.byRep[0].name === "Bo" && !JSON.stringify(own).includes("Alex"), "本人范围只有本人一行，不含他人姓名", own.byRep);
  ok(own.calendar === null, "本人范围不给日程来源");
  ok(!own.allowedActions.includes("review_rep") && !own.allowedActions.includes("fix_calendar_rule"), "本人范围不给看某销售与补日程规则");
}

console.log("下一步前提");
{
  ok(JSON.stringify(allowedActionsFor(summary())) === JSON.stringify(["chase_signature", "record_deposit", "review_rep", "fix_calendar_rule"]), "四个前提都满足");
  const none = summary({ totals: { ...TOTALS, openQuotedCount: 0, wonWithoutDepositCount: 0 }, byRep: [], calendar: null });
  ok(allowedActionsFor(none).length === 0, "都不满足 → 空");
  ok(!allowedActionsFor(summary({ calendar: { bySource: { qingyan: 1, member: 1, website: 1, unknown: 0 } } })).includes("fix_calendar_rule"), "不明来源为 0 → 无补日程规则");
}

console.log("提示词");
{
  ok(NARRATIVE_SYSTEM_PROMPT.includes("只输出一个 JSON 对象") && NARRATIVE_SYSTEM_PROMPT.includes("allowedActions"), "要求只输出 JSON 并只用允许动作");
  ok(NARRATIVE_SYSTEM_PROMPT.includes("不得计算任何新数字") && NARRATIVE_SYSTEM_PROMPT.includes("阿拉伯数字"), "要求不算新数字、用阿拉伯数字");
  ok(NARRATIVE_SYSTEM_PROMPT.includes("conclusion") && NARRATIVE_SYSTEM_PROMPT.includes("reasons") && NARRATIVE_SYSTEM_PROMPT.includes("nextSteps"), "三段结构");
  ok(JSON.parse(buildNarrativeUserPrompt(INPUT)).totals.wonAmount === 61230.5, "用户提示词是输入 JSON");
}

console.log("解析");
{
  ok(parseNarrativeOutput(out(GOOD))?.conclusion.length === 1, "合法 JSON");
  ok(parseNarrativeOutput("```json\n" + out(GOOD) + "\n```")?.nextSteps.length === 2, "去掉 ```json 围栏");
  ok(parseNarrativeOutput("好的，以下是解读：" + out(GOOD))?.reasons.length === 1, "前置废话也能取出对象");
  ok(parseNarrativeOutput("{bad json") === null && parseNarrativeOutput("") === null, "坏 JSON → null");
  ok(parseNarrativeOutput(out({ ...GOOD, conclusion: [] })) === null, "结论为空 → null");
  ok(parseNarrativeOutput(out({ ...GOOD, conclusion: ["a", "b", "c", "d"] })) === null, "结论超过 3 句 → null");
  ok(parseNarrativeOutput(out({ ...GOOD, reasons: [GOOD.reasons[0], GOOD.reasons[0], GOOD.reasons[0], GOOD.reasons[0]] })) === null, "原因超过 3 条 → null");
  ok(parseNarrativeOutput(out({ ...GOOD, conclusion: ["长".repeat(201)] })) === null, "超过 200 字 → null");
  ok(parseNarrativeOutput(out({ conclusion: ["本期成单 23 单。"] }))?.reasons.length === 0, "缺 reasons / nextSteps 视为空");
  ok(parseNarrativeOutput(out({ ...GOOD, reasons: [{ text: "x" }] })) === null, "原因缺 insightCodes → null");
  ok(parseNarrativeOutput(out({ ...GOOD, nextSteps: [{ action: 3, text: "x" }] })) === null, "动作不是字符串 → null");
  ok(parseNarrativeOutput("[1,2]") === null, "数组 → null");
}

console.log("引用与词表");
{
  const p = (o: Record<string, unknown>) => parseNarrativeOutput(out(o))!;
  ok(checkReferences(p(GOOD), INPUT), "合法引用");
  ok(!checkReferences(p({ ...GOOD, reasons: [{ text: "成单变多。", insightCodes: ["I1_WON_DELTA"] }] }), INPUT), "引用不存在的洞察 → 拒绝");
  ok(!checkReferences(p({ ...GOOD, reasons: [{ text: "成单变多。", insightCodes: [] }] }), INPUT), "原因不引用洞察 → 拒绝");
  ok(!checkReferences(p({ ...GOOD, nextSteps: [{ action: "send_email", text: "发邮件。", repName: null }] }), INPUT), "词表外动作 → 拒绝");
  ok(!checkReferences(p({ ...GOOD, nextSteps: [{ action: "review_rep", text: "看看。", repName: "Carol" }] }), INPUT), "看某销售但姓名不在按人表 → 拒绝");
  ok(!checkReferences(p({ ...GOOD, nextSteps: [{ action: "review_rep", text: "看看。", repName: null }] }), INPUT), "看某销售不带姓名 → 拒绝");
  ok(!checkReferences(p({ ...GOOD, nextSteps: [{ action: "chase_signature", text: "催签。", repName: "Alex" }] }), INPUT), "其它动作带姓名 → 拒绝");
  const own = projectNarrativeInput(summary({ scope: "own", byRep: [summary().byRep[1]] }));
  ok(!checkReferences(p({ ...GOOD, nextSteps: [{ action: "review_rep", text: "看看自己。", repName: "Bo" }] }), own), "本人范围看某销售 → 拒绝（spec 场景）");
  const noStale = projectNarrativeInput(summary({ totals: { ...TOTALS, openQuotedCount: 0 } }));
  ok(!checkReferences(p({ ...GOOD, reasons: [], nextSteps: [{ action: "chase_signature", text: "催签。", repName: null }] }), noStale), "前提不满足的动作 → 拒绝");
}

console.log("数字切词");
{
  const t = extractNumberTokens("成单 $61,230.50，较上一期 +18%，约 6.1 万，转化率 40.4％，CAD 9,100");
  ok(t.map((x) => `${x.value}|${x.decimals}|${x.unit}|${x.sign}`).join(" ") === "61230.5|2|| 18|0|%|+ 6.1|1|万| 40.4|1|%| 9100|0||", "千分位 / 货币 / 正负号 / 百分比 / 万 / 全角百分号", t);
  ok(extractNumberTokens("２３ 单").map((x) => x.value).join() === "23", "全角数字按半角切");
  ok(extractNumberTokens("2026-10-28").map((x) => `${x.value}${x.sign}`).join(",") === "2026,10,28", "日期里的连字符不当负号");
  const bad = extractNumberTokens("65k、2K、6.5e4、2万4千、3 百");
  ok(bad.filter((x) => x.unsupported).length === 5 && bad.find((x) => x.raw.startsWith("2万"))?.unsupported === false, "k / K / 科学计数 / 千 / 百 标为不支持", bad);
  ok(extractNumberTokens("10月1日到28日").map((x) => x.value).join(",") === "10,1,28", "日期数字");
}

console.log("数字比对");
{
  const nums = collectInputNumbers(INPUT);
  const allowed = (s: string) => extractNumberTokens(s).every((t) => isAllowedNumber(t, nums));
  ok(allowed("转化率 40.4%，成单 $61,230.50"), "合法写法：百分比取 1 位、金额两位小数（spec 场景）");
  ok(allowed("成单 61,231") && allowed("成单 61230.5") && allowed("转化率 40%") && allowed("转化率 40.35%"), "取整到 0 / 1 / 2 位都可以");
  ok(allowed("约 6.1 万") && allowed("约 18.2 万报价"), "万换算");
  ok(allowed("较上一期 +18%") && allowed("报价金额 -7%") && allowed("−6.99%"), "变化率带正负号");
  ok(allowed("超过 14 天") && allowed("低于 30%") && allowed("占 40%") && allowed("达到 5 份"), "阈值");
  ok(allowed("10月1日到28日，共 28 天") && allowed("2026 年"), "期间日期与天数");
  ok(allowed("上一期 9 月 3 日至 30 日"), "对比期日期");
  ok(!allowed("本期成单 65,000"), "编造金额 → 不命中（spec 场景）");
  ok(allowed("成单 $61,230"), "截断写法也算（61,230.5 → 61,230）");
  ok(!allowed("合计 79,900"), "两数相加（19,800 + 60,100）→ 不命中");
  ok(!allowed("转化率 41%"), "百分比取整错误 → 不命中");
  ok(!allowed("约 6.2 万"), "万换算错误 → 不命中");
  ok(findUnknownNumber(["本期成单 23 单。", "本期成单 65,000。"], INPUT) === "65,000", "返回第一处对不上的数字");
  ok(findUnknownNumber(["有六份报价超过 14 天未签"], INPUT) === "六份", "中文数字计量词 → 拒绝（spec 场景）");
  ok(findUnknownNumber(["转化率约三成"], INPUT) === "三成", "三成 → 拒绝");
  ok(findUnknownNumber(["前两位销售贡献最多"], INPUT) === "两位", "两位 → 拒绝（有意的保守）");
  ok(findUnknownNumber(["成单金额集中在少数人"], INPUT) === null, "没有数字 → 通过");
}

console.log("独立审查补充：格式绕过");
{
  const bad = (s: string, name: string) => ok(findUnknownNumber([s], INPUT) !== null, name, s);
  bad("成单 ６５,０００ 加元", "全角编造数字 → 拒绝");
  bad("成单 sixty-five thousand", "英文数字词 → 拒绝");
  bad("成单六万元", "六万元 → 拒绝");
  bad("成单二万四千元", "二万四千元 → 拒绝");
  bad("转化率百分之五十", "百分之 → 拒绝");
  bad("两周内催签", "两周 → 拒绝");
  bad("成单翻一番", "翻一番 → 拒绝");
  bad("成单 2万4千", "2万4千 → 拒绝（千不支持）");
  bad("成单 I65000_X", "形似洞察代码的编造数字 → 拒绝");
  bad("成单 65k", "65k → 拒绝");
  bad("成单 2k", "2k → 拒绝（即使 2 在输入里）");
  bad("成单 6.5e4", "科学计数 → 拒绝");
  ok(findUnknownNumber(["见 I3_STALE_OPEN：6 份超过 14 天"], INPUT) === null, "输入里存在的洞察代码会被去掉再查");
}

console.log("独立审查补充：方向与宽松度");
{
  const nums = collectInputNumbers(INPUT);
  const allowed = (s: string) => extractNumberTokens(s).every((t) => isAllowedNumber(t, nums));
  ok(!allowed("报价金额 +7%"), "报价金额实为 -6.99%，写 +7% → 拒绝（同号）");
  ok(allowed("报价金额 -7%") && allowed("成单金额 +18%"), "同号 → 通过");
  ok(allowed("报价金额下降 7%"), "不带号的百分比按绝对值（方向写在文字里，见报告已知限制）");
  ok(!allowed("占 14%"), "数量 14 不能写成 14%（百分比只比对比率）");
  ok(!allowed("约 1 万") && !allowed("约 2 万"), "9,100 / 18,200 不能写成 1 万 / 2 万");
  ok(allowed("约 1.8 万"), "18,200 写成 1.8 万 → 通过");
  ok(!allowed("有 0.4 份"), "比率不当数量用");
  ok(!allowed("77 份") && !allowed("72 份"), "不在输入里的小整数 → 拒绝");
  const plainInts = Array.from({ length: 201 }, (_, i) => i).filter((i) => isAllowedNumber({ raw: String(i), value: i, decimals: 0, sign: "", unit: "", unsupported: false }, nums));
  ok(plainInts.length <= 30, `0–200 内可通过的整数 ${plainInts.length} 个（都来自输入的数量 / 金额 / 日期 / 阈值）`, plainInts);
}

console.log("独立审查补充：敏感信息");
{
  const withIds = summary({
    insights: [
      { code: "I5_REP_SILENT", severity: "warn", text: "Bo 本期没有报出报价（上一期 3 份）", evidence: { reps: "cm3x9k72a0002ab77c1d9e0f", count: 1 } },
      { code: "I6_REP_CONCENTRATION", severity: "info", text: "成单金额 61% 集中在 Bo", evidence: { userId: "cm3x9k72a0002ab77c1d9e0f", repWonAmount: 37130.5, share: 0.61 } },
    ],
  });
  const input = projectNarrativeInput(withIds);
  const raw = JSON.stringify(input);
  ok(!raw.includes("cm3x9k72a0002ab77c1d9e0f"), "洞察证据里的 userId 不进模型输入");
  ok(input.insights[1].evidence.share === 0.61 && input.insights[1].evidence.repWonAmount === 37130.5 && !("userId" in input.insights[1].evidence), "证据只留数值");
  ok(findUnknownNumber(["有 72 份报价"], input) === "72", "userId 里的数字不进允许集合");
  ok(findUnknownNumber(["上一期 3 份，成单 61% 集中在 Bo"], input) === null, "洞察文字里的数字与百分比可用");

  const emailRep = summary({
    byRep: [{ userId: "u_x", name: "x@fixture.test", wonCount: 1, wonAmount: 1, quotedCount: 1, quotedAmount: 1, conversionRate: 1 }],
    calendar: { bySource: { qingyan: 0, member: 1, website: 0, unknown: 0 }, byActor: [{ userId: "u_x", name: "x@fixture.test", bucket: "ops", created: 1 }] },
  });
  const masked = projectNarrativeInput(emailRep);
  ok(!JSON.stringify(masked).includes("@") && masked.byRep[0].name === "未命名成员 1" && masked.calendar?.byActor[0].name === "未命名成员 1", "邮箱姓名统一换成同一代号", masked.byRep);

  const zhName = projectNarrativeInput(summary({ byRep: [{ userId: "u_z", name: "张三", wonCount: 9, wonAmount: 24100, quotedCount: 20, quotedAmount: 66000, conversionRate: 0.45 }] }));
  ok(findUnknownNumber(["张三名下有 20 份报价"], zhName) === null, "成员姓名先去掉再查中文数字（张三名下不误杀）");
}

console.log("汇总与回落");
{
  const now = new Date("2026-10-29T15:00:00Z");
  const good = finalizeNarrative({ rawText: out(GOOD), input: INPUT, model: "fast-model", now });
  ok(good.fallbackReason === null && good.narrative?.conclusion.length === 1, "合法 → 通过", good);
  ok(good.narrative?.nextSteps[0].label === ACTION_LABELS.chase_signature && good.narrative.nextSteps[1].repName === "Alex", "动作带中文标签与姓名");
  ok(good.narrative?.model === "fast-model" && good.narrative.generatedAt === now.toISOString(), "模型与生成时间");
  ok(finalizeNarrative({ rawText: "抱歉", input: INPUT, model: "m", now }).fallbackReason === "invalid_format", "格式不对 → invalid_format");
  const fake = { ...GOOD, conclusion: ["本期成单 65,000。"] };
  const r1 = finalizeNarrative({ rawText: out(fake), input: INPUT, model: "m", now });
  ok(r1.narrative === null && r1.fallbackReason === "invalid_numbers", "编造数字 → invalid_numbers、narrative null");
  const badRef = { ...GOOD, reasons: [{ text: "成单变多。", insightCodes: ["I1_WON_DELTA"] }] };
  ok(finalizeNarrative({ rawText: out(badRef), input: INPUT, model: "m", now }).fallbackReason === "invalid_reference", "引用不存在 → invalid_reference（spec 场景）");
  const numInStep = { ...GOOD, nextSteps: [{ action: "chase_signature", text: "先催 7 份。", repName: null }] };
  ok(finalizeNarrative({ rawText: out(numInStep), input: INPUT, model: "m", now }).fallbackReason === "invalid_numbers", "下一步文字里的数字也比对");
  ok(fallbackForError(new Error("配额限制：月 AI 费用已达 hard limit")) === "budget_exceeded", "费用上限 → budget_exceeded");
  ok(fallbackForError(new Error("Request timed out")) === "model_error" && fallbackForError("x") === "model_error", "其它异常 → model_error");
}

console.log(`\nKPI-2 period-narrative-pure: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
