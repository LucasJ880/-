/**
 * Revenue Spine — FDE 首封回复草稿的团队偏好（B-3，openspec change fde-preferences-in-draft）测试：纯函数 + 假依赖 + 源码静态断言，无 DB。
 *   policy.fde 合并、偏好校验与违规忽略、追问排序、模板（问候 / 结束语 / 敬语 / 禁用词与保护行）、
 *   润色回退、关闭时与实施前金样本逐字节比对、违规审计去重与脱敏、FDE 接入点
 * 运行：npx tsx src/lib/revenue-spine/__tests__/draft-preferences.test.ts
 *
 * 公开仓库：只用虚构企业、人名与域名。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BANNED_PHRASES_LIMIT,
  DRAFT_PREFERENCES_AUDIT_TARGET,
  DRAFT_PREFERENCES_IGNORED_AUDIT_ACTION,
  ignoredAuditWhere,
  ignoredFingerprint,
  recordIgnoredDraftPreferences,
  recordIgnoredDraftPreferencesSafe,
  resolveDraftPreferences,
  type IgnoredAuditDeps,
  type ResolvedDraftPreferences,
} from "../draft-preferences";
import { DEFAULT_REVENUE_SPINE_POLICY, EMPTY_FDE_DRAFT_PREFERENCES, mergeRevenueSpinePolicy, type FdeDraftPreferences, type RevenueSpinePolicy } from "../policy";
import { buildReplyDraft, checkDraftGuardrails, countBannedPhrases, polishReplyDraftWithLlm, replaceBannedPhrases, type ReplyDraftInput } from "../reply-draft";
import { buildClarifyingQuestions, computeMissingFields } from "../rfq/missing-info";
import type { RfqField } from "../rfq/types";
import { CONFIGURED_POLICY, GOLDEN_FILE, goldenCases, type GoldenCase, type GoldenDraft } from "./fixtures/draft-golden-cases";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

/** 开关 + 偏好 → 合并后的 policy（走真实合并规则） */
function withPrefs(prefs: Partial<FdeDraftPreferences> | Record<string, unknown>, on: unknown = true, base: RevenueSpinePolicy = DEFAULT_REVENUE_SPINE_POLICY): RevenueSpinePolicy {
  return mergeRevenueSpinePolicy(base, { fde: { useConfirmedPreferences: on, preferences: prefs } });
}

const FULL_PREFS = {
  greeting: { en: "Hi {name},", zh: "尊敬的{name}：" },
  closing: { en: "Looking forward to working with you.", zh: "盼复。" },
  valediction: { en: "Kind regards,", zh: "顺祝商祺" },
  priorityQuestions: ["incoterm", "quantity"],
  skippedQuestions: ["targetPrice"],
  bannedPhrases: [
    { phrase: "inquiry", replacement: "request" },
    { phrase: "询盘", replacement: "需求" },
  ],
};

function caseById(id: string): GoldenCase {
  const c = goldenCases().find((x) => x.id === id);
  assert.ok(c, id);
  return c!;
}

/** 与 inbound-sales 同一调用方式：先解析偏好，追问与草稿都传它 */
function draftFor(c: GoldenCase, policy: RevenueSpinePolicy) {
  const prefs = resolveDraftPreferences(policy);
  const lang = c.input.language === "zh" ? "zh" : "en";
  const questions = buildClarifyingQuestions(computeMissingFields(c.input.fields), lang, policy.followUp.maxQuestionsPerReply, prefs);
  const input: ReplyDraftInput = { ...c.input, policy, questions, preferences: prefs };
  return { draft: buildReplyDraft(input), questions, prefs };
}

