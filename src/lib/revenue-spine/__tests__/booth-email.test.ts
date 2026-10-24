/**
 * 新版跟进邮件：版式（纯文本 / HTML 同源）、首封、3 封无回复跟进、公司资料解析 纯函数测试
 * 运行：npx tsx src/lib/revenue-spine/__tests__/booth-email.test.ts
 */

import assert from "node:assert/strict";
import { composeBoothFirstEmail, composeFollowUpEmail, notedFacts, parseEvent, type BoothEmailContext } from "../booth-email";
import { renderEmailHtml, renderPlainEmailHtml, safeUrl, type EmailDoc } from "../email-layout";
import { EMPTY_EMAIL_PROFILE, SPEC_WORDING, emailProfileToForm, parseEmailProfile, profileGuardrailErrors, signatureFor, type EmailProfile } from "../email-profile";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const SITE = "https://www.mengxinhometextile.com";
const PROFILE: EmailProfile = {
  ...EMPTY_EMAIL_PROFILE,
  website: SITE,
  companyLine: "Mengxin is a home textile manufacturer in Jiande, Zhejiang.",
  facts: [
    { value: "2008", label: "established" },
    { value: "22", label: "reference styles" },
  ],
  specWording: true,
  videoCall: true,
  team: [{ cardName: "Cathy", fullName: "Cathy Wang", title: "Sales Manager", whatsapp: "+86 138 0000 0000" }],
};

function ctx(over: Partial<BoothEmailContext> = {}): BoothEmailContext {
  const profile = over.profile ?? EMPTY_EMAIL_PROFILE;
  return {
    orgName: "Mengxin Home Textile",
    contactName: "Emma Novak",
    event: "the 140th Canton Fair (Booth 14.3E07)",
    product: null,
    styles: [
      { code: "MX-BL-001", name: "Flannel Coral Fleece Blanket", specUrl: `${SITE}/products/blankets/flannel-coral-fleece-blanket`, imageUrl: `${SITE}/email/styles/mx-bl-001.jpg` },
      { code: "MX-BR-001", name: "Coral Fleece Bathrobe", specUrl: `${SITE}/products/bathrobes/coral-fleece-bathrobe-mx-br-001` },
    ],
    noted: [],
    missing: ["quantity", "destinationCountry"],
    signature: signatureFor(profile, "Cathy", "Mengxin Home Textile"),
    profile,
    replyEmail: "cathy@hlmbedding.com",
    ...over,
  };
}

ok("parseEvent：展会名 + 展位号", () => {
  assert.deepEqual(parseEvent("the 140th Canton Fair (Booth 14.3E07)"), { fair: "Canton Fair", booth: "Booth 14.3E07" });
  assert.deepEqual(parseEvent("Heimtextil 2027"), { fair: null, booth: null });
  assert.deepEqual(parseEvent(null), { fair: null, booth: null });
});

