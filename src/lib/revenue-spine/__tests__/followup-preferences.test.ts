/**
 * Revenue Spine — 无回复跟进草稿使用 policy.fde 偏好（openspec change fde-preferences-in-followup）测试：纯函数 + 金样本 + 源码静态断言，无 DB。
 *   关闭时与实施前金样本逐字节比对、问候 / 敬语 / 结束语、必问免问、禁用词与保护范围、替换后拼出承诺的退回、起草接入点
 * 运行：npx tsx src/lib/revenue-spine/__tests__/followup-preferences.test.ts
 *
 * 公开仓库：只用虚构企业、人名与域名。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDraftPreferences } from "../draft-preferences";
import { buildNoReplyFollowUpDraft } from "../fde/no-reply-followup";
import { DEFAULT_REVENUE_SPINE_POLICY, mergeRevenueSpinePolicy, type RevenueSpinePolicy } from "../policy";
import { buildClarifyingQuestions } from "../rfq/missing-info";
import type { RfqField } from "../rfq/types";
import { FOLLOWUP_GOLDEN_FILE, followUpGoldenCases, type FollowUpGoldenCase, type FollowUpGoldenDraft } from "./fixtures/followup-golden-cases";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

function withPrefs(prefs: Record<string, unknown>, on: unknown = true): RevenueSpinePolicy {
  return mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, { fde: { useConfirmedPreferences: on, preferences: prefs } });
}

const FULL_PREFS = {
  greeting: { en: "Hi {name},", zh: "尊敬的{name}：" },
  closing: { en: "Looking forward to working with you.", zh: "盼复。" },
  valediction: { en: "Kind regards,", zh: "顺祝商祺" },
  priorityQuestions: ["incoterm"],
  skippedQuestions: ["targetPrice"],
  bannedPhrases: [{ phrase: "quotation", replacement: "offer" }],
};

/** 与 draftNoReplyFollowUps 同一调用方式：解析偏好，追问与草稿都传它 */
function draftFor(c: FollowUpGoldenCase, policy: RevenueSpinePolicy, missing: RfqField[] = c.missing) {
  const prefs = resolveDraftPreferences(policy);
  const questions = buildClarifyingQuestions(missing, c.input.language, 3, prefs);
  return { draft: buildNoReplyFollowUpDraft({ ...c.input, questions, preferences: prefs }), questions };
}

const caseById = (id: string) => {
  const c = followUpGoldenCases().find((x) => x.id === id);
  assert.ok(c, id);
  return c!;
};

console.log("followup-preferences");

console.log("\n金样本（关闭时字节级不变）");

const golden = JSON.parse(readFileSync(FOLLOWUP_GOLDEN_FILE, "utf8")) as FollowUpGoldenDraft[];

ok(`金样本覆盖 ${golden.length} 个用例（第 1 / 2 / 3 次 × 中英文 × 有无联系人 / 展会 / 追问 / 署名 / 对外英文名）`, () => {
  assert.deepEqual(golden.map((g) => g.id), followUpGoldenCases().map((c) => c.id));
  assert.ok(golden.length >= 10);
});

ok("场景「开关关闭但配了偏好」+ 不传偏好 + 开启但全空：主题、正文、追问字段与实施前逐字节相同", () => {
  for (const c of followUpGoldenCases()) {
    const want = golden.find((g) => g.id === c.id)!;
    for (const [label, policy] of [
      ["不传偏好", DEFAULT_REVENUE_SPINE_POLICY],
      ["配满偏好但关闭", withPrefs(FULL_PREFS, false)],
      ["开启但全空", withPrefs({})],
    ] as const) {
      const { draft, questions } = draftFor(c, policy);
      assert.deepEqual({ id: c.id, subject: draft.subject, body: draft.body, questionFields: questions.map((q) => q.field) }, want, `${c.id} · ${label}`);
    }
    // 不传偏好时草稿对象也不带 preferences
    assert.equal("preferences" in draftFor(c, DEFAULT_REVENUE_SPINE_POLICY).draft, false);
  }
});

console.log("\n问候 / 敬语 / 结束语 / 追问");

const on = withPrefs(FULL_PREFS);

ok("场景「问候与敬语」：英文 Hi Mark,、Kind regards,，结束语加在敬语前，署名块不变", () => {
  const { draft } = draftFor(caseById("en-step1-event-contact-signature"), on);
  const lines = draft.body.split("\n");
  assert.equal(lines[0], "Hi Mark,");
  assert.ok(draft.body.includes("\nLooking forward to working with you.\nKind regards,\nLucy\nSales Manager\nExample Home Textile\nWhatsApp +86 138 0013 8000\nwww.example-home.example"));
  assert.ok(!draft.body.includes("Best regards,"));
  assert.deepEqual(draft.preferences!.lines, ["Hi Mark,", "Looking forward to working with you.", "Kind regards,"]);
});

ok("场景「中文敬语与结束语」：祝好！→ 顺祝商祺，前面加一行 盼复。；问候用偏好模板", () => {
  const { draft } = draftFor(caseById("zh-step2-questions"), on);
  assert.equal(draft.body.split("\n")[0], "尊敬的王先生：");
  assert.ok(draft.body.includes("\n盼复。\n顺祝商祺\nLucy\n示例家纺"));
  assert.ok(!draft.body.includes("祝好！"));
});

ok("没有联系人名：沿用默认问候", () => {
  assert.equal(draftFor(caseById("en-step1-no-contact-no-event-no-questions"), on).draft.body.split("\n")[0], "Dear there,");
  assert.equal(draftFor(caseById("zh-step1-no-event-product"), on).draft.body.split("\n")[0], "您好：");
});

