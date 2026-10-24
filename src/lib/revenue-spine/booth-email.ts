/**
 * Revenue Spine — 展会跟进邮件（新版）：首封 + 买家没回信时的 3 封跟进
 *
 * 版式见 email-layout（同一份内容出纯文本和 HTML）。原则：
 * - 主题像人写的、点名；开头一句话说清楚为什么写信
 * - 参考款做成卡片：图片、款号、规格页链接；说明都能按买家规格定做
 * - 报价只要三条（缺什么问什么），按钮回复 / WhatsApp
 * - 公司数字、规格书口径、视频看样只在公司确认（填进 email_profile）后出现
 * - 不写价格 / MOQ / 交期等任何承诺；守卫照常检查
 * 英文发给买家；中文只给审核人看（同一结构，不发送）。
 */

import { RFQ_FIELD_LABELS, type RfqField } from "./rfq/types";
import { renderEmailHtml, renderEmailText, whatsappLink, type EmailBlock, type EmailDoc, type EmailSignature, type EmailStyleCard } from "./email-layout";
import { SPEC_WORDING, type EmailProfile } from "./email-profile";
import { checkDraftGuardrails, type ReplyDraft } from "./reply-draft";

export interface BoothEmailContext {
  orgName: string;
  contactName: string | null;
  /** 展会名（含展位）；null = 网站询盘等非展会来源 */
  event: string | null;
  /** 网站询盘时的产品说法 */
  product: string | null;
  styles: Array<{ code: string; name: string | null; specUrl?: string | null; imageUrl?: string | null }>;
  /** 卡上 / 来信里已知、可以复述的要点（已过守卫和风险过滤） */
  noted: string[];
  missing: RfqField[];
  signature: EmailSignature;
  profile: EmailProfile;
  /** 买家点「回复」时的地址（组织发件身份）；没有就不放 mailto 按钮 */
  replyEmail: string | null;
}

export type Lang = "en" | "zh";

export interface ComposedEmail {
  draft: ReplyDraft;
  /** 英文 = 发给买家的 HTML 版；中文对照不出 HTML */
  html: string | null;
  doc: EmailDoc;
}

/**
 * 卡上 / 来信里已知的要点 → 首封里「我们在展位记下的」。取模板已过滤的 factsUsed（守卫、风险、参考款名都排除过）；
 * 英文邮件不放中文原话（业务员用中文记的备注不适合原样发给英文买家）。
 */
export function notedFacts(facts: Array<{ field: RfqField; value: string }>, lang: Lang): string[] {
  return facts
    .filter((f) => lang === "zh" || !/[\u3400-\u9fff]/.test(f.value))
    .slice(0, 4)
    .map((f) => (lang === "zh" ? `${RFQ_FIELD_LABELS[f.field].zh}：${f.value}` : `${RFQ_FIELD_LABELS[f.field].en}: ${f.value}`));
}

function firstName(name: string | null): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  // 中文名不拆
  if (/[一-鿿]/.test(n)) return n;
  return n.split(/\s+/)[0];
}

/** "the 140th Canton Fair (Booth 14.3E07)" → { fair: "Canton Fair", booth: "Booth 14.3E07" } */
export function parseEvent(event: string | null): { fair: string | null; booth: string | null } {
  if (!event) return { fair: null, booth: null };
  const booth = /\bbooth\s+[\w.-]+/i.exec(event)?.[0] ?? null;
  const fair = /canton fair/i.test(event) ? "Canton Fair" : null;
  return { fair, booth: booth ? booth.replace(/^booth/i, "Booth") : null };
}

function mailto(email: string | null, subject: string): string | null {
  return email ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : null;
}

function styleCards(ctx: BoothEmailContext): EmailStyleCard[] {
  return ctx.styles.map((s) => ({ name: s.name ?? s.code, code: s.code, specUrl: s.specUrl ?? null, imageUrl: s.imageUrl ?? null }));
}

function codesLabel(ctx: BoothEmailContext): string {
  const codes = ctx.styles.map((s) => s.code);
  return codes.length <= 2 ? codes.join(" and ") : `${codes.slice(0, 2).join(", ")} and ${codes.length - 2} more`;
}

/** 报价还缺的三类信息（缺什么问什么） */
function asks(missing: RfqField[], lang: Lang): Array<{ title: string; hint: string }> {
  const zh = lang === "zh";
  const out: Array<{ title: string; hint: string }> = [];
  if (missing.includes("quantity")) out.push(zh ? { title: "数量", hint: "每款每色各多少" } : { title: "Quantity", hint: "per style and colour" });
  if (missing.includes("size") || missing.includes("material"))
    out.push(zh ? { title: "尺寸和面料", hint: "或直接说“按展位样品”" } : { title: "Size & fabric", hint: "or simply “as the booth sample”" });
  if (missing.some((f) => f === "destinationCountry" || f === "destinationCity" || f === "requiredDeliveryDate"))
    out.push(zh ? { title: "目的地", hint: "港口和期望交货月份" } : { title: "Destination", hint: "port and target delivery month" });
  return out;
}