ok("首封（资料未填）：点名主题、展位开场、参考款带规格链接、只问缺的两点、通用报价说明；没有公司数字 / 视频", () => {
  const { draft, html } = composeBoothFirstEmail(ctx(), "en");
  assert.equal(draft.subject, "Emma, your Canton Fair picks + full specs");
  assert.deepEqual(draft.guardrailViolations, []);
  assert.ok(draft.body.startsWith("Hi Emma,\n\nGreat meeting you at Booth 14.3E07 during the 140th Canton Fair — thanks for stopping by."), draft.body.slice(0, 160));
  assert.match(draft.body, /- Flannel Coral Fleece Blanket \(ref\. MX-BL-001\)\n {2}Specification: https:\/\/www\.mengxinhometextile\.com\/products\/blankets\//);
  assert.match(draft.body, /Reply with two details and we will prepare a costing for both styles:\n\n1\. Quantity — per style and colour\n2\. Destination — port and target delivery month/);
  assert.doesNotMatch(draft.body, /Size & fabric/);
  assert.match(draft.body, /Pricing, MOQ and lead time depend on your specification, so we will confirm them in your costing\./);
  assert.doesNotMatch(draft.body, /video|2008|mailto:/i);
  assert.ok(draft.body.endsWith("Best regards,\nCathy\nMengxin Home Textile"), draft.body.slice(-80));
  assert.ok(html?.startsWith("<!doctype html>"));
  assert.match(html ?? "", /href="mailto:cathy@hlmbedding\.com\?subject=Costing%20for%20MX-BL-001%20and%20MX-BR-001"/);
  assert.match(html ?? "", /<img src="https:\/\/www\.mengxinhometextile\.com\/email\/styles\/mx-bl-001\.jpg"/);
  assert.match(html ?? "", /Canton Fair · Booth 14\.3E07/);
});

ok("首封（资料已填）：公司介绍、数字、规格书口径、视频看样、业务员全名职务 WhatsApp", () => {
  const { draft, html } = composeBoothFirstEmail(ctx({ profile: PROFILE, signature: signatureFor(PROFILE, "cathy", "Mengxin Home Textile") }), "en");
  assert.deepEqual(draft.guardrailViolations, []);
  assert.match(draft.body, /Mengxin is a home textile manufacturer in Jiande, Zhejiang\.\n\n2008 established · 22 reference styles/);
  assert.ok(draft.body.includes(SPEC_WORDING));
  assert.doesNotMatch(draft.body, /we will confirm them in your costing/);
  assert.match(draft.body, /Reply “video”/);
  assert.match(draft.body, /Chat on WhatsApp: https:\/\/wa\.me\/8613800000000/);
  assert.ok(draft.body.endsWith("Best regards,\nCathy Wang\nSales Manager · Mengxin Home Textile\nWhatsApp +86 138 0000 0000 · mengxinhometextile.com"), draft.body.slice(-140));
  assert.match(html ?? "", />CW</);
});

ok("首封：缺的信息不同 → 问的不同；什么都不缺 → 回复 go；没有回复地址 → 只放 WhatsApp", () => {
  const all = composeBoothFirstEmail(ctx({ missing: ["quantity", "size", "destinationCity"] }), "en").draft.body;
  assert.match(all, /Reply with three details[\s\S]*2\. Size & fabric — or simply “as the booth sample”/);
  const none = composeBoothFirstEmail(ctx({ missing: [] }), "en").draft.body;
  assert.match(none, /We have what we need — reply “go”/);
  const noMail = composeBoothFirstEmail(ctx({ replyEmail: null, profile: PROFILE, signature: signatureFor(PROFILE, "Cathy", "Mengxin Home Textile") }), "en").html ?? "";
  assert.doesNotMatch(noMail, /mailto:/);
  assert.match(noMail, /href="https:\/\/wa\.me\/8613800000000"/);
});

ok("首封：一款 / 没有参考款（只有产品）/ 记下的要点", () => {
  const one = composeBoothFirstEmail(ctx({ styles: [ctx().styles[0]] }), "en").draft.body;
  assert.match(one, /Here is the style you picked/);
  assert.match(one, /It is a reference style — made to your spec/);
  const product = composeBoothFirstEmail(ctx({ styles: [], product: "Hotel bathrobes" }), "en").draft.body;
  assert.match(product, /Hotel bathrobes can be made to your own specification/);
  const noted = composeBoothFirstEmail(ctx({ noted: notedFacts([{ field: "packaging", value: "gift box" }, { field: "color", value: "米白" }], "en") }), "en").draft.body;
  assert.match(noted, /What we noted at the booth:\n\n- Packaging: gift box\n\nThe styles you picked/);
  assert.doesNotMatch(noted, /米白/);
});

ok("中文对照：同一结构、中文标点和落款、不出 HTML", () => {
  const { draft, html } = composeBoothFirstEmail(ctx({ noted: notedFacts([{ field: "packaging", value: "礼盒" }], "zh") }), "zh");
  assert.equal(html, null);
  assert.equal(draft.language, "zh");
  assert.match(draft.subject, /^Emma，您在广交会上看中的款式和完整规格$/);
  assert.match(draft.body, /很高兴在展位见到您（广交会 14\.3E07），感谢来访。下面是您看中的 2 款/);
  assert.match(draft.body, /可按您的规格定做：面料与克重、尺寸、颜色与印花、Logo 与标签、包装。/);
  assert.match(draft.body, /我们在展位记下的：\n\n- 包装：礼盒/);
  assert.match(draft.body, /规格页: https:/);
  assert.match(draft.body, /\n\n此致\nCathy/);
});

ok("跟进 3 封：Re 主题 + 一句话回复示例 → 三种包装 → 回 1/2/3；都过守卫", () => {
  const prev = "Emma, your Canton Fair picks + full specs";
  const f1 = composeFollowUpEmail(ctx(), { step: 1, total: 3, previousSubject: prev }, "en");
  assert.equal(f1.draft.subject, `Re: ${prev}`);
  assert.match(f1.draft.body, /“MX-BL-001: \[quantity\] · MX-BR-001: \[quantity\] · to \[port\] · deliver by \[month\]”/);
  const f2 = composeFollowUpEmail(ctx(), { step: 2, total: 3, previousSubject: prev }, "en");
  assert.equal(f2.draft.subject, "3 packing formats for your range, Emma");
  assert.match(f2.draft.body, /- Belly band \+ hang tag: /);
  const f3 = composeFollowUpEmail(ctx(), { step: 3, total: 3, previousSubject: prev }, "en");
  assert.equal(f3.draft.subject, "Should I close your file, Emma?");
  assert.match(f3.draft.body, /1 — Still interested: Send me a costing\n2 — Not now: Check back with me next season\n3 — Not a fit: Please close my file/);
  assert.match(f3.draft.body, /thank you for visiting us at the Canton Fair\./);
  assert.match(f3.html ?? "", /href="mailto:cathy@hlmbedding\.com\?subject=3%20%E2%80%94%20not%20a%20fit"/);
  for (const f of [f1, f2, f3]) assert.deepEqual(f.draft.guardrailViolations, []);
  // 已经是 Re: 的主题不叠加；没有上一封主题时自拟
  assert.equal(composeFollowUpEmail(ctx(), { step: 1, total: 3, previousSubject: `Re: ${prev}` }, "en").draft.subject, `Re: ${prev}`);
  assert.equal(composeFollowUpEmail(ctx(), { step: 1, total: 3, previousSubject: null }, "en").draft.subject, "Following up on your costing — Mengxin Home Textile");
});

ok("跟进：官网询盘（无展会、无参考款）用产品名；最后一封感谢联系", () => {
  const bare = composeFollowUpEmail(ctx({ styles: [{ code: "MX-CP-001", name: null }] }), { step: 1, total: 3, previousSubject: null }, "en");
  assert.match(bare.draft.body, /Your picks\n\n- MX-CP-001\n\nChat|Your picks\n\n- MX-CP-001$/m);
  assert.doesNotMatch(bare.html ?? "", /Ref\. MX-CP-001/);
  const web = ctx({ event: null, styles: [], product: "Flannel blankets" });
  assert.match(composeFollowUpEmail(web, { step: 1, total: 3, previousSubject: null }, "en").draft.body, /“Flannel blankets: \[quantity\] · to \[port\]/);
  assert.match(composeFollowUpEmail(web, { step: 3, total: 3, previousSubject: null }, "en").draft.body, /thank you for getting in touch\./);
  assert.match(composeFollowUpEmail(web, { step: 3, total: 3, previousSubject: null }, "en").html ?? "", /contacted us through our website/);
});

ok("HTML：文字一律转义；只收 https / mailto 链接", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("http://example.com/a.jpg"), null);
  assert.equal(safeUrl(`${SITE}/a.jpg`), `${SITE}/a.jpg`);
  const evil = composeBoothFirstEmail(
    ctx({
      contactName: `<script>alert(1)</script>`,
      styles: [{ code: "MX-1", name: `Robe "Deluxe" <b>`, specUrl: "javascript:alert(1)", imageUrl: "http://x.test/a.jpg" }],
    }),
    "en",
  ).html ?? "";
  assert.doesNotMatch(evil, /<script>|<b>|javascript:|http:\/\/x\.test/);
  assert.match(evil, /Robe &quot;Deluxe&quot; &lt;b&gt;/);
  const doc: EmailDoc = { subject: "s", preheader: "p", greeting: "Hi", blocks: [{ kind: "buttons", items: [{ label: "x", href: "data:text/html,1" }] }], signature: { name: "A", org: "B" }, footer: [] };
  assert.doesNotMatch(renderEmailHtml(doc, { orgName: "B", accent: "red;background:url(x)" }), /data:text|url\(x\)/);
});