ok("场景「免问字段不问」：第一次不问目标价；第二次列出的待补信息里也没有；必问字段排最前", () => {
  const missing: RfqField[] = ["targetPrice", "incoterm", "packaging"];
  const off = draftFor(caseById("en-step1-event-contact-signature"), DEFAULT_REVENUE_SPINE_POLICY, missing);
  assert.deepEqual(off.questions.map((q) => q.field), ["packaging", "targetPrice", "incoterm"]);
  const first = draftFor(caseById("en-step1-event-contact-signature"), on, missing);
  assert.deepEqual(first.questions.map((q) => q.field), ["incoterm", "packaging"]);
  assert.match(first.draft.body, /1\. Which trade term do you prefer/);
  assert.doesNotMatch(first.draft.body, /target price/i);
  const second = draftFor(caseById("zh-step2-questions"), on, missing);
  assert.match(second.draft.body, /只要您告知贸易术语、包装，我们就为您准备报价。/);
  assert.doesNotMatch(second.draft.body, /目标价/);
});

console.log("\n禁用词");

ok("场景「模板句子里的禁用词被替换」：quotation → offer（主题不替换）", () => {
  const c = caseById("en-step1-event-contact-signature");
  const { draft } = draftFor(c, on);
  assert.match(draft.body, /To prepare an accurate offer for you, we only need a few details:/);
  const off = draftFor(c, DEFAULT_REVENUE_SPINE_POLICY).draft;
  assert.equal(draft.subject, off.subject);
});

ok("场景「专名与署名不替换」：产品说法、展会名、署名块、对外英文名原样保留", () => {
  const c = caseById("en-step1-event-contact-signature");
  const banned = withPrefs({
    bannedPhrases: [
      { phrase: "Flannel", replacement: "X" },
      { phrase: "Heimtextil", replacement: "X" },
      { phrase: "Sales Manager", replacement: "X" },
      { phrase: "Home", replacement: "X" },
      { phrase: "Mark", replacement: "X" },
    ],
  });
  const { draft } = draftFor(c, banned);
  assert.equal(draft.body, draftFor(c, DEFAULT_REVENUE_SPINE_POLICY).draft.body);
});

ok("场景「替换后拼出承诺」：这一封不替换，记下引起违规的键名；守卫违规仍为空", () => {
  const base = caseById("en-step1-event-contact-signature");
  const c: FollowUpGoldenCase = { ...base, input: { ...base.input, product: "samples kit", event: null } };
  const prefs = { bannedPhrases: [{ phrase: "quotation", replacement: "offer" }, { phrase: "about", replacement: "free" }] };
  assert.deepEqual(resolveDraftPreferences(withPrefs(prefs))!.ignored, []);
  const plain = draftFor(c, DEFAULT_REVENUE_SPINE_POLICY).draft;
  const { draft } = draftFor(c, withPrefs(prefs));
  assert.deepEqual(draft.guardrailViolations, []);
  assert.deepEqual(draft.preferences!.bannedPhrasesSkipped, ["bannedPhrases[1]"]);
  assert.equal(draft.body, plain.body);
});

ok("偏好跟进草稿仍过守卫：10 例金样本输入配满偏好，守卫违规均为空", () => {
  for (const c of followUpGoldenCases()) assert.deepEqual(draftFor(c, on).draft.guardrailViolations, [], c.id);
});

console.log("\n起草接入点");

ok("draftNoReplyFollowUps：组织级解析一次偏好；追问与草稿（含中文对照）传入；违规与本封未替换都走同一套审计", () => {
  const src = strip(read("src/lib/revenue-spine/fde/no-reply-followup.ts"));
  const run = src.slice(src.indexOf("export async function draftNoReplyFollowUps"));
  assert.equal(run.match(/resolveDraftPreferences\(/g)?.length, 1);
  // 解析在循环之外
  assert.ok(run.indexOf("const draftPrefs = resolveDraftPreferences(policy);") < run.indexOf("for (const opp of candidates)"));
  assert.match(run, /questions: buildClarifyingQuestions\(missing, lang, 3, draftPrefs\),/);
  assert.match(run, /preferences: draftPrefs,\s*\}\);/);
  // 中文对照走同一个 input()：同样带偏好
  assert.match(run, /const reviewZh = language === "en" \? buildNoReplyFollowUpDraft\(input\("zh"\)\) : null;/);
  assert.match(run, /if \(draftPrefs\?\.ignored\.length && !prefsAudited\) \{\s*prefsAudited = true;\s*await recordIgnoredDraftPreferencesSafe\(\{ orgId, userId: principalUserId, ignored: draftPrefs\.ignored, employeeKey: FDE_EMPLOYEE_KEY \}\);/);
  assert.match(run, /ignored: skippedBanned\.map\(\(key\) => \(\{ key, reason: BANNED_PHRASE_SKIPPED_REASON \}\)\),/);
  // 守卫判定与原先相同：仍在建审批之前
  assert.ok(run.indexOf("if (draft.guardrailViolations.length)") < run.indexOf("await requestApproval("));
});

ok("首封与跟进共用同一个保护行替换函数（不复制规则）", () => {
  const followup = strip(read("src/lib/revenue-spine/fde/no-reply-followup.ts"));
  const reply = strip(read("src/lib/revenue-spine/reply-draft.ts"));
  assert.match(followup, /applyBannedPhrasesSafely\(\{/);
  assert.match(reply, /const r = applyBannedPhrasesSafely\(\{/);
  assert.doesNotMatch(followup, /replaceBannedPhrases\(/);
});

console.log(`\nfollowup-preferences: ${pass} passed`);
