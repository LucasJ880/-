/**
 * 厂家入驻向导（PRD F6）— 纯函数：输入校验、品类发布计划、成员 / 邀请规则、就绪清单、测试标记，
 * 以及路由层的静态契约（平台管理员守卫、路由配置字面量）。无 DB。
 * 运行：npx tsx src/lib/organizations/__tests__/onboarding-rules.test.ts
 *
 * 公开仓库：只用虚构企业（Example Textiles / Maple Home Goods）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listIndustryPacks, resolveIndustryPack } from "@/lib/industry-packs/registry";
import { DEFAULT_MENGXIN_MODULES } from "@/lib/tenancy/modules";
import {
  DEFAULT_BUSINESS_PROFILE,
  DEFAULT_PRODUCT_KEYWORDS,
  mergeBusinessProfile,
} from "@/lib/revenue-spine/policy";
import { mentionsAllowedCategory, scoreOpportunity } from "@/lib/revenue-spine/scoring";
import { DEFAULT_REVENUE_SPINE_POLICY } from "@/lib/revenue-spine/policy";
import { extractRfqHeuristic } from "@/lib/revenue-spine/rfq/heuristic-extractor";
import { classifyInquiry } from "@/lib/revenue-spine/research";
import { detectInquiryRisks } from "@/lib/revenue-spine/inquiry-risks";
import { normalizeInquiry } from "@/lib/trade/website-inquiry";
import { factoryOwnerRoleProblem,
  EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES,
  ONBOARDING_TEST_BUYER_EMAIL,
  ONBOARDING_TEST_CLOSE_REASON,
  ONBOARDING_TEST_TAG,
  ONBOARDING_TEST_UTM_SOURCE,
  buildOnboardingTestInquiryPayload,
  checkOrgBoundInvite,
  deriveOnboardingSteps,
  formatInviteCode,
  hasOnboardingTestTag,
  isOnboardingTestEventId,
  nextOnboardingTestCounter,
  onboardingTestEventId,
  planBusinessProfileCategories,
  planExistingOrgAdoption,
  planMembership,
  validateCategorySelection,
  validateInviteRequest,
  validateOnboardingPatch,
  validateProvisionRequest,
  withOnboardingTestTag,
  type ExistingOrgFacts,
  type OnboardingFacts,
} from "../onboarding-rules";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const pack = resolveIndustryPack("home_textile_trade_v1");
assert.equal(pack.status, "ok");
const catalog = pack.status === "ok" ? pack.pack.productCategoryCatalog ?? [] : [];

console.log("onboarding — industry pack");

ok("家纺外贸包：默认工作空间与种子脚本一致（6 个部门）", () => {
  assert.ok(pack.status === "ok");
  assert.deepEqual(
    pack.pack.defaultWorkspaces?.map((w) => w.slug),
    ["international-trade", "product-development", "supply-chain", "sales", "content-production", "marketing"],
  );
  assert.ok(pack.pack.defaultWorkspaces?.every((w) => w.type === "department"));
});

ok("家纺外贸包：模块与既有家纺企业默认模块一致", () => {
  assert.ok(pack.status === "ok");
  assert.deepEqual([...pack.pack.enabledModules].sort(), [...DEFAULT_MENGXIN_MODULES].sort());
});

ok("品类目录：12 个 key，覆盖 Revenue Spine 默认词表的全部类目", () => {
  const keys = catalog.map((c) => c.key);
  for (const k of ["blanket", "bathrobe", "towel", "cushion", "bedding", "slipper", "curtain", "table_linen", "gift_set", "baby", "textile_accessory", "pet"]) {
    assert.ok(keys.includes(k), `缺少 ${k}`);
  }
  assert.equal(new Set(keys).size, keys.length, "key 不重复");
  const defaultCats = new Set(Object.values(DEFAULT_PRODUCT_KEYWORDS));
  for (const c of defaultCats) assert.ok(keys.includes(c), `默认词表类目 ${c} 不在目录里`);
  for (const c of catalog) {
    assert.ok(c.labelZh && c.labelEn, `${c.key} 缺少中英文名`);
    // 默认词表没有的类目必须自带识别词，否则「不做」勾了也识别不出来
    if (!defaultCats.has(c.key)) assert.ok(c.keywords?.length, `${c.key} 需要自带 keywords`);
  }
});

ok("其它行业包不受影响：无品类目录、仍可解析；兼容别名 home_textile 继承目录", () => {
  for (const p of listIndustryPacks()) assert.equal(resolveIndustryPack(p.id).status, "ok");
  const generic = resolveIndustryPack("generic_business_v1");
  assert.ok(generic.status === "ok" && !generic.pack.productCategoryCatalog && !generic.pack.defaultWorkspaces);
  const alias = resolveIndustryPack("home_textile");
  assert.ok(alias.status === "ok" && alias.pack.productCategoryCatalog?.length === catalog.length);
  assert.equal(resolveIndustryPack(null).status, "missing", "仍不静默回退家纺");
});

console.log("onboarding — validation");

ok("建企业：合法输入；时区缺省为 Asia/Shanghai；邮箱小写", () => {
  const v = validateProvisionRequest({ name: " Example  Textiles ", code: "Example-Textiles", industryPackId: "home_textile_trade_v1", ownerEmail: "Boss@Example.com" });
  assert.ok(v.ok);
  assert.deepEqual(v.value, { name: "Example Textiles", code: "example-textiles", industryPackId: "home_textile_trade_v1", timezone: "Asia/Shanghai", ownerEmail: "boss@example.com" });
});

ok("建企业：拒绝非法 code / personal- 前缀 / 兼容别名包 / 未知包 / 无效时区 / 坏邮箱", () => {
  const bad = (raw: Record<string, unknown>) => {
    const v = validateProvisionRequest({ name: "Example Textiles", code: "example-textiles", industryPackId: "home_textile_trade_v1", ...raw });
    assert.ok(!v.ok, JSON.stringify(raw));
    return v.errors.join("|");
  };
  assert.match(bad({ code: "Example Textiles!" }), /code/);
  assert.match(bad({ code: "personal-abc12345" }), /personal-/);
  assert.match(bad({ industryPackId: "home_textile" }), /行业包/);
  assert.match(bad({ industryPackId: "made_up_pack" }), /行业包/);
  assert.match(bad({ timezone: "Mars/Olympus" }), /时区/);
  assert.match(bad({ ownerEmail: "not-an-email" }), /邮箱/);
  assert.match(bad({ name: "" }), /名称/);
});

ok("PATCH：只允许时区 / 行业包 / 老板邮箱 / 可确认步骤；空 patch 拒绝", () => {
  const good = validateOnboardingPatch({ timezone: "America/Toronto", acknowledge: { wechat: true, email_sender: false }, ownerEmail: "Owner@Example.com" });
  assert.ok(good.ok);
  assert.deepEqual(good.value, { timezone: "America/Toronto", acknowledge: { wechat: true, email_sender: false }, ownerEmail: "owner@example.com" });
  const badStep = validateOnboardingPatch({ acknowledge: { test_inquiry: true } });
  assert.ok(!badStep.ok && /不可手动确认/.test(badStep.errors.join()));
  assert.ok(!validateOnboardingPatch({}).ok);
  assert.ok(!validateOnboardingPatch({ industryPackId: "home_textile" }).ok);
  const leave = validateOnboardingPatch({ leaveOrg: true });
  assert.ok(leave.ok && leave.value.leaveOrg === true, "交接：退出成员单独可提交");
  assert.ok(!validateOnboardingPatch({ leaveOrg: false }).ok, "leaveOrg 只能为 true");
  assert.ok(!validateOnboardingPatch({ leaveOrg: "yes" }).ok);
});

ok("品类：按目录顺序输出；未知 key / 重叠 / 没有「做」均拒绝", () => {
  const v = validateCategorySelection({ make: ["towel", "blanket", "towel"], dontMake: ["pet", "bedding"] }, catalog);
  assert.ok(v.ok);
  assert.deepEqual(v.value, { make: ["blanket", "towel"], dontMake: ["bedding", "pet"], excludedCategoryAction: "review" });
  const unknown = validateCategorySelection({ make: ["sofa"] }, catalog);
  assert.ok(!unknown.ok && /未知品类：sofa/.test(unknown.errors.join()));
  const overlap = validateCategorySelection({ make: ["towel"], dontMake: ["towel"] }, catalog);
  assert.ok(!overlap.ok && /既做又不做/.test(overlap.errors.join()));
  assert.ok(!validateCategorySelection({ make: [], dontMake: ["pet"] }, catalog).ok);
  assert.ok(!validateCategorySelection({ make: ["towel"] }, undefined).ok, "无目录的行业包不走品类");
  const decline = validateCategorySelection({ make: ["towel"], excludedCategoryAction: "decline" }, catalog);
  assert.ok(decline.ok && decline.value.excludedCategoryAction === "decline");
  assert.ok(!validateCategorySelection({ make: ["towel"], excludedCategoryAction: "ignore" }, catalog).ok);
});

console.log("onboarding — business profile plan");

const EXISTING_PROFILE = {
  primaryMarkets: ["Canada"],
  productCategories: ["blanket"],
  productKeywords: { "sherpa throw": "blanket", "pet blanket": "pet" },
  commercialFacts: { moq: { quantity: 800, unit: "pcs", per: "style" }, catalogUrl: "https://example-textiles.com/catalog.pdf" },
  samplePolicy: { available: true, note: "Samples in 7 days" },
};

ok("品类发布只改品类字段：主市场、商务事实、样品政策原样保留（整份覆盖不会清空）", () => {
  const sel = validateCategorySelection({ make: ["blanket", "towel"], dontMake: ["bedding", "gift_set"] }, catalog);
  assert.ok(sel.ok);
  const cfg = planBusinessProfileCategories(EXISTING_PROFILE, sel.value, catalog);
  assert.deepEqual(cfg.primaryMarkets, ["Canada"]);
  assert.deepEqual(cfg.commercialFacts, EXISTING_PROFILE.commercialFacts);
  assert.deepEqual(cfg.samplePolicy, EXISTING_PROFILE.samplePolicy);
  assert.deepEqual(cfg.productCategories, ["blanket", "towel"]);
  assert.deepEqual(cfg.excludedCategories, ["bedding", "gift_set"]);
  assert.equal(cfg.excludedCategoryAction, "review");
  const kw = cfg.productKeywords as Record<string, string>;
  assert.equal(kw["sherpa throw"], "blanket", "企业自定义识别词保留");
  assert.equal(kw["gift set"], "gift_set", "勾选的目录类目带上自带识别词");
  assert.equal(kw["pet blanket"], undefined, "未勾选的目录类目撤回它的识别词");
  assert.equal(kw["pet bed"], undefined);
  // 不改原对象
  assert.deepEqual(EXISTING_PROFILE.productCategories, ["blanket"]);
});

ok("发布后的配置被 Revenue Spine 正确读取：做 / 不做 / 识别词生效", () => {
  const sel = validateCategorySelection({ make: ["blanket", "bathrobe", "towel"], dontMake: ["bedding", "slipper", "pet"] }, catalog);
  assert.ok(sel.ok);
  const merged = mergeBusinessProfile(DEFAULT_BUSINESS_PROFILE, planBusinessProfileCategories(null, sel.value, catalog));
  assert.deepEqual(merged.productCategories, ["blanket", "bathrobe", "towel"]);
  assert.deepEqual(merged.excludedCategories, ["bedding", "slipper", "pet"]);
  assert.equal(merged.productKeywords["pet bed"], "pet");
  assert.equal(merged.productKeywords.towel, "towel", "默认词表仍在");

  const policy = { ...DEFAULT_REVENUE_SPINE_POLICY, businessProfile: merged };
  const text = "Hi, we need 2000 pet beds in grey for our pet stores in Canada. Please quote.";
  const extraction = extractRfqHeuristic(text, { productKeywords: merged.productKeywords });
  assert.equal(extraction.fields.productCategory, "pet");
  const research = classifyInquiry({ name: "Ava", email: "ava@maplehome.example", company: "Maple Home Goods", phone: null, country: "Canada", website: null, message: text });
  const score = scoreOpportunity({ fields: extraction.fields, research, message: text, policy });
  assert.equal(score.outOfRange, true, "只询「不做」的品类 → 不自动起草，留人工");
});

ok("「不做」对复合词生效：baby blankets / pet blankets / hair towels 里的 blankets、towels 不算在做的类目", () => {
  const sel = validateCategorySelection(
    { make: ["blanket", "towel", "bathrobe"], dontMake: ["baby", "pet", "textile_accessory", "slipper"], excludedCategoryAction: "decline" },
    catalog,
  );
  assert.ok(sel.ok);
  const merged = mergeBusinessProfile(DEFAULT_BUSINESS_PROFILE, planBusinessProfileCategories(null, sel.value, catalog));
  const policy = { ...DEFAULT_REVENUE_SPINE_POLICY, businessProfile: merged };
  const run = (text: string) => {
    const extraction = extractRfqHeuristic(text, { productKeywords: merged.productKeywords });
    const research = classifyInquiry({ name: "Ava", email: "ava@maplehome.example", company: "Maple Home Goods", phone: null, country: "Canada", website: null, message: text });
    const score = scoreOpportunity({ fields: extraction.fields, research, message: text, policy });
    return { category: extraction.fields.productCategory, outOfRange: score.outOfRange, next: score.recommendedNextAction };
  };
  for (const [text, category] of [
    ["We need 2000 baby blankets for our stores in Canada.", "baby"],
    ["Please quote 3000 pet blankets, grey and beige.", "pet"],
    ["Looking for 5000 hair towels with logo embroidery.", "textile_accessory"],
    ["我们需要 2000 条婴儿浴巾，请报价。", "baby"],
  ] as const) {
    const r = run(text);
    assert.equal(r.category, category, text);
    assert.equal(r.outOfRange, true, `${text} → 不做`);
    assert.equal(r.next, "decline", `${text} → 按 decline 处理`);
  }
  // 同时提到在做的类目：仍按混合询盘处理（不判不做）
  assert.equal(run("We need baby blankets and adult fleece blankets, 1000 pcs each.").outOfRange, false);
  assert.equal(run("Quote 2000 bathrobes and 2000 slippers for a hotel.").outOfRange, false);
  assert.equal(run("Need 800 swaddles for a baby store.").outOfRange, true);
  // 直接测：命中落在更长的「不做」词里才被忽略
  assert.equal(mentionsAllowedCategory("2000 baby blankets", policy), false);
  assert.equal(mentionsAllowedCategory("2000 baby blankets and 500 blankets", policy), true);
  assert.equal(mentionsAllowedCategory("hair towels, bath towels", policy), true);
  assert.equal(mentionsAllowedCategory("hair towels", policy), false);
});

console.log("onboarding — invites & membership");

ok("企业邀请码：只能 trade / sales；企业角色只能 org_member / org_admin；数量与有效期有界", () => {
  const v = validateInviteRequest({});
  assert.ok(v.ok);
  assert.deepEqual(v.value, { role: "trade", orgRole: "org_member", count: 1, expiresInDays: 7, label: null });
  for (const role of ["admin", "boss", "super_admin", "manager", "user"]) {
    assert.ok(!validateInviteRequest({ role }).ok, `不允许 ${role}`);
  }
  assert.ok(!validateInviteRequest({ orgRole: "org_owner" }).ok);
  assert.ok(!validateInviteRequest({ count: 0 }).ok);
  assert.ok(!validateInviteRequest({ count: 21 }).ok);
  assert.ok(!validateInviteRequest({ expiresInDays: 31 }).ok);
  assert.ok(validateInviteRequest({ role: "sales", orgRole: "org_admin", count: 20, expiresInDays: 30 }).ok);
});

ok("注册时二次校验：带 orgId 的邀请码角色越界一律拒绝；orgRole 缺省为 org_member", () => {
  assert.deepEqual(checkOrgBoundInvite({ orgId: "org1", orgRole: null, role: "trade" }), { ok: true, orgId: "org1", orgRole: "org_member" });
  assert.ok(checkOrgBoundInvite({ orgId: "org1", orgRole: "org_admin", role: "sales" }).ok);
  assert.ok(!checkOrgBoundInvite({ orgId: "org1", orgRole: "org_member", role: "admin" }).ok);
  assert.ok(!checkOrgBoundInvite({ orgId: "org1", orgRole: "org_member", role: "boss" }).ok);
  assert.ok(!checkOrgBoundInvite({ orgId: "org1", orgRole: "org_owner", role: "trade" }).ok);
  assert.ok(!checkOrgBoundInvite({ orgId: null, orgRole: "org_member", role: "trade" }).ok);
});

ok("成员幂等：不降级 owner / admin；停用的按目标角色重新启用；低角色升到目标", () => {
  assert.deepEqual(planMembership(null, "org_admin"), { action: "create", role: "org_admin" });
  assert.deepEqual(planMembership({ role: "org_owner", status: "active" }, "org_admin"), { action: "keep", role: "org_owner" });
  assert.deepEqual(planMembership({ role: "org_admin", status: "active" }, "org_member"), { action: "keep", role: "org_admin" });
  assert.deepEqual(planMembership({ role: "org_member", status: "active" }, "org_owner"), { action: "update", role: "org_owner" });
  assert.deepEqual(planMembership({ role: "org_admin", status: "inactive" }, "org_member"), { action: "update", role: "org_member" });
});

ok("同 code 既有企业：只接管入驻向导建的、或只有操作者 / 工厂老板 / 平台管理员的企业", () => {
  const ADMIN = "u_admin";
  const BOSS = "u_boss";
  const base: ExistingOrgFacts = { createdByOnboarding: false, ownerId: ADMIN, ownerIsPlatformAdmin: true, activeMembers: [{ userId: ADMIN, orgRole: "org_owner", isPlatformAdmin: true }] };
  // 平台管理员自己建的空企业 → 可接管，owner 交给工厂老板
  assert.deepEqual(planExistingOrgAdoption(base, ADMIN, BOSS), { ok: true, setOwnerId: BOSS });
  assert.deepEqual(planExistingOrgAdoption(base, ADMIN, null), { ok: true, setOwnerId: null });
  // 普通用户抢注的企业（owner + org_admin 是他）→ CODE_TAKEN，不论是否指定老板
  const squat: ExistingOrgFacts = { createdByOnboarding: false, ownerId: "u_plain", ownerIsPlatformAdmin: false, activeMembers: [{ userId: "u_plain", orgRole: "org_admin", isPlatformAdmin: false }] };
  for (const owner of [BOSS, null]) {
    const r = planExistingOrgAdoption(squat, ADMIN, owner);
    assert.ok(!r.ok && r.code === "CODE_TAKEN", `owner=${owner}`);
  }
  // owner 是平台管理员，但有别的普通成员（另一家真实企业）→ CODE_TAKEN
  const live: ExistingOrgFacts = { ...base, activeMembers: [...base.activeMembers, { userId: "u_rep", orgRole: "org_member", isPlatformAdmin: false }] };
  const liveR = planExistingOrgAdoption(live, ADMIN, BOSS);
  assert.ok(!liveR.ok && liveR.code === "CODE_TAKEN");
  // 工厂老板自己建的企业（只有他）→ 可接管，owner 不变
  const selfMade: ExistingOrgFacts = { createdByOnboarding: false, ownerId: BOSS, ownerIsPlatformAdmin: false, activeMembers: [{ userId: BOSS, orgRole: "org_owner", isPlatformAdmin: false }] };
  assert.deepEqual(planExistingOrgAdoption(selfMade, ADMIN, BOSS), { ok: true, setOwnerId: null });
  assert.ok(!planExistingOrgAdoption(selfMade, ADMIN, null).ok, "不指定老板时不接管别人自建的企业");
});

ok("同 code 既有企业（入驻向导建的）：重复提交可补缺；老板冲突拒绝；平台管理员暂代的 owner 交给工厂老板", () => {
  const ADMIN = "u_admin";
  const BOSS = "u_boss";
  const onboarded: ExistingOrgFacts = {
    createdByOnboarding: true,
    ownerId: BOSS,
    ownerIsPlatformAdmin: false,
    activeMembers: [
      { userId: ADMIN, orgRole: "org_admin", isPlatformAdmin: true },
      { userId: BOSS, orgRole: "org_owner", isPlatformAdmin: false },
      { userId: "u_rep", orgRole: "org_member", isPlatformAdmin: false },
    ],
  };
  assert.deepEqual(planExistingOrgAdoption(onboarded, ADMIN, BOSS), { ok: true, setOwnerId: null }, "幂等重试");
  assert.deepEqual(planExistingOrgAdoption(onboarded, ADMIN, null), { ok: true, setOwnerId: null });
  const other = planExistingOrgAdoption(onboarded, ADMIN, "u_other_boss");
  assert.ok(!other.ok && other.code === "OWNER_CONFLICT", "已有别的老板 → 不能靠重复提交更换");
  const adminOwned: ExistingOrgFacts = { createdByOnboarding: true, ownerId: ADMIN, ownerIsPlatformAdmin: true, activeMembers: [{ userId: ADMIN, orgRole: "org_admin", isPlatformAdmin: true }] };
  assert.deepEqual(planExistingOrgAdoption(adminOwned, ADMIN, BOSS), { ok: true, setOwnerId: BOSS }, "补填老板邮箱 → owner 改为工厂老板");
  const otherAdminOwned: ExistingOrgFacts = { ...adminOwned, ownerId: "u_admin2" };
  assert.deepEqual(planExistingOrgAdoption(otherAdminOwned, ADMIN, BOSS), { ok: true, setOwnerId: BOSS }, "别的平台管理员暂代也交出");
});

ok("邀请码格式：QY- + 8 位易读字符", () => {
  const code = formatInviteCode(new Uint8Array([0, 1, 2, 3, 250, 251, 252, 255]));
  assert.match(code, /^QY-[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(formatInviteCode(new Uint8Array(8)), "QY-AAAAAAAA");
});

console.log("onboarding — test inquiry markers");

ok("测试事件 id / 序号 / 标记", () => {
  assert.equal(onboardingTestEventId("org1", 3), "onboarding-test-org1-3");
  assert.ok(isOnboardingTestEventId("onboarding-test-org1-3"));
  assert.ok(!isOnboardingTestEventId("evt-123"));
  assert.equal(nextOnboardingTestCounter("org1", []), 1);
  assert.equal(nextOnboardingTestCounter("org1", ["onboarding-test-org1-1", "onboarding-test-org1-7", "onboarding-test-org2-9", "onboarding-test-org1-x"]), 8);
  assert.ok(!hasOnboardingTestTag(null));
  assert.ok(!hasOnboardingTestTag("vip,qingyan_onboarding_test_old"));
  assert.equal(withOnboardingTestTag("vip"), `vip,${ONBOARDING_TEST_TAG}`);
  assert.equal(withOnboardingTestTag(withOnboardingTestTag(null)), ONBOARDING_TEST_TAG, "幂等");
  assert.ok(hasOnboardingTestTag(` vip , ${ONBOARDING_TEST_TAG}`));
});

ok("测试询盘载荷：经网站表单同一归一化；保留域名买家、测试 utm、带序号的事件 id、正文带序号避免内容去重", () => {
  const raw = buildOnboardingTestInquiryPayload({ orgId: "org1", counter: 2, productLabelEn: "Bathrobes" });
  const n = normalizeInquiry(raw);
  assert.ok(n.ok && !n.value.honeypotTripped);
  assert.equal(n.value.email, ONBOARDING_TEST_BUYER_EMAIL);
  assert.match(n.value.email, /@example\.com$/);
  assert.equal(n.value.utm.source, ONBOARDING_TEST_UTM_SOURCE);
  assert.equal(n.value.eventId, "onboarding-test-org1-2");
  assert.equal(n.value.product, "Bathrobes");
  assert.match(n.value.message, /onboarding test #2/);
  const other = buildOnboardingTestInquiryPayload({ orgId: "org1", counter: 3, productLabelEn: null });
  assert.notEqual(other.message, raw.message);
  assert.equal(other.product, "home textile products");
});

console.log("onboarding — readiness");

const READY: OnboardingFacts = {
  pack: { status: "ok", id: "home_textile_trade_v1", name: "家纺外贸 v1", hasCatalog: true },
  modulesExplicit: true,
  timezone: "Asia/Shanghai",
  categories: { published: true, make: ["towel"], dontMake: ["pet"] },
  websiteChannel: { exists: true, active: true, secretSet: true },
  members: [{ isSalesRole: true, wechatBound: true }, { isSalesRole: false, wechatBound: false }],
  pendingInvites: 0,
  testInquiry: { count: 1, latestHasOpportunity: true, latestHadDraft: true, latestClosed: true },
  emailSender: { configured: false },
  acknowledged: {},
  blockingIssues: 0,
  handoff: { platformAdminMembers: [], ownerIsPlatformAdmin: false },
};

ok("全部必做完成 → 就绪；发件身份只是推荐项", () => {
  const d = deriveOnboardingSteps(READY);
  assert.equal(d.ready, true);
  assert.equal(d.totalRequired, 6);
  assert.equal(d.doneRequired, 6);
  assert.deepEqual(d.steps.map((s) => s.key), ["pack", "categories", "website_channel", "email_inbound", "members", "wechat", "test_inquiry", "email_sender", "handoff"]);
  const sender = d.steps.find((s) => s.key === "email_sender")!;
  assert.equal(sender.required, false);
  assert.equal(sender.status, "warning");
  assert.equal(d.steps.find((s) => s.key === "handoff")!.status, "done");
});

ok("交接是推荐项：平台管理员仍在成员里 / owner 仍是平台管理员 → 提示，但不阻塞就绪", () => {
  const stay = deriveOnboardingSteps({ ...READY, handoff: { platformAdminMembers: ["Platform Admin"], ownerIsPlatformAdmin: false } });
  const h = stay.steps.find((s) => s.key === "handoff")!;
  assert.equal(h.required, false);
  assert.equal(h.status, "warning");
  assert.match(h.detail, /Platform Admin.*询盘的通知/);
  assert.equal(stay.ready, true);
  const ownerAdmin = deriveOnboardingSteps({ ...READY, handoff: { platformAdminMembers: [], ownerIsPlatformAdmin: true } });
  assert.match(ownerAdmin.steps.find((s) => s.key === "handoff")!.detail, /指定工厂老板/);
});

ok("每一步的缺口都会让就绪为 false", () => {
  const cases: Array<[string, Partial<OnboardingFacts>, string]> = [
    ["pack", { pack: { ...READY.pack, status: "missing", id: null } }, "pack"],
    ["modules", { modulesExplicit: false }, "pack"],
    ["timezone", { timezone: "Nowhere/Land" }, "pack"],
    ["categories", { categories: { published: false, make: [], dontMake: [] } }, "categories"],
    ["channel", { websiteChannel: { exists: false, active: false, secretSet: false } }, "website_channel"],
    ["channel inactive", { websiteChannel: { exists: true, active: false, secretSet: true } }, "website_channel"],
    ["members", { members: [{ isSalesRole: false, wechatBound: true }] }, "members"],
    ["wechat", { members: [{ isSalesRole: true, wechatBound: false }] }, "wechat"],
    ["test", { testInquiry: { count: 0, latestHasOpportunity: false, latestHadDraft: false, latestClosed: false } }, "test_inquiry"],
    ["test no draft", { testInquiry: { count: 1, latestHasOpportunity: true, latestHadDraft: false, latestClosed: true } }, "test_inquiry"],
    ["test open", { testInquiry: { count: 1, latestHasOpportunity: true, latestHadDraft: true, latestClosed: false } }, "test_inquiry"],
  ];
  for (const [name, patch, key] of cases) {
    const d = deriveOnboardingSteps({ ...READY, ...patch });
    assert.equal(d.ready, false, name);
    assert.ok(["todo", "warning"].includes(d.steps.find((s) => s.key === key)!.status), name);
  }
  assert.equal(deriveOnboardingSteps({ ...READY, blockingIssues: 1 }).ready, false, "企业级 CRITICAL 配置问题阻塞就绪");
});

ok("邮件转发入口是推荐项：平台未开通 → 跳过；未建 / 白名单空 / 停用 / 平台未配发件验证 → 提示；都不阻塞就绪", () => {
  const step = (f: Partial<OnboardingFacts>) => deriveOnboardingSteps({ ...READY, ...f }).steps.find((s) => s.key === "email_inbound")!;
  const base = { platformEnabled: true, exists: true, active: true, aliasSet: true, allowlistCount: 2 };
  assert.equal(step({}).status, "skipped", "缺省（旧调用方）视为平台未开通");
  assert.equal(step({ emailInbound: { ...base, platformEnabled: false } }).status, "skipped");
  const done = step({ emailInbound: base });
  assert.equal(done.status, "done");
  assert.equal(done.required, false);
  assert.match(done.detail, /白名单 2 个/);
  assert.equal(step({ emailInbound: { ...base, exists: false, active: false, aliasSet: false, allowlistCount: 0 } }).status, "todo");
  assert.equal(step({ emailInbound: { ...base, allowlistCount: 0 } }).status, "warning");
  assert.match(step({ emailInbound: { ...base, allowlistCount: 0 } }).detail, /隔离/);
  assert.equal(step({ emailInbound: { ...base, active: false } }).status, "warning");
  // 平台没配受信 authserv-id：转发都会被隔离（DKIM / DMARC 判定失败即关闭）→ 提示；未传该字段（旧调用方）不提示
  const noAuth = step({ emailInbound: { ...base, authVerifyConfigured: false } });
  assert.equal(noAuth.status, "warning");
  assert.match(noAuth.detail, /INBOUND_EMAIL_AUTHSERV_ID/);
  assert.equal(step({ emailInbound: { ...base, authVerifyConfigured: true } }).status, "done");
  assert.equal(step({ emailInbound: { ...base, exists: false, active: false, aliasSet: false, allowlistCount: 0, authVerifyConfigured: false } }).status, "todo");
  for (const e of [{ ...base, exists: false }, { ...base, allowlistCount: 0 }, { ...base, platformEnabled: false }, { ...base, authVerifyConfigured: false }]) {
    const d = deriveOnboardingSteps({ ...READY, emailInbound: e });
    assert.equal(d.ready, true);
    assert.equal(d.totalRequired, 6);
  }
});

ok("管理员确认可跳过微信 / 发件身份；无品类目录的行业包跳过品类步骤", () => {
  const ack = deriveOnboardingSteps({
    ...READY,
    members: [{ isSalesRole: true, wechatBound: false }],
    acknowledged: { wechat: true, email_sender: true },
  });
  assert.equal(ack.ready, true);
  assert.equal(ack.steps.find((s) => s.key === "wechat")!.status, "acknowledged");
  assert.equal(ack.steps.find((s) => s.key === "email_sender")!.status, "acknowledged");
  const generic = deriveOnboardingSteps({
    ...READY,
    pack: { status: "ok", id: "generic_business_v1", name: "通用商务 v1", hasCatalog: false },
    categories: { published: false, make: [], dontMake: [] },
  });
  assert.equal(generic.steps.find((s) => s.key === "categories")!.status, "skipped");
  assert.equal(generic.ready, true);
});

console.log("tenant-neutral copy");

ok("证书提醒不写具体企业名", () => {
  const risks = detectInquiryRisks("Do you have BSCI and OEKO-TEX certificates? Please send copies.");
  const cert = risks.find((r) => r.code === "certification_claim");
  assert.ok(cert);
  assert.ok(!/梦馨/.test(cert.note), cert.note);
  assert.match(cert.note, /本厂真实持有、已入档的证书/);
});

console.log("route contracts (static)");

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

ok("所有入驻接口都先过 requirePlatformAdmin，且不从请求体取 orgId", () => {
  const routes = [
    "src/app/api/admin/onboarding/route.ts",
    "src/app/api/admin/onboarding/[orgId]/route.ts",
    "src/app/api/admin/onboarding/[orgId]/categories/route.ts",
    "src/app/api/admin/onboarding/[orgId]/website-channel/route.ts",
    "src/app/api/admin/onboarding/[orgId]/invites/route.ts",
    "src/app/api/admin/onboarding/[orgId]/test-inquiry/route.ts",
  ];
  for (const r of routes) {
    const src = read(r);
    const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)].length;
    const guards = [...src.matchAll(/const auth = await requirePlatformAdmin\(request\);\n\s+if \(auth instanceof NextResponse\) return auth;/g)].length;
    assert.ok(handlers > 0 && guards === handlers, `${r}: ${handlers} handlers / ${guards} guards`);
    assert.ok(!/body\.orgId|bodyOrgId|searchParams\.get\("orgId"\)/.test(src), `${r} 不读取请求体 / query 的 orgId`);
  }
});

ok("测试询盘路由配置为静态字面量", () => {
  const src = read("src/app/api/admin/onboarding/[orgId]/test-inquiry/route.ts");
  assert.match(src, /^export const maxDuration = 300;$/m);
  assert.match(src, /^export const runtime = "nodejs";$/m);
});

ok("POST /api/organizations 仅平台管理员；GET 仍只要登录", () => {
  const src = read("src/app/api/organizations/route.ts");
  const post = src.slice(src.indexOf("export async function POST"));
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  assert.match(post, /^export async function POST\(request: NextRequest\) \{\n\s+const auth = await requirePlatformAdmin\(request\);/);
  assert.match(get, /const auth = await requireAuth\(request\);/);
});

ok("入驻页面包在 PlatformAdminGate 里；导航项为 platformAdminOnly", () => {
  assert.match(read("src/app/(main)/admin/onboarding/layout.tsx"), /<PlatformAdminGate fallbackPath="\/">/);
  const reg = read("src/lib/navigation/registry.ts");
  const item = reg.slice(reg.indexOf('key: "plat-onboarding"'), reg.indexOf('key: "plat-audit"'));
  assert.match(item, /href: "\/admin\/onboarding"/);
  assert.match(item, /platformAdminOnly: true/);
});

ok("收入驾驶舱阶段分布排除测试商机；排除片段保留 lostReason 为空的真实商机", () => {
  assert.deepEqual(EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES, { OR: [{ lostReason: null }, { lostReason: { not: ONBOARDING_TEST_CLOSE_REASON } }] });
  const src = read("src/lib/revenue-spine/cockpit.ts");
  assert.match(src, /by: \["stage"\],\n\s+where: \{ orgId, AND: \[EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES\] \}/);
});

ok("入驻列表只报「必做步骤已完成」，不在列表里报就绪（列表不跑配置健康检查）", () => {
  const lib = read("src/lib/organizations/onboarding.ts");
  const list = lib.slice(lib.indexOf("export async function listOnboardingOrgs"));
  assert.match(list, /stepsComplete: s\.doneRequired === s\.totalRequired/);
  assert.ok(!/ready: s\.ready/.test(list));
  assert.ok(!/已就绪/.test(read("src/app/(main)/admin/onboarding/page.tsx")));
});

ok("发送执行器对测试买家一律拒发", () => {
  const src = read("src/lib/pending-actions/exec-sales-inquiry-reply.ts");
  assert.match(src, /hasOnboardingTestTag\(opp\.customer\.tags\)/);
  assert.match(src, /errorCode: "ONBOARDING_TEST"/);
});

ok("工厂老板只能是 trade / sales 平台角色：boss / manager / admin 一律拒绝", () => {
  assert.equal(factoryOwnerRoleProblem("trade"), null);
  assert.equal(factoryOwnerRoleProblem("sales"), null);
  for (const r of ["boss", "manager", "admin", "super_admin", "user", null]) {
    assert.ok(factoryOwnerRoleProblem(r as string | null), `${r} should be refused`);
  }
  assert.match(factoryOwnerRoleProblem("boss")!, /跨企业管理用户/);
});

console.log(`\n${pass} passed`);