/** 页脚：公司（+ 地址）、为什么收到这封邮件 */
export function footerLines(ctx: Pick<BoothEmailContext, "orgName" | "event" | "profile">, lang: Lang): string[] {
  const zh = lang === "zh";
  const first = ctx.profile.address ? `${ctx.orgName} · ${ctx.profile.address}` : ctx.orgName;
  const why = ctx.event
    ? zh
      ? `您收到这封邮件，是因为您在${ctx.event}到访了我们的展位。`
      : `You received this email because you visited our booth at ${ctx.event}.`
    : zh
      ? "您收到这封邮件，是因为您通过我们的官网联系了我们。"
      : "You received this email because you contacted us through our website.";
  return [first, why];
}

function finish(composed: EmailDoc, ctx: BoothEmailContext, lang: Lang): ComposedEmail {
  const doc: EmailDoc = { ...composed, lang };
  const body = renderEmailText(doc);
  return {
    doc,
    html: lang === "en" ? renderEmailHtml(doc, { orgName: ctx.orgName, logoUrl: ctx.profile.logoUrl, accent: ctx.profile.accent }) : null,
    draft: {
      subject: doc.subject,
      body,
      language: lang,
      factsUsed: [],
      pendingInternalConfirmation: [],
      guardrailViolations: checkDraftGuardrails(`${doc.subject}\n${body}`),
      templateOnly: true,
    },
  };
}

// ── 首封 ─────────────────────────────────────────────────

export function composeBoothFirstEmail(ctx: BoothEmailContext, lang: Lang): ComposedEmail {
  const zh = lang === "zh";
  const name = firstName(ctx.contactName);
  const { fair, booth } = parseEvent(ctx.event);
  const n = ctx.styles.length;
  const subject = zh
    ? `${name ? `${name}，` : ""}您在${fair ? "广交会" : "展会"}上看中的款式和完整规格`
    : `${name ? `${name}, your` : "Your"} ${fair ?? "booth"} picks + full specs`;
  const blocks: EmailBlock[] = [];

  blocks.push({
    kind: "paragraph",
    text: zh
      ? `很高兴在展位见到您${fair || booth ? `（${[fair ? "广交会" : null, booth?.replace(/^Booth\s*/i, "")].filter(Boolean).join(" ")}）` : ""}，感谢来访。${n ? `下面是您看中的${n > 1 ? ` ${n} 款` : "款式"}，每款都附完整规格。` : ""}`
      : `Great meeting you at ${booth ?? "our booth"}${ctx.event ? ` during ${ctx.event.replace(/\s*\(booth[^)]*\)/i, "")}` : ""} — thanks for stopping by.${
          n ? ` Here ${n > 1 ? "are the styles" : "is the style"} you picked, each with its full specification.` : ""
        }`,
  });
  if (ctx.noted.length) {
    blocks.push({ kind: "paragraph", text: zh ? `我们${ctx.event ? "在展位" : ""}记下的：` : `What we noted${ctx.event ? " at the booth" : ""}:` });
    blocks.push({ kind: "list", items: ctx.noted });
  }
  if (n) {
    blocks.push({ kind: "label", text: zh ? "您看中的款式" : "The styles you picked" });
    blocks.push({ kind: "styles", items: styleCards(ctx) });
    blocks.push({
      kind: "chips",
      title: zh ? "这些都是我们做过的参考款，可按您的规格定做" : n > 1 ? "These are reference styles — made to your spec" : "It is a reference style — made to your spec",
      items: zh ? ["面料与克重", "尺寸", "颜色与印花", "Logo 与标签", "包装"] : ["Fabric & weight", "Size", "Colour & print", "Logo & labels", "Packing"],
    });
  } else if (ctx.product) {
    blocks.push({ kind: "paragraph", text: zh ? `关于${ctx.product}，可以按您的规格定做：面料、尺寸、颜色、Logo 与包装。` : `${ctx.product} can be made to your own specification — fabric, size, colour, logo and packing.` });
  }

  const need = asks(ctx.missing, lang);
  blocks.push({ kind: "label", text: zh ? "下一步 · 为您报价" : "Next step · your costing" });
  if (need.length) {
    const count = zh ? `${need.length} 点` : ["one detail", "two details", "three details"][need.length - 1];
    blocks.push({
      kind: "paragraph",
      text: zh
        ? `回复以下 ${count}，我们就为您准备报价：`
        : `Reply with ${count} and we will prepare a costing for ${n > 1 ? (n === 2 ? "both styles" : "these styles") : n === 1 ? "this style" : "you"}:`,
    });
    blocks.push({ kind: "steps", items: need });
  } else {
    blocks.push({ kind: "paragraph", text: zh ? "需要的信息已经齐了，回复“确认”我们就开始报价。" : "We have what we need — reply “go” and we will prepare your costing." });
  }
  const buttons: Array<{ label: string; href: string; primary?: boolean }> = [];
  const mail = mailto(ctx.replyEmail, `Costing for ${codesLabel(ctx) || "my inquiry"}`);
  const wa = whatsappLink(ctx.signature.whatsapp);
  if (mail) buttons.push({ label: zh ? "回复我的需求" : "Reply with my details", href: mail, primary: true });
  if (wa) buttons.push({ label: zh ? "WhatsApp 联系" : "Chat on WhatsApp", href: wa, primary: !mail });
  if (buttons.length) blocks.push({ kind: "buttons", items: buttons });
  if (ctx.profile.videoCall) {
    blocks.push({
      kind: "note",
      text: zh ? "想看实物？回复“video”，我们从样品间和您视频看样。" : "Prefer to see the samples live? Reply “video” and we will set up a short video call from our sample room.",
    });
  }

  if (ctx.profile.companyLine) blocks.push({ kind: "paragraph", text: ctx.profile.companyLine });
  if (ctx.profile.facts.length) blocks.push({ kind: "facts", imageUrl: ctx.profile.factImageUrl, items: ctx.profile.facts });
  blocks.push({
    kind: "note",
    text: ctx.profile.specWording
      ? zh
        ? "起订量按项目，在审核规格后报价；生产周期在样品确认后确定。"
        : SPEC_WORDING
      : zh
        ? "价格、起订量和交期取决于您的规格，我们会在报价里一并确认。"
        : "Pricing, MOQ and lead time depend on your specification, so we will confirm them in your costing.",
  });

  return finish(
    {
      subject,
      preheader: zh
        ? `${n ? "您看中的款式，" : ""}按您的规格定做。`
        : `${n ? `${ctx.styles.map((s) => s.name ?? s.code).slice(0, 2).join(" and ")}${booth ? ` from ${booth}` : ""}, ` : ""}made to your spec.`,
      headerNote: fair || booth ? [fair, booth].filter(Boolean).join(" · ") : null,
      greeting: zh ? `${ctx.contactName ?? ""}${ctx.contactName ? "，" : ""}您好：` : `Hi ${name ?? "there"},`,
      blocks,
      signature: ctx.signature,
      footer: footerLines(ctx, lang),
    },
    ctx,
    lang,
  );
}