ok("纯文本正文套外框：内容不改、按空行分段、转义", () => {
  const html = renderPlainEmailHtml({ subject: "Re: <inquiry>", body: "Dear Emma,\n\nLine one\nLine <two>\n\nBest regards,\nCathy", footer: ["Mengxin"] }, { orgName: "Mengxin", accent: "#8E6657" });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /<title>Re: &lt;inquiry&gt;<\/title>/);
  assert.match(html, /Line one<br>Line &lt;two&gt;/);
  assert.match(html, /Best regards,<br>Cathy/);
  assert.match(html, /MENGXIN/);
});

ok("公司资料：多行文本解析、校验、往返；落款按卡上名字 / 全名 / 名匹配", () => {
  const { profile, errors } = parseEmailProfile({
    accent: "#8e6657",
    website: SITE,
    facts: "2008 | established in Jiande\n# 注释行\n22 | reference styles",
    team: "Cathy | Cathy Wang | Sales Manager | +86 138 0000 0000\nTom | Tom Li | |",
    specWording: true,
  });
  assert.deepEqual(errors, []);
  assert.ok(profile);
  assert.deepEqual(profile.facts, [
    { value: "2008", label: "established in Jiande" },
    { value: "22", label: "reference styles" },
  ]);
  assert.deepEqual(profile.team[1], { cardName: "Tom", fullName: "Tom Li", title: null, whatsapp: null });
  assert.equal(profile.specWording, true);
  assert.equal(profile.videoCall, false);
  // 往返：设置页文本 → 解析 → 同样结果
  assert.deepEqual(parseEmailProfile(emailProfileToForm(profile)).profile, profile);
  // 存库的数组形态也能解析
  assert.deepEqual(parseEmailProfile(JSON.parse(JSON.stringify(profile))).profile, profile);

  const bad = parseEmailProfile({ accent: "brown", logoUrl: "http://x.test/logo.png", facts: "1 | a\n2 | b\n3 | c\n4 | d\n5 | e\nonly-value", team: "Cathy" });
  assert.equal(bad.profile, null);
  assert.ok(bad.errors.includes("主色要写成 #RRGGBB"));
  assert.ok(bad.errors.includes("Logo 链接要以 https:// 开头"));
  assert.ok(bad.errors.includes("公司数字最多 4 个"));
  assert.ok(bad.errors.some((e) => e.includes("only-value")));
  assert.ok(bad.errors.some((e) => e.startsWith("业务员要写成")));

  assert.equal(signatureFor(profile, "cathy", "M").name, "Cathy Wang");
  assert.equal(signatureFor(profile, "Tom", "M").title, null);
  assert.deepEqual(signatureFor(profile, "Night Operator", "M"), { name: "Night Operator", title: null, org: "M", whatsapp: null, website: SITE });
});

ok("公司资料里写了承诺（交期、起订量、认证）→ 保存时挡住；正常介绍、规格书口径不挡", () => {
  assert.deepEqual(profileGuardrailErrors(PROFILE), []);
  const bad = profileGuardrailErrors({
    ...PROFILE,
    companyLine: "We hold OEKO-TEX and BSCI certificates.",
    facts: [{ value: "30 days", label: "production lead time" }, { value: "2008", label: "established" }],
  });
  assert.equal(bad.length, 2, JSON.stringify(bad));
  assert.ok(bad[0].startsWith("公司介绍「We hold OEKO-TEX and BSCI certificates.」：认证承诺"));
  assert.ok(bad[1].startsWith("公司数字「30 days production lead time」：生产周期/交期数字承诺"));
});

console.log(`\n${pass} passed`);