async function main() {
  console.log("\npolicy.fde 合并");

  await ok("场景「存量 policy 没有 fde 段」：默认关闭、偏好全空；没有 fde 的旧对象合并后也补上默认", () => {
    assert.deepEqual(DEFAULT_REVENUE_SPINE_POLICY.fde, { useConfirmedPreferences: false, preferences: EMPTY_FDE_DRAFT_PREFERENCES });
    const legacy = { ...DEFAULT_REVENUE_SPINE_POLICY, fde: undefined } as unknown as RevenueSpinePolicy;
    assert.deepEqual(mergeRevenueSpinePolicy(legacy, { followUp: { staleAfterDays: 30 } }).fde, DEFAULT_REVENUE_SPINE_POLICY.fde);
    // 其它段覆盖不动 fde
    const on = withPrefs(FULL_PREFS);
    assert.deepEqual(mergeRevenueSpinePolicy(on, { notify: { wechatOnNewDraft: true } }).fde, on.fde);
  });

  await ok("场景「开关只认布尔值」：\"true\" / 1 / null 视为关闭（沿用 base）；true 开启", () => {
    for (const v of ["true", 1, null, "yes"]) assert.equal(withPrefs({}, v).fde.useConfirmedPreferences, false, String(v));
    assert.equal(withPrefs({}, true).fde.useConfirmedPreferences, true);
    assert.equal(mergeRevenueSpinePolicy(withPrefs({}, true), { fde: { useConfirmedPreferences: false } }).fde.useConfirmedPreferences, false);
  });

  await ok("形状合并：文案按语言逐键覆盖、空串 / 非字符串记为未配置；数组整体替换只留字符串；禁用词缺替换词记为空串", () => {
    const a = withPrefs({ greeting: { en: "Hi {name}," }, closing: { zh: "" }, valediction: { en: 42 }, priorityQuestions: ["incoterm", 3, null], bannedPhrases: [{ phrase: "inquiry" }, { phrase: 9 }, "x"] });
    assert.deepEqual(a.fde.preferences.greeting, { zh: null, en: "Hi {name}," });
    assert.deepEqual(a.fde.preferences.closing, { zh: null, en: null });
    assert.deepEqual(a.fde.preferences.valediction, { zh: null, en: null });
    assert.deepEqual(a.fde.preferences.priorityQuestions, ["incoterm"]);
    assert.deepEqual(a.fde.preferences.bannedPhrases, [{ phrase: "inquiry", replacement: "" }]);
    // 再覆盖一个语言：另一个语言保留
    const b = mergeRevenueSpinePolicy(a, { fde: { preferences: { greeting: { zh: "尊敬的{name}：" } } } });
    assert.deepEqual(b.fde.preferences.greeting, { zh: "尊敬的{name}：", en: "Hi {name}," });
    assert.equal(b.fde.useConfirmedPreferences, true);
    // 内容不在合并时校验：含数字的文案原样保存（起草时才判并留审计）
    assert.equal(withPrefs({ closing: { zh: "我们 24 小时内回复。" } }).fde.preferences.closing.zh, "我们 24 小时内回复。");
  });

  await ok("场景「写入后读回」：PUT 的合并 → 存 JSON → 加载合并，fde 一致；开关写错类型沿用当前值；null 沿用、[] 清空", () => {
    // 与 PUT /api/revenue/policy 相同：current ← body.policy，去掉 businessProfile 后存进 OrgBusinessRule
    const current = withPrefs({ bannedPhrases: [{ phrase: "inquiry", replacement: "request" }], skippedQuestions: ["targetPrice"] });
    const merged = mergeRevenueSpinePolicy(current, { fde: { useConfirmedPreferences: "false", preferences: { greeting: { en: "Hi {name}," }, bannedPhrases: null, skippedQuestions: [] } } });
    const rest: Record<string, unknown> = { ...merged };
    delete rest.businessProfile;
    const reloaded = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, JSON.parse(JSON.stringify(rest)));
    assert.deepEqual(reloaded.fde, merged.fde);
    assert.equal(reloaded.fde.useConfirmedPreferences, true);
    assert.equal(reloaded.fde.preferences.greeting.en, "Hi {name},");
    assert.deepEqual(reloaded.fde.preferences.bannedPhrases, [{ phrase: "inquiry", replacement: "request" }]);
    assert.deepEqual(reloaded.fde.preferences.skippedQuestions, []);
    // policy 接口源码：GET / PUT 都原样返回合并后的 policy（含 fde）
    const route = strip(read("src/app/api/revenue/policy/route.ts"));
    assert.match(route, /const merged = mergeRevenueSpinePolicy\(current, body\.policy\);/);
    assert.match(route, /return NextResponse\.json\(\{ policy \}\);/);
  });

  console.log("\n偏好校验");

  await ok("关闭时不解析：配满偏好也返回 null", () => {
    assert.equal(resolveDraftPreferences(withPrefs(FULL_PREFS, false)), null);
    assert.equal(resolveDraftPreferences(DEFAULT_REVENUE_SPINE_POLICY), null);
  });

  await ok("开启且全部合法：逐项生效，生效键名按偏好顺序", () => {
    const r = resolveDraftPreferences(withPrefs(FULL_PREFS))!;
    assert.deepEqual(r.ignored, []);
    assert.deepEqual(r.applied, ["greeting.zh", "greeting.en", "closing.zh", "closing.en", "valediction.zh", "valediction.en", "priorityQuestions", "skippedQuestions", "bannedPhrases"]);
    assert.deepEqual(r.priorityQuestions, ["incoterm", "quantity"]);
    assert.deepEqual(r.skippedQuestions, ["targetPrice"]);
    assert.deepEqual(resolveDraftPreferences(withPrefs(FULL_PREFS)), r);
  });

  await ok("场景「含商务承诺的偏好被忽略」：其它合法偏好照常生效", () => {
    const r = resolveDraftPreferences(withPrefs({ ...FULL_PREFS, closing: { en: "Free samples are available on request.", zh: "盼复。" } }))!;
    assert.equal(r.closing.en, null);
    assert.equal(r.closing.zh, "盼复。");
    const hit = r.ignored.find((i) => i.key === "closing.en");
    assert.match(hit!.reason, /^含商务承诺：样品免费承诺/);
    assert.equal(r.greeting.en, "Hi {name},");
  });

  await ok("场景「含数字的偏好被忽略」及其它文案规则：换行 / 超长 / 花括号 / {name} 缺失或重复 / 为空", () => {
    const r = resolveDraftPreferences(
      withPrefs({
        greeting: { en: "Hello there,", zh: "{name}{name}您好：" },
        closing: { zh: "我们 24 小时内回复。", en: "Thanks\nagain" },
        valediction: { en: "x".repeat(121), zh: "  {sig}  " },
      }),
    )!;
    const reasons = Object.fromEntries(r.ignored.map((i) => [i.key, i.reason]));
    assert.deepEqual(reasons, {
      "greeting.zh": "{name} 只能出现一次",
      "greeting.en": "缺少 {name}",
      "closing.zh": "含数字",
      "closing.en": "含换行",
      "valediction.zh": "不能含花括号",
      "valediction.en": "超过 120 字",
    });
    assert.deepEqual(r.applied, []);
    // 守卫在 {name} 去掉之后对文案本身运行：问候里写承诺也会被拦
    const g = resolveDraftPreferences(withPrefs({ greeting: { en: "Hi {name}, we guarantee delivery" } }))!;
    assert.match(g.ignored[0].reason, /^含商务承诺/);
  });

  await ok("场景「字段名不合法」：必填不能免问、未知字段、重复、与必问冲突", () => {
    const r = resolveDraftPreferences(
      withPrefs({ priorityQuestions: ["budget", "incoterm", "incoterm", " packaging "], skippedQuestions: ["quantity", "packaging", "targetPrice", "targetPrice", "color"] }),
    )!;
    assert.deepEqual(r.priorityQuestions, ["incoterm", "packaging"]);
    assert.deepEqual(r.skippedQuestions, ["targetPrice"]);
    assert.deepEqual(r.ignored, [
      { key: "priorityQuestions[0]", reason: "不是可追问的字段" },
      { key: "priorityQuestions[2]", reason: "重复" },
      { key: "skippedQuestions[0]", reason: "必填字段不能免问" },
      { key: "skippedQuestions[1]", reason: "与必问冲突" },
      { key: "skippedQuestions[3]", reason: "重复" },
      // color 是 RFQ 字段，但不在追问字段表里
      { key: "skippedQuestions[4]", reason: "不是可追问的字段" },
    ]);
  });

  await ok("全角数字与数字词也算数字：天数 / 金额不能经偏好进草稿", () => {
    const r = resolveDraftPreferences(
      withPrefs({
        closing: { zh: "我们３天内发货。", en: "We ship within ３ days." },
        valediction: { en: "Price is ten dollars per piece.", zh: "三天内发货，价格五美元一件。" },
        greeting: { en: "Hi {name}, delivery within three days", zh: "{name}，百分之百满意：" },
      }),
    )!;
    assert.deepEqual(Object.fromEntries(r.ignored.map((i) => [i.key, i.reason])), {
      "greeting.zh": "含数字词",
      "greeting.en": "含数字词",
      "closing.zh": "含数字",
      "closing.en": "含数字",
      "valediction.zh": "含数字词",
      "valediction.en": "含数字词",
    });
    // 常见问候 / 结束语不误伤
    const fine = resolveDraftPreferences(withPrefs({ greeting: { en: "Dear {name},", zh: "{name}，您好：" }, closing: { en: "We look forward to working with you.", zh: "一切顺利，盼复。" }, valediction: { en: "Best wishes,", zh: "顺祝商祺" } }))!;
    assert.deepEqual(fine.ignored, []);
    const fw = resolveDraftPreferences(withPrefs({ bannedPhrases: [{ phrase: "２４/7", replacement: "" }] }))!;
    assert.equal(fw.ignored[0].reason, "禁用词含数字");
  });

  await ok("数字词补漏：中文无单位数词 / 大写数字 / 非十进制数字 / a week；赠送折扣等商务条款用语；常见客套话不误拦", () => {
    const reasonOf = (t: string) => resolveDraftPreferences(withPrefs({ closing: { zh: t } }))!.ignored[0]?.reason ?? null;
    for (const t of ["每款起订五百，交期十五，盼复。", "MOQ一千起。", "起订量一百。", "十来天交货。", "壹佰件起订", "within a week", "a fortnight", "a couple of weeks", "a third off", "十分钟内回复", "千万件现货"])
      assert.equal(reasonOf(t), "含数字词", t);
    for (const t of ["½ off", "③ days", "Ⅲ天"]) assert.equal(reasonOf(t), "含数字", t);
    for (const t of ["买一送一", "可以打对折", "价格优惠", "Fast delivery guaranteed", "We offer the best prices"]) assert.equal(reasonOf(t), "含商务条款用语", t);
    for (const t of ["One more thing, thanks", "Please double-check the details", "Your one-stop supplier", "祝您一天愉快", "祝新的一年万事如意", "十分感谢", "百忙之中", "第一时间回复您", "Feel free to contact me.", "谨送上祝福"])
      assert.equal(reasonOf(t), null, t);
    // 私用区分隔符不能出现在禁用词 / 替换词里
    assert.equal(resolveDraftPreferences(withPrefs({ bannedPhrases: [{ phrase: "in\uE000quiry", replacement: "" }] }))!.ignored[0].reason, "禁用词含控制字符");
  });

  await ok("ignored 按偏好出现顺序：链式被拒的条目排回原位", () => {
    const r = resolveDraftPreferences(withPrefs({ bannedPhrases: [{ phrase: "inquiry", replacement: "request" }, { phrase: "INQUIRY", replacement: "x" }, { phrase: "request", replacement: "ask" }] }))!;
    assert.deepEqual(r.ignored, [
      { key: "bannedPhrases[0]", reason: "替换词含禁用词" },
      { key: "bannedPhrases[1]", reason: "重复" },
    ]);
  });

  await ok("替换词含禁用词（会链式替换）→ 整条忽略", () => {
    const r = resolveDraftPreferences(
      withPrefs({
        bannedPhrases: [
          { phrase: "inquiry", replacement: "request" },
          { phrase: "request", replacement: "ask" },
          { phrase: "kindly", replacement: "kindly please" },
        ],
      }),
    )!;
    assert.deepEqual(r.bannedPhrases, [{ key: "bannedPhrases[1]", phrase: "request", replacement: "ask" }]);
    assert.deepEqual(r.ignored, [
      { key: "bannedPhrases[0]", reason: "替换词含禁用词" },
      { key: "bannedPhrases[2]", reason: "替换词含禁用词" },
    ]);
  });

  await ok("禁用词规则：含数字 / 太短 / 重复（不区分大小写）/ 替换词含承诺 / 超出上限；替换词可为空串", () => {
    const r = resolveDraftPreferences(
      withPrefs({
        bannedPhrases: [
          { phrase: "24/7", replacement: "always" },
          { phrase: "a", replacement: "" },
          { phrase: "inquiry", replacement: "request" },
          { phrase: "Inquiry", replacement: "ask" },
          { phrase: "cheap", replacement: "free samples" },
          { phrase: "kindly", replacement: "" },
        ],
      }),
    )!;
    assert.deepEqual(r.bannedPhrases, [
      { key: "bannedPhrases[2]", phrase: "inquiry", replacement: "request" },
      { key: "bannedPhrases[5]", phrase: "kindly", replacement: "" },
    ]);
    assert.deepEqual(
      r.ignored.map((i) => [i.key, i.reason.replace(/：.*$/, "")]),
      [
        ["bannedPhrases[0]", "禁用词含数字"],
        ["bannedPhrases[1]", "禁用词长度须为 2–60 字"],
        ["bannedPhrases[3]", "重复"],
        ["bannedPhrases[4]", "替换词含商务承诺"],
      ],
    );
    const many = resolveDraftPreferences(withPrefs({ bannedPhrases: Array.from({ length: BANNED_PHRASES_LIMIT + 2 }, (_, i) => ({ phrase: `word${"x".repeat(i % 3)}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, replacement: "" })) }))!;
    assert.equal(many.bannedPhrases.length, BANNED_PHRASES_LIMIT);
    assert.deepEqual(many.ignored.map((i) => i.reason), ["超出上限（30 条）", "超出上限（30 条）"]);
  });

  console.log("\n追问排序");

  const missingAll: RfqField[] = computeMissingFields({
    productCategory: "bathrobe",
    productName: "hotel bathrobes",
    material: "cotton terry",
    composition: null,
    size: null,
    quantity: null,
    unit: null,
    color: null,
    customLogo: null,
    customization: null,
    packaging: null,
    certification: null,
    sampleRequired: null,
    targetPrice: null,
    currency: null,
    destinationCountry: "Canada",
    destinationCity: null,
    incoterm: null,
    requiredDeliveryDate: null,
    buyerType: null,
    application: null,
  });
  const fieldsOf = (qs: Array<{ field: RfqField }>) => qs.map((q) => q.field);

  await ok("场景「必问字段先问」：必问 incoterm、quantity 都缺失、上限 3 → 依次问贸易术语、数量，再接默认顺序的下一个", () => {
    const q = buildClarifyingQuestions(missingAll, "en", 3, { priorityQuestions: ["incoterm", "quantity"], skippedQuestions: [] });
    assert.deepEqual(fieldsOf(q), ["incoterm", "quantity", "size"]);
    assert.equal(q[0].question, "Which trade term do you prefer (FOB / CIF / DDP)?");
  });

  await ok("场景「免问字段不问」：免问 targetPrice → 不问，空出的名额由下一个缺失字段补上；必问里不缺失的字段不影响", () => {
    const base = fieldsOf(buildClarifyingQuestions(missingAll, "en", 13));
    assert.ok(base.includes("targetPrice"));
    const q = fieldsOf(buildClarifyingQuestions(missingAll, "en", 13, { priorityQuestions: ["material"], skippedQuestions: ["targetPrice"] }));
    assert.deepEqual(q, base.filter((f) => f !== "targetPrice"));
  });

  await ok("不传偏好 / 传 null / 传空偏好：与原来的顺序一致", () => {
    for (const max of [1, 3, 8]) {
      const base = fieldsOf(buildClarifyingQuestions(missingAll, "zh", max));
      assert.deepEqual(fieldsOf(buildClarifyingQuestions(missingAll, "zh", max, null)), base);
      assert.deepEqual(fieldsOf(buildClarifyingQuestions(missingAll, "zh", max, { priorityQuestions: [], skippedQuestions: [] })), base);
    }
  });

  console.log("\n草稿模板");

  const EN = caseById("en-website-configured-facts");
  const ZH = caseById("zh-website-configured-facts");
  const on = withPrefs(FULL_PREFS, true, CONFIGURED_POLICY);

  await ok("场景「问候模板生效」：英文 Hi Mark,；中文 尊敬的王先生：", () => {
    assert.equal(draftFor(EN, on).draft.body.split("\n")[0], "Hi Mark,");
    assert.equal(draftFor(ZH, on).draft.body.split("\n")[0], "尊敬的王先生：");
  });

  await ok("场景「没有联系人名」：沿用默认问候（Dear there, / 您好：）", () => {
    const en = draftFor(caseById("en-website-no-contact-default-policy"), withPrefs(FULL_PREFS));
    assert.equal(en.draft.body.split("\n")[0], "Dear there,");
    const zh = draftFor(caseById("zh-website-no-contact-default-policy"), withPrefs(FULL_PREFS));
    assert.equal(zh.draft.body.split("\n")[0], "您好：");
    // 没用上的偏好问候不算偏好行
    assert.ok(!en.draft.preferences!.lines.includes("Hi {name},"));
  });

  await ok("场景「结束语与敬语」：替换默认结束语与 Best regards,，署名块不变", () => {
    const d = draftFor(EN, on).draft.body;
    assert.ok(d.includes("\nLooking forward to working with you.\n"));
    assert.ok(!d.includes("We look forward to hearing from you."));
    assert.ok(d.includes("\nKind regards,\nLucy\nSales Manager\nExample Home Textile\nWhatsApp +86 138 0013 8000\nwww.example-home.example"));
    assert.ok(!d.includes("Best regards,"));
  });

  await ok("场景「中文敬语」：配置后加在署名前；未配置时没有这一行", () => {
    const d = draftFor(ZH, on).draft.body;
    assert.ok(d.includes("\n盼复。\n\n顺祝商祺\nLucy\nSales Manager\n示例家纺"));
    const plain = draftFor(ZH, withPrefs({ closing: { zh: "盼复。" } }, true, CONFIGURED_POLICY)).draft.body;
    assert.ok(plain.includes("\n盼复。\n\nLucy\nSales Manager"));
  });

  await ok("草稿带偏好行与禁用词（只在传入偏好时出现）", () => {
    const d = draftFor(EN, on).draft;
    assert.deepEqual(d.preferences!.lines, ["Hi Mark,", "Looking forward to working with you.", "Kind regards,"]);
    assert.deepEqual(d.preferences!.bannedPhrases, ["inquiry", "询盘"]);
    assert.equal(d.preferences!.bannedPhrasesSkipped, undefined);
    // 保护行：需求复述、条款原句、"需内部确认"段、署名、偏好行
    for (const l of ["- Quantity: 3000 pcs", "Loading ports: Ningbo or Shanghai.", "Regarding pricing: our team will confirm this internally once we have the details above and revert to you with a formal reply.", "Sales Manager", "Kind regards,"])
      assert.ok(d.preferences!.keptLines.includes(l), l);
    const off = draftFor(EN, CONFIGURED_POLICY).draft;
    assert.equal("preferences" in off, false);
  });

  await ok("场景「模板句子里的禁用词被替换」：英文 inquiry → request；中文 询盘 → 需求", () => {
    const en = draftFor(EN, on).draft.body;
    assert.match(en, /We have received your request about hotel bathrobes\./);
    assert.equal(countBannedPhrases(en, ["inquiry"]), 0);
    const zh = draftFor(ZH, on).draft.body;
    assert.match(zh, /我们已收到您关于hotel bathrobes的需求。/);
  });

  await ok("场景「事实与参考值不替换」：需求复述、参考值原句、样品说明、参考项目、署名块、主题原样保留", () => {
    const banned = withPrefs(
      {
        bannedPhrases: [
          { phrase: "cotton terry", replacement: "fabric" },
          { phrase: "pre-production", replacement: "PP" },
          { phrase: "stock samples", replacement: "samples" },
          { phrase: "Canadian", replacement: "North American" },
          { phrase: "Sales Manager", replacement: "Rep" },
          { phrase: "Re", replacement: "About" },
        ],
      },
      true,
      CONFIGURED_POLICY,
    );
    const { draft } = draftFor(EN, banned);
    const base = draftFor(EN, CONFIGURED_POLICY).draft;
    assert.ok(draft.body.includes("- Material: cotton terry"));
    assert.ok(draft.body.includes("after pre-production sample approval. Both are confirmed"));
    assert.ok(draft.body.includes("Regarding samples: We can send stock samples within 3 days"));
    assert.ok(draft.body.includes("We have produced hotel bathrobes for a Canadian hotel group."));
    assert.ok(draft.body.endsWith("Lucy\nSales Manager\nExample Home Textile\nWhatsApp +86 138 0013 8000\nwww.example-home.example"));
    assert.equal(draft.subject, base.subject);
    // 这些都是保护行，正文与不传偏好时完全一致
    assert.equal(draft.body, base.body);
  });

  await ok("「需内部确认」段不被禁用词改写（中英文）", () => {
    const zh = draftFor(ZH, withPrefs({ bannedPhrases: [{ phrase: "需内部确认", replacement: "没有问题" }] }, true, CONFIGURED_POLICY)).draft;
    assert.equal(zh.body, draftFor(ZH, CONFIGURED_POLICY).draft.body);
    const en = draftFor(EN, withPrefs({ bannedPhrases: [{ phrase: "will confirm", replacement: "have approved" }, { phrase: "internally", replacement: "" }] }, true, CONFIGURED_POLICY)).draft;
    assert.equal(en.body, draftFor(EN, CONFIGURED_POLICY).draft.body);
    assert.match(en.body, /our team will confirm this internally/);
  });

  await ok("只发目录（C 级）：链接不被禁用词改坏", () => {
    const c = caseById("en-trade-show-grade-c-catalog-only");
    const d = draftFor(c, withPrefs({ bannedPhrases: [{ phrase: "catalog", replacement: "brochure" }, { phrase: "www", replacement: "web" }] }, true, CONFIGURED_POLICY)).draft;
    assert.ok(d.body.includes("https://www.example-home.example/catalog"), d.body);
  });

  await ok("模板句子里嵌着的专名不替换：买家公司名、组织名、展会名、买家产品名；模板词照常替换", () => {
    const show = caseById("en-trade-show-styles-configured");
    const d = draftFor(show, withPrefs({ bannedPhrases: [{ phrase: "booth", replacement: "stand" }, { phrase: "Canton", replacement: "X" }] }, true, CONFIGURED_POLICY)).draft;
    assert.match(d.body, /Thank you for visiting the Example Home Textile stand at the Canton Fair \(Booth 14\.3E07\)/);
    const web = draftFor(EN, withPrefs({ bannedPhrases: [{ phrase: "Northwind", replacement: "X" }, { phrase: "hotel", replacement: "X" }, { phrase: "Home", replacement: "X" }] }, true, CONFIGURED_POLICY)).draft;
    assert.match(web.body, /Thank you for contacting Example Home Textile on behalf of Northwind Hotels\. We have received your inquiry about hotel bathrobes\./);
  });

  await ok("禁用词替换后拼出承诺：这一封不做替换（不被守卫拦在审批外），记下引起违规的那一条", () => {
    // "free" 单独过得了校验，替换进 "your inquiry about samples kit" 就成了 "your free samples kit"
    const c = { ...EN, input: { ...EN.input, fields: { ...EN.input.fields, productName: "samples kit" } } };
    const prefs = { bannedPhrases: [{ phrase: "Thank you", replacement: "Thanks" }, { phrase: "inquiry about", replacement: "free" }] };
    assert.deepEqual(resolveDraftPreferences(withPrefs(prefs))!.ignored, []);
    const base = draftFor(c, CONFIGURED_POLICY).draft;
    assert.deepEqual(base.guardrailViolations, []);
    const d = draftFor(c, withPrefs(prefs, true, CONFIGURED_POLICY)).draft;
    assert.deepEqual(d.guardrailViolations, []);
    assert.deepEqual(d.preferences!.bannedPhrasesSkipped, ["bannedPhrases[1]"]);
    assert.equal(d.body, base.body);
  });

  await ok("替换前就有违规时仍退回、替换前的违规照常保留；单条都不引起、组合才引起时记全部键名", () => {
    // 买家产品名带"free samples"：不传偏好就有违规；prepare→beat + quotation→offer 组合拼出 "beat an accurate offer"（比价）
    const c = { ...EN, input: { ...EN.input, fields: { ...EN.input.fields, productName: "free samples towels" } } };
    const base = draftFor(c, CONFIGURED_POLICY).draft;
    assert.ok(base.guardrailViolations.length > 0);
    const prefs = { bannedPhrases: [{ phrase: "prepare", replacement: "beat" }, { phrase: "quotation", replacement: "offer" }] };
    assert.deepEqual(resolveDraftPreferences(withPrefs(prefs))!.ignored, []);
    const d = draftFor(c, withPrefs(prefs, true, CONFIGURED_POLICY)).draft;
    assert.deepEqual(d.guardrailViolations, base.guardrailViolations);
    assert.equal(d.body, base.body);
    assert.deepEqual(d.preferences!.bannedPhrasesSkipped, ["bannedPhrases[0]", "bannedPhrases[1]"]);
  });

  await ok("$ 不当替换模式：联系人名与替换词里的 $ 原样写出", () => {
    const d = draftFor({ ...EN, input: { ...EN.input, contactName: "Jo$'" } }, withPrefs({ greeting: { en: "Hi {name}, welcome" } }, true, CONFIGURED_POLICY)).draft;
    assert.equal(d.body.split("\n")[0], "Hi Jo$', welcome");
    assert.equal(replaceBannedPhrases("关于询盘的", [{ phrase: "询盘", replacement: "$'" }]), "关于$'的");
    assert.equal(replaceBannedPhrases("an inquiry here", [{ phrase: "inquiry", replacement: "$&x" }]), "an $&x here");
  });

  await ok("替换细节：英文整词、不区分大小写、句首保持大写；替换成空串合并空格；中文按子串", () => {
    assert.equal(replaceBannedPhrases("Inquiry received. Your inquiry form", [{ phrase: "inquiry", replacement: "request" }]), "Request received. Your request form");
    assert.equal(replaceBannedPhrases("inquiryForm stays", [{ phrase: "inquiry", replacement: "request" }]), "inquiryForm stays");
    assert.equal(replaceBannedPhrases("We kindly ask you , thanks", [{ phrase: "kindly", replacement: "" }]), "We ask you, thanks");
    assert.equal(replaceBannedPhrases("关于询盘的询盘", [{ phrase: "询盘", replacement: "需求" }]), "关于需求的需求");
    assert.equal(replaceBannedPhrases("no change here", [{ phrase: "inquiry", replacement: "x" }]), "no change here");
    assert.equal(replaceBannedPhrases("Kindly note the MOQ", [{ phrase: "kindly", replacement: "" }]), "note the MOQ");
    assert.equal(replaceBannedPhrases("see www.inquiry.example/inquiry", [{ phrase: "inquiry", replacement: "x" }]), "see www.inquiry.example/inquiry");
    // 专名按词边界挡：专名 "Re" / "an" 不挡住 received / accurate
    assert.equal(replaceBannedPhrases("We received an accurate list", [{ phrase: "received", replacement: "got" }, { phrase: "accurate", replacement: "precise" }], ["Re", "an", "ce"]), "We got an precise list");
    assert.equal(replaceBannedPhrases("Dear Dear,", [{ phrase: "Dear", replacement: "Hello" }], ["Dear"]), "Dear Dear,");
    // 输入里本来就像占位符的片段原样保留；纯数字款号与多个专名不拆坏占位符
    assert.equal(replaceBannedPhrases("foo \uE0000\uE001 inquiry", [{ phrase: "inquiry", replacement: "request" }]), "foo \uE0000\uE001 request");
    const terms = ["10", ...Array.from({ length: 12 }, (_, i) => `Term${String.fromCharCode(65 + i)}`)];
    const line = `${terms.join(" ")} inquiry 10`;
    assert.equal(replaceBannedPhrases(line, [{ phrase: "inquiry", replacement: "request" }], terms), `${terms.join(" ")} request 10`);
    assert.equal(countBannedPhrases("Inquiry, inquiry; INQUIRY! inquiryForm", ["inquiry"]), 3);
  });

  await ok("场景「偏好草稿仍过守卫」：最终草稿守卫照跑，参考值原句规则不变", () => {
    for (const c of goldenCases()) {
      const { draft } = draftFor(c, withPrefs(FULL_PREFS, true, c.input.policy));
      assert.deepEqual(draft.guardrailViolations, [], c.id);
    }
    // 守卫本身对偏好文案同样有效（替换词造不出承诺）
    assert.ok(checkDraftGuardrails("Free samples are available on request.").length > 0);
  });

  console.log("\n金样本（关闭时字节级不变）");

  const golden = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as GoldenDraft[];
  const render = (c: GoldenCase, policy: RevenueSpinePolicy): GoldenDraft => {
    const { draft, questions } = draftFor(c, policy);
    return { id: c.id, subject: draft.subject, body: draft.body, questionFields: questions.map((q) => q.field) };
  };

  await ok(`金样本覆盖 ${golden.length} 个用例（中英文 / 有无联系人 / 官网 / 展会 / 参考款 / C 级只发目录 / 有无商务事实）`, () => {
    assert.deepEqual(golden.map((g) => g.id), goldenCases().map((c) => c.id));
    assert.ok(golden.length >= 10);
  });

  await ok("场景「开关关闭但配了偏好」+ 不传偏好 + 开启但偏好全空：主题、正文、追问字段与实施前逐字节相同", () => {
    for (const c of goldenCases()) {
      const want = golden.find((g) => g.id === c.id)!;
      const variants: Array<[string, RevenueSpinePolicy]> = [
        ["不传偏好", c.input.policy],
        ["配满偏好但关闭", withPrefs(FULL_PREFS, false, c.input.policy)],
        ["开启但全空", withPrefs({}, true, c.input.policy)],
      ];
      for (const [label, policy] of variants) assert.deepEqual(render(c, policy), want, `${c.id} · ${label}`);
    }
  });

  console.log("\n润色回退");

  const polishCase = () => draftFor(EN, on).draft;
  const polishWith = (draft: ReturnType<typeof polishCase>, fn: (body: string) => string) =>
    polishReplyDraftWithLlm(draft, { orgId: "org_x", userId: "u_x", complete: async (body) => fn(body) });

  await ok("润色保留偏好行、没多用禁用词 → 采用润色稿", async () => {
    const d = polishCase();
    const r = await polishWith(d, (b) => b.replace("Thank you for contacting", "Many thanks for contacting"));
    assert.equal(r.templateOnly, false);
    assert.ok(r.body.includes("Many thanks for contacting"));
  });

  await ok("场景「润色丢了偏好问候」：回退模板草稿", async () => {
    const d = polishCase();
    const r = await polishWith(d, (b) => b.replace("Hi Mark,", "Dear Mark,"));
    assert.equal(r, d);
  });

  await ok("场景「润色引入禁用词」：回退模板草稿", async () => {
    const d = polishCase();
    const r = await polishWith(d, (b) => b.replace("We have received your request", "We have received your inquiry"));
    assert.equal(r, d);
  });

  await ok("润色把保护行里的禁用词挪进模板句子（同时改了复述行）：次数不变也回退", async () => {
    const policy = withPrefs({ bannedPhrases: [{ phrase: "cotton", replacement: "fabric" }] }, true, CONFIGURED_POLICY);
    const d = draftFor(EN, policy).draft;
    assert.ok(d.body.includes("- Material: cotton terry"));
    const r = await polishWith(d, (b) => b.replace("- Material: cotton terry", "- Material: terry").replace("Thank you for contacting", "Thank you (cotton lovers) for contacting"));
    assert.equal(r, d);
  });

  await ok("开关关闭：润色判定不变（改了默认问候照样采用）", async () => {
    const d = draftFor(EN, CONFIGURED_POLICY).draft;
    const r = await polishWith(d, (b) => b.replace("Dear Mark,", "Hello Mark,"));
    assert.equal(r.templateOnly, false);
  });

  await ok("提示词只在有偏好行或禁用词时追加约束；守卫仍在润色之后", () => {
    const src = strip(read("src/lib/revenue-spine/reply-draft.ts"));
    assert.match(src, /const preferencePrompt =\s*prefLines\.length \|\| banned\.length\s*\?/);
    assert.match(src, /: "";/);
    assert.match(src, /"Keep the same language as the input\. Output only the email body\." \+\s*preferencePrompt,/);
    const polish = src.slice(src.indexOf("export async function polishReplyDraftWithLlm"));
    assert.ok(polish.indexOf("checkDraftWithReferenceLines(body, refs)") > polish.indexOf("createCompletion("));
    // 模板的守卫在禁用词替换之后对最终正文运行
    const build = src.slice(src.indexOf("export function buildReplyDraft"), src.indexOf("export async function polishReplyDraftWithLlm"));
    const finish = build.lastIndexOf("body = finishBody(lines, subject);");
    assert.ok(finish > 0 && build.lastIndexOf("checkDraftWithReferenceLines(`${subject}\\n${body}`, referenceLines)") > finish);
  });

  console.log("\n违规审计");

  function fakeAuditDeps(recorded = false) {
    const audits: Array<Parameters<IgnoredAuditDeps["audit"]>[0]> = [];
    const checks: Array<[string, string]> = [];
    const deps: IgnoredAuditDeps = {
      alreadyRecorded: async (orgId, fp) => {
        checks.push([orgId, fp]);
        return recorded;
      },
      audit: async (a) => {
        audits.push(a);
      },
    };
    return { deps, audits, checks };
  }

  const leaky = resolveDraftPreferences(withPrefs({ closing: { en: "Our price is the best in 2026." }, greeting: { en: "Hi {name}," } }))! as ResolvedDraftPreferences;

  await ok("场景「首次遇到违规」：写一条审计，只含键名与原因、指纹与员工键，不含文案原文", async () => {
    const f = fakeAuditDeps();
    const wrote = await recordIgnoredDraftPreferences({ orgId: "org_x", userId: "u_owner", ignored: leaky.ignored, employeeKey: "inbound_sales_fde" }, f.deps);
    assert.equal(wrote, true);
    assert.equal(f.audits.length, 1);
    assert.deepEqual(f.audits[0].afterData, { fingerprint: ignoredFingerprint(leaky.ignored), ignored: [{ key: "closing.en", reason: "含数字" }], employeeKey: "inbound_sales_fde" });
    const json = JSON.stringify(f.audits[0]);
    assert.ok(!json.includes("Our price") && !json.includes("2026"), json);
  });

  await ok("场景「同一组违规不重复记」：已记过 → 不写；指纹与顺序无关；没有违规 → 不查不写", async () => {
    const f = fakeAuditDeps(true);
    assert.equal(await recordIgnoredDraftPreferences({ orgId: "org_x", userId: "u", ignored: leaky.ignored, employeeKey: "k" }, f.deps), false);
    assert.equal(f.audits.length, 0);
    const a = [{ key: "a", reason: "x" }, { key: "b", reason: "y" }];
    assert.equal(ignoredFingerprint(a), ignoredFingerprint([...a].reverse()));
    assert.notEqual(ignoredFingerprint(a), ignoredFingerprint([{ key: "a", reason: "x" }]));
    assert.match(ignoredFingerprint(a), /^prefs-ignored:[0-9a-f]{16}$/);
    const g = fakeAuditDeps();
    assert.equal(await recordIgnoredDraftPreferences({ orgId: "org_x", userId: "u", ignored: [], employeeKey: "k" }, g.deps), false);
    assert.deepEqual([g.checks.length, g.audits.length], [0, 0]);
  });

  await ok("审计失败不影响起草；去重查询限定组织、动作、目标与指纹", async () => {
    const boom: IgnoredAuditDeps = {
      alreadyRecorded: async () => false,
      audit: async () => {
        throw new Error("db down");
      },
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(await recordIgnoredDraftPreferencesSafe({ orgId: "org_x", userId: "u", ignored: leaky.ignored, employeeKey: "k" }, boom), false);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(ignoredAuditWhere("org_x", "prefs-ignored:abc"), {
      orgId: "org_x",
      action: DRAFT_PREFERENCES_IGNORED_AUDIT_ACTION,
      targetType: DRAFT_PREFERENCES_AUDIT_TARGET,
      targetId: "org_x",
      afterData: { contains: "prefs-ignored:abc" },
    });
    assert.equal(DRAFT_PREFERENCES_IGNORED_AUDIT_ACTION, "revenue_spine.draft_preferences.ignored");
  });

  console.log("\nFDE 接入点");

  await ok("inbound-sales：解析一次偏好，追问、草稿、审核用中文版都用它；违规走尽力而为的审计；事件只记键名", () => {
    const src = strip(read("src/lib/revenue-spine/fde/inbound-sales.ts"));
    assert.equal(src.match(/resolveDraftPreferences\(/g)?.length, 1);
    assert.match(src, /const draftPrefs = resolveDraftPreferences\(policy\);/);
    assert.match(src, /if \(draftPrefs\?\.ignored\.length\) \{\s*await recordIgnoredDraftPreferencesSafe\(\{ orgId, userId: principalUserId, ignored: draftPrefs\.ignored, employeeKey: FDE_EMPLOYEE_KEY \}\);/);
    assert.equal(src.match(/buildClarifyingQuestions\(missing, [^)]*, draftPrefs\)/g)?.length, 2);
    // main 上中文审核稿抽成 zhInput（展位英文首封与纯文本两条路径共用），追问同样带偏好
    assert.match(src, /policy,\s*preferences: draftPrefs,\s*\};\s*const zhInput = \{ \.\.\.draftInput, language: "zh" as const, questions: buildClarifyingQuestions\(missing, "zh", policy\.followUp\.maxQuestionsPerReply, draftPrefs\) \};\s*draft = buildReplyDraft\(draftInput\);/);
    assert.match(src, /\.\.\.\(draftPrefs\s*\?\s*\{\s*draftPreferences: \{\s*applied: draftPrefs\.applied,\s*ignored: draftPrefs\.ignored\.map\(\(i\) => i\.key\),/);
    // 替换后过不了守卫、这封没替换：同一套去重审计记一次
    assert.match(src, /const skippedBanned = draft\.preferences\?\.bannedPhrasesSkipped \?\? \[\];\s*if \(skippedBanned\.length\) \{\s*await recordIgnoredDraftPreferencesSafe\(\{\s*orgId,\s*userId: principalUserId,\s*ignored: skippedBanned\.map\(\(key\) => \(\{ key, reason: BANNED_PHRASE_SKIPPED_REASON \}\)\),/);
    // 顺序：模板 → 润色 → 守卫判定
    const build = src.indexOf("draft = buildReplyDraft(draftInput);");
    const polish = src.indexOf("draft = await polishReplyDraftWithLlm(draft");
    const guard = src.indexOf("draft.guardrailViolations.length > 0");
    assert.ok(build > 0 && polish > build && guard > polish, JSON.stringify({ build, polish, guard }));
  });

  await ok("不碰的模块：employee-ai、policy 接口都不读偏好；跟进草稿（C-2）只经 resolveDraftPreferences 读偏好", () => {
    const followup = strip(read("src/lib/revenue-spine/fde/no-reply-followup.ts"));
    assert.match(followup, /resolveDraftPreferences\(policy\)/);
    assert.doesNotMatch(followup, /policy\.fde\.preferences|\.fde\.useConfirmedPreferences/);
    assert.doesNotMatch(read("src/app/api/revenue/policy/route.ts"), /draft-preferences/);
    assert.doesNotMatch(strip(read("src/lib/revenue-spine/draft-preferences.ts")), /from "@\/lib\/employee-ai/);
  });

  console.log(`\ndraft-preferences: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