// ── 跟进（买家没回信） ───────────────────────────────────

export function composeFollowUpEmail(
  ctx: BoothEmailContext,
  opts: { step: number; total: number; previousSubject: string | null },
  lang: Lang,
): ComposedEmail {
  const zh = lang === "zh";
  const name = firstName(ctx.contactName);
  const last = opts.step >= opts.total;
  const prev = opts.previousSubject?.trim() || null;
  const reSubject = prev ? (/^(re|回复)[:：]/i.test(prev) ? prev : `${zh ? "回复：" : "Re: "}${prev}`) : null;
  const greeting = zh ? `${ctx.contactName ?? ""}${ctx.contactName ? "，" : ""}您好：` : `Hi ${name ?? "there"},`;
  const wa = whatsappLink(ctx.signature.whatsapp);
  const blocks: EmailBlock[] = [];
  let subject: string;
  let preheader: string;

  if (opts.step === 1) {
    subject = reSubject ?? (zh ? `跟进：您的报价 — ${ctx.orgName}` : `Following up on your costing — ${ctx.orgName}`);
    preheader = zh ? "回一句话，我们就开始报价。" : "One line back is all we need to start your costing.";
    blocks.push({
      kind: "paragraph",
      text: zh
        ? "把这封邮件顶到您收件箱最上面。如果项目在推进，最快拿到报价的方式是回一句话，例如："
        : "Bringing this back to the top of your inbox. If the project is moving ahead, the quickest way to get your costing is a one-line reply, for example:",
    });
    const items = ctx.styles.length
      ? ctx.styles.map((s) => `${s.code}: ${zh ? "[数量]" : "[quantity]"}`)
      : [`${ctx.product && !(!zh && /[\u3400-\u9fff]/.test(ctx.product)) ? ctx.product : zh ? "[产品]" : "[product]"}: ${zh ? "[数量]" : "[quantity]"}`];
    blocks.push({ kind: "quote", text: `“${[...items, zh ? "到 [港口]" : "to [port]", zh ? "[月份] 前交货" : "deliver by [month]"].join(" · ")}”` });
    blocks.push({ kind: "note", text: zh ? "填您自己的数字就行；不确定的地方，我们一起商量。" : "Your own numbers, of course. Anything you are unsure about, we can work out together." });
    if (ctx.styles.length) {
      blocks.push({ kind: "label", text: zh ? "您看中的款式" : "Your picks" });
      blocks.push({ kind: "styles", items: styleCards(ctx) });
    }
    const mail = mailto(ctx.replyEmail, `Re: Costing for ${codesLabel(ctx) || "my inquiry"}`);
    const buttons = [
      ...(mail ? [{ label: zh ? "回一句话" : "Reply in one line", href: mail, primary: true }] : []),
      ...(wa ? [{ label: zh ? "WhatsApp 联系" : "Chat on WhatsApp", href: wa, primary: !mail }] : []),
    ];
    if (buttons.length) blocks.push({ kind: "buttons", items: buttons });
  } else if (!last) {
    subject = zh ? `${name ? `${name}，` : ""}三种包装方案供您参考` : `3 packing formats for your range${name ? `, ${name}` : ""}`;
    preheader = zh ? "每种都可以印您的品牌，另有一个小问题。" : "Each can carry your own brand, plus one quick question.";
    blocks.push({
      kind: "paragraph",
      text: zh
        ? "您在规划产品线时，这三种包装方式很适合礼品和零售项目，每种都可以印您的品牌："
        : "While you plan the range, here are three packing formats that work well for gift and retail programs. Each one can carry your own brand:",
    });
    blocks.push({
      kind: "cards",
      items: zh
        ? [
            { title: "腰封 + 吊牌", text: "上架即卖，方便堆放；腰封上印您的 Logo。" },
            { title: "带提手 PVC 袋", text: "透明礼品感，配您的品牌插卡。" },
            { title: "彩盒", text: "适合礼品套装，比如浴袍配同款毛毯。" },
          ]
        : [
            { title: "Belly band + hang tag", text: "Shelf-ready and easy to stack; your logo on the band." },
            { title: "PVC bag with handle", text: "See-through gift look with a branded insert card." },
            { title: "Colour gift box", text: "For gift sets, such as a robe with a matching blanket." },
          ],
    });
    blocks.push({ kind: "label", text: zh ? "项目这一季还在进行吗？" : "Is the project still on for this season?" });
    blocks.push({
      kind: "paragraph",
      text: zh ? "如果是，告诉我数量和目的地，我把您喜欢的包装一起放进报价。" : "If yes, tell me the quantity and destination and I will include your preferred packing in the costing.",
    });
    const mail = mailto(ctx.replyEmail, "Yes — costing with packing options");
    const buttons = [
      ...(mail ? [{ label: zh ? "是，请报价" : "Yes, send me a costing", href: mail, primary: true }] : []),
      ...(wa ? [{ label: zh ? "WhatsApp 问问" : "Ask on WhatsApp", href: wa, primary: !mail }] : []),
    ];
    if (buttons.length) blocks.push({ kind: "buttons", items: buttons });
  } else {
    subject = zh ? `${name ? `${name}，` : ""}要不要先把您的档案关掉？` : `Should I close your file${name ? `, ${name}` : ""}?`;
    preheader = zh ? "回 1、2 或 3 就行。" : "Just reply 1, 2 or 3.";
    blocks.push({
      kind: "paragraph",
      text: zh
        ? "一直没收到您的回复，可能现在时机不合适。不想打扰您太多，这是我近期最后一封邮件。简单起见，回一个数字就行："
        : "I haven't heard back, so I'll assume the timing isn't right. I don't want to fill your inbox, so this is my last email for now. To keep it simple, just reply with a number:",
    });
    const opt = (n: number, title: string, hint: string, subj: string) => ({ title, hint, href: mailto(ctx.replyEmail, `${n} — ${subj}`) ?? "" });
    blocks.push({
      kind: "options",
      items: zh
        ? [opt(1, "还感兴趣", "请给我报价", "still interested"), opt(2, "现在不需要", "下一季再联系我", "next season"), opt(3, "不合适", "请关闭我的档案", "not a fit")]
        : [
            opt(1, "Still interested", "Send me a costing", "still interested"),
            opt(2, "Not now", "Check back with me next season", "next season"),
            opt(3, "Not a fit", "Please close my file", "not a fit"),
          ],
    });
    blocks.push({
      kind: "paragraph",
      text: zh
        ? `无论如何，感谢您${ctx.event ? "到访我们的展位" : "联系我们"}。`
        : `Either way, thank you for ${ctx.event ? (parseEvent(ctx.event).fair ? "visiting us at the Canton Fair" : "visiting our booth") : "getting in touch"}.`,
    });
  }

  return finish({ subject, preheader, headerNote: null, greeting, blocks, signature: ctx.signature, footer: footerLines(ctx, lang) }, ctx, lang);
}
