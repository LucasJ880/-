/**
 * INSTALL-2c：完工 + 质保邮件（纯函数）
 *
 * - 质保设置：Organization.settingsJson.sunnyWarranty；从未保存 = 种子（报价单口径，Lucas 2026-10-28 拍板）
 * - 年限按 品类 × 部件；品类来自收口单元（closeout.ts）
 * - 邮件：确定性渲染，主题 / 英文正文 / 同内容 HTML；不含任何金额（spec「邮件不输出的内容」）
 * - INSTALL-2g：Shutters 按官网新条款（人工 1 / 部件 15 / 框架与叶片 25）；报修电话 / 邮箱与抄送经 Lucas 2026-10-29 确认进种子；
 *   已保存的设置原样使用，不被种子覆盖（install-2g design D2）
 * - INSTALL-2h：帘类 / 窗帘按官网新条款加无绳升降机构、电机配件、电池；电机 / 配件 / 电池注明 if supplied，无绳机构注明 cordless models
 */

import type { FulfillmentCategory } from "@/lib/fulfillment/category";

export const WARRANTY_SETTINGS_KEY = "sunnyWarranty" as const;
export const WARRANTY_ACTION_TYPE = "install.send_warranty_email" as const;
export const INSTALL_WARRANTY_SENT = "install.warranty.sent" as const;
export const NOTIFY_WARRANTY_SENT = "install_warranty_sent" as const;
export const NOTIFY_WARRANTY_FAILED = "install_warranty_failed" as const;

export const WARRANTY_CATEGORIES: readonly FulfillmentCategory[] = ["shades", "drapery", "vinyl"];
export const WARRANTY_PARTS = ["labour", "fabric", "components", "cordless", "frame", "motor", "motor_accessories", "batteries"] as const;
export type WarrantyPart = (typeof WARRANTY_PARTS)[number];

export const CATEGORY_LABEL_EN: Record<FulfillmentCategory, string> = {
  shades: "Shades & Blinds",
  drapery: "Drapes & Sheers",
  vinyl: "Shutters",
};
export const CATEGORY_LABEL_ZH: Record<FulfillmentCategory, string> = {
  shades: "帘类",
  drapery: "窗帘",
  vinyl: "Shutters",
};
export const PART_LABEL_EN: Record<WarrantyPart, string> = {
  labour: "Labour",
  fabric: "Fabric",
  components: "Components",
  cordless: "Cordless Lift Mechanism (cordless models)",
  frame: "Frame & Panels",
  motor: "Motor (if supplied)",
  motor_accessories: "Motor Accessories (if supplied)",
  batteries: "Batteries (if supplied)",
};
export const PART_LABEL_ZH: Record<WarrantyPart, string> = {
  labour: "人工",
  fabric: "面料",
  components: "部件",
  cordless: "无绳升降机构",
  frame: "框架与叶片",
  motor: "电机",
  motor_accessories: "电机配件",
  batteries: "电池",
};

export type WarrantyTerm = { part: WarrantyPart; years: number };
export type WarrantyContact = {
  companyName: string;
  phone: string;
  email: string;
  address: string;
  warrantyUrl: string;
};
export type WarrantySettings = {
  terms: Record<FulfillmentCategory, WarrantyTerm[]>;
  contact: WarrantyContact;
  /** 质保邮件抄送（内部跟进人，不是写给客户的报修信息；install-2g design D3） */
  cc: string[];
};

export const WARRANTY_CC_MAX = 5;

/** 种子 = 报价单 PDF 口径（quote-pdf.ts：帘类 1·5·15·无绳 3·电机 5·配件 5·电池 1，窗帘同但无无绳，Shutters 1·15·25）；地址取维修单抬头 */
export function seedWarrantySettings(): WarrantySettings {
  const drapery: WarrantyTerm[] = [
    { part: "labour", years: 1 },
    { part: "fabric", years: 5 },
    { part: "components", years: 15 },
    { part: "motor", years: 5 },
    { part: "motor_accessories", years: 5 },
    { part: "batteries", years: 1 },
  ];
  // 官网：无绳升降机构只针对手动无绳的帘与卷帘（含斑马帘），窗帘没有
  const cordless: WarrantyTerm = { part: "cordless", years: 3 };
  const shades: WarrantyTerm[] = [...drapery, cordless].sort(
    (a, b) => WARRANTY_PARTS.indexOf(a.part) - WARRANTY_PARTS.indexOf(b.part),
  );
  return {
    terms: {
      shades,
      drapery,
      vinyl: [
        { part: "labour", years: 1 },
        { part: "components", years: 15 },
        { part: "frame", years: 25 },
      ],
    },
    contact: {
      companyName: "Sunny Shutter Inc",
      phone: "647-857-8669",
      email: "service@sunnyshutter.ca",
      address: "2-680 Progress Avenue, Scarborough, ON M1H 3A5",
      warrantyUrl: "https://sunnyshutter.ca/warranty-service/",
    },
    cc: ["miki@sunnyshutter.ca"],
  };
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^[0-9+()\-.\s]{7,30}$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export type WarrantyValidation = { ok: true; settings: WarrantySettings } | { ok: false; errors: string[] };

/** 抄送：数组或逗号 / 分号 / 空白分隔的字符串 → 小写去重；缺省（旧设置没有该键）= 空列表 */
export function parseWarrantyCc(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map(str) : str(input).split(/[,，;；\s]+/);
  return [...new Set(raw.map((x) => x.toLowerCase()).filter(Boolean))];
}

/** 执行器用：审批内容里的抄送须是不超过上限的合法邮箱数组（缺省 = 不抄送）；不合法返回原因 */
export function warrantyCcProblem(cc: unknown): string | null {
  if (cc === undefined || cc === null) return null;
  if (!Array.isArray(cc) || cc.some((a) => typeof a !== "string" || !EMAIL_RE.test(a))) return "抄送地址格式不对";
  if (cc.length > WARRANTY_CC_MAX) return `抄送最多 ${WARRANTY_CC_MAX} 个`;
  return null;
}

/** PUT 入参校验（spec「质保设置读写」）：年限 0–50 整数、部件限八种且同品类不重复、邮箱 / 网址 / 抄送格式 */
export function validateWarrantySettings(input: unknown): WarrantyValidation {
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const errors: string[] = [];
  const termsIn = o.terms && typeof o.terms === "object" && !Array.isArray(o.terms) ? (o.terms as Record<string, unknown>) : null;
  if (!termsIn) errors.push("缺少质保年限");
  for (const k of Object.keys(termsIn ?? {})) {
    if (!(WARRANTY_CATEGORIES as readonly string[]).includes(k)) errors.push(`未知品类：${k}`);
  }
  const terms = {} as Record<FulfillmentCategory, WarrantyTerm[]>;
  for (const c of WARRANTY_CATEGORIES) {
    const raw = termsIn?.[c];
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    terms[c] = [];
    for (const t of list) {
      const part = str((t as { part?: unknown })?.part);
      const yearsRaw = (t as { years?: unknown })?.years;
      const years = typeof yearsRaw === "string" && yearsRaw.trim() !== "" ? Number(yearsRaw) : yearsRaw;
      if (!(WARRANTY_PARTS as readonly string[]).includes(part)) {
        errors.push(`${CATEGORY_LABEL_ZH[c]}：未知部件 ${part || "（空）"}`);
        continue;
      }
      if (typeof years !== "number" || !Number.isInteger(years) || years < 0 || years > 50) {
        errors.push(`${CATEGORY_LABEL_ZH[c]} ${PART_LABEL_ZH[part as WarrantyPart]}：年限须为 0–50 的整数`);
        continue;
      }
      if (seen.has(part)) {
        errors.push(`${CATEGORY_LABEL_ZH[c]}：${PART_LABEL_ZH[part as WarrantyPart]} 重复`);
        continue;
      }
      seen.add(part);
      terms[c].push({ part: part as WarrantyPart, years });
    }
    terms[c].sort((a, b) => WARRANTY_PARTS.indexOf(a.part) - WARRANTY_PARTS.indexOf(b.part));
  }
  const ci = o.contact && typeof o.contact === "object" ? (o.contact as Record<string, unknown>) : {};
  const contact: WarrantyContact = {
    companyName: str(ci.companyName),
    phone: str(ci.phone),
    email: str(ci.email).toLowerCase(),
    address: str(ci.address),
    warrantyUrl: str(ci.warrantyUrl),
  };
  if (!contact.companyName) errors.push("请填公司名");
  if (contact.companyName.length > 80) errors.push("公司名不超过 80 字");
  if (contact.phone && !PHONE_RE.test(contact.phone)) errors.push(`报修电话格式不对：${contact.phone}`);
  if (contact.email && !EMAIL_RE.test(contact.email)) errors.push(`报修邮箱格式不对：${contact.email}`);
  if (contact.address.length > 200) errors.push("地址不超过 200 字");
  if (contact.warrantyUrl && !/^https:\/\/[^\s"'<>]+$/.test(contact.warrantyUrl)) errors.push("质保条款链接须以 https:// 开头");
  const cc = parseWarrantyCc(o.cc);
  for (const a of cc) if (!EMAIL_RE.test(a)) errors.push(`抄送地址格式不对：${a}`);
  if (cc.length > WARRANTY_CC_MAX) errors.push(`抄送最多 ${WARRANTY_CC_MAX} 个`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, settings: { terms, contact, cc } };
}

/** 读组织设置；从未保存或已存的坏数据 → 种子（saved=false） */
export function readWarrantySettings(settingsJson: unknown): { settings: WarrantySettings; saved: boolean } {
  const raw =
    settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson)
      ? (settingsJson as Record<string, unknown>)[WARRANTY_SETTINGS_KEY]
      : undefined;
  if (raw === undefined || raw === null) return { settings: seedWarrantySettings(), saved: false };
  const v = validateWarrantySettings(raw);
  return v.ok ? { settings: v.settings, saved: true } : { settings: seedWarrantySettings(), saved: false };
}

/** YYYY-MM-DD + 年；2 月 29 日顺延到 2 月 28 日（design D8） */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const ty = y + years;
  const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(ty).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type WarrantyUnit = {
  itemNumber: number;
  location: string;
  productType: string;
  fabricSku: string;
  category: FulfillmentCategory | null;
};

/** 生成条件（spec「生成条件」）：返回全部未满足的原因；空数组 = 可生成 */
export function warrantyBlockers(input: {
  balanceConfirmed: boolean;
  customerEmail: string | null | undefined;
  units: WarrantyUnit[];
  settings: WarrantySettings;
}): string[] {
  const out: string[] = [];
  if (!input.balanceConfirmed) out.push("尾款尚未确认");
  const email = (input.customerEmail ?? "").trim();
  if (!email) out.push("客户没有邮箱");
  else if (!EMAIL_RE.test(email)) out.push(`客户邮箱格式不对：${email}`);
  if (input.units.length === 0) out.push("没有收口单元");
  for (const u of input.units) {
    if (!u.category) out.push(`第 ${u.itemNumber} 项（${u.location || "未写位置"}）无法识别品类`);
  }
  const cats = [...new Set(input.units.map((u) => u.category).filter((c): c is FulfillmentCategory => !!c))];
  for (const c of WARRANTY_CATEGORIES) {
    if (cats.includes(c) && input.settings.terms[c].length === 0) out.push(`${CATEGORY_LABEL_ZH[c]}未配置质保年限`);
  }
  if (!input.settings.contact.phone) out.push("缺报修电话");
  if (!input.settings.contact.email) out.push("缺报修邮箱");
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type WarrantyEmail = { warrantyNo: string; subject: string; text: string; html: string };

/** 确定性渲染（spec「邮件内容」）；调用方须先确认 warrantyBlockers 为空 */
export function renderWarrantyEmail(input: {
  orderCode: string;
  customerName: string;
  address: string | null;
  installDate: string;
  units: WarrantyUnit[];
  settings: WarrantySettings;
}): WarrantyEmail {
  const { settings: s } = input;
  const warrantyNo = `W-${input.orderCode}`;
  const subject = `Your Sunny Shutter installation is complete — Warranty ${warrantyNo} (Order ${input.orderCode})`;
  const address = (input.address ?? "").trim() || "—";
  const units = [...input.units].sort((a, b) => a.itemNumber - b.itemNumber);
  const product = (u: WarrantyUnit) => [u.productType, u.fabricSku].filter((x) => x && x.trim()).join(" ");
  const cats = WARRANTY_CATEGORIES.filter((c) => units.some((u) => u.category === c));
  const coverage = cats.map((c) => ({
    label: CATEGORY_LABEL_EN[c],
    terms: s.terms[c].map((t) => ({ label: PART_LABEL_EN[t.part], years: t.years, until: addYears(input.installDate, t.years) })),
  }));
  const yr = (n: number) => `${n} yr`;
  const c = s.contact;

  const text = [
    `Hi ${input.customerName},`,
    "",
    `Thank you for choosing ${c.companyName}. Your installation at ${address}`,
    `was completed on ${input.installDate}, and your order is now fully closed.`,
    "This email is your warranty confirmation — please keep it for your records.",
    "",
    "WARRANTY CONFIRMATION",
    `  Warranty No.:   ${warrantyNo}`,
    `  Order No.:      ${input.orderCode}`,
    `  Customer:       ${input.customerName}`,
    `  Address:        ${address}`,
    `  Installed on:   ${input.installDate}  (warranty starts on this date)`,
    "",
    "COVERED PRODUCTS",
    ...units.map((u, i) => `  ${i + 1}. ${u.location || "—"} — ${product(u) || "—"}`),
    "",
    `WARRANTY COVERAGE (from ${input.installDate})`,
    ...coverage.map((g) => `  ${g.label}: ${g.terms.map((t) => `${t.label} ${yr(t.years)} (until ${t.until})`).join(" · ")}`),
    "",
    ...(c.warrantyUrl ? ["Full warranty terms, coverage and exclusions:", c.warrantyUrl, ""] : []),
    "NEED SERVICE?",
    `  Please contact us with your Warranty No. (${warrantyNo}) and a photo of the`,
    "  issue — this lets us identify your exact product and size right away.",
    `  Phone:   ${c.phone}`,
    `  Email:   ${c.email}`,
    ...(c.address ? [`  Address: ${c.address}`] : []),
    "",
    "CARE TIPS",
    "  - Dust with a soft dry cloth or a vacuum brush attachment.",
    "  - Operate cords, wands and motors gently; do not force past the end stop.",
    "  - Keep cords out of reach of children and pets.",
    "",
    "Thank you again for your trust.",
    "",
    c.companyName,
    ...(c.address ? [c.address] : []),
    `${c.phone} · ${c.email}`,
  ].join("\n");

  const row = (k: string, v: string) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#6b6b6b;white-space:nowrap;">${esc(k)}</td><td style="padding:2px 0;color:#1c1c1c;">${esc(v)}</td></tr>`;
  const h2 = (t: string) => `<h2 style="margin:24px 0 8px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#2e5e4e;">${esc(t)}</h2>`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f4ef;font-family:'Helvetica Neue',Arial,sans-serif;color:#1c1c1c;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f4ef;padding:24px 12px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e8e3d9;border-radius:6px;">
<tr><td style="padding:24px 28px 8px;border-bottom:3px solid #2e5e4e;"><div style="font-size:20px;font-weight:700;color:#2e5e4e;">${esc(c.companyName)}</div><div style="margin-top:4px;font-size:13px;color:#6b6b6b;">Installation complete · Warranty confirmation</div></td></tr>
<tr><td style="padding:16px 28px 28px;font-size:14px;line-height:1.6;">
<p style="margin:0 0 12px;">Hi ${esc(input.customerName)},</p>
<p style="margin:0 0 12px;">Thank you for choosing ${esc(c.companyName)}. Your installation at ${esc(address)} was completed on ${esc(input.installDate)}, and your order is now fully closed. This email is your warranty confirmation — please keep it for your records.</p>
${h2("Warranty confirmation")}
<table cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">${row("Warranty No.", warrantyNo)}${row("Order No.", input.orderCode)}${row("Customer", input.customerName)}${row("Address", address)}${row("Installed on", `${input.installDate} (warranty starts on this date)`)}</table>
${h2("Covered products")}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;border-collapse:collapse;">${units
    .map((u, i) => `<tr><td style="padding:4px 8px 4px 0;border-bottom:1px solid #f0ece4;color:#6b6b6b;width:24px;">${i + 1}</td><td style="padding:4px 8px;border-bottom:1px solid #f0ece4;">${esc(u.location || "—")}</td><td style="padding:4px 0;border-bottom:1px solid #f0ece4;">${esc(product(u) || "—")}</td></tr>`)
    .join("")}</table>
${h2(`Warranty coverage (from ${input.installDate})`)}
${coverage
    .map((g) => `<p style="margin:0 0 6px;"><strong>${esc(g.label)}:</strong> ${g.terms.map((t) => `${esc(t.label)} ${esc(yr(t.years))} (until ${esc(t.until)})`).join(" · ")}</p>`)
    .join("")}
${c.warrantyUrl ? `<p style="margin:12px 0 0;">Full warranty terms, coverage and exclusions: <a href="${esc(c.warrantyUrl)}" style="color:#2e5e4e;">${esc(c.warrantyUrl)}</a></p>` : ""}
${h2("Need service?")}
<p style="margin:0 0 6px;">Please contact us with your Warranty No. (${esc(warrantyNo)}) and a photo of the issue — this lets us identify your exact product and size right away.</p>
<table cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">${row("Phone", c.phone)}${row("Email", c.email)}${c.address ? row("Address", c.address) : ""}</table>
${h2("Care tips")}
<ul style="margin:0;padding-left:18px;"><li>Dust with a soft dry cloth or a vacuum brush attachment.</li><li>Operate cords, wands and motors gently; do not force past the end stop.</li><li>Keep cords out of reach of children and pets.</li></ul>
<p style="margin:20px 0 0;">Thank you again for your trust.</p>
</td></tr>
<tr><td style="padding:16px 28px;background:#faf8f3;border-top:1px solid #e8e3d9;font-size:12px;color:#6b6b6b;">${esc(c.companyName)}${c.address ? ` · ${esc(c.address)}` : ""}<br>${esc(c.phone)} · ${esc(c.email)}</td></tr>
</table></td></tr></table></body></html>`;

  return { warrantyNo, subject, text, html };
}

export type WarrantyStatus = "none" | "blocked" | "pending_approval" | "sent" | "failed" | "rejected" | "expired";
export type WarrantyStatusView = {
  status: WarrantyStatus;
  approvalId?: string;
  sentAt?: string;
  reason?: string;
  blockers?: string[];
  /** 页面是否显示"生成质保邮件" */
  canRegenerate: boolean;
};

/** 状态推导（spec「质保邮件状态展示」）：已发送优先 → 最近一条审批 → 阻断原因 → 未生成 */
export function deriveWarrantyStatus(input: {
  sentAt: string | null;
  latestAction: { id: string; status: string; failureReason: string | null } | null;
  blockers: string[];
}): WarrantyStatusView {
  if (input.sentAt) return { status: "sent", sentAt: input.sentAt, canRegenerate: false };
  const a = input.latestAction;
  if (a) {
    if (a.status === "pending" || a.status === "approved") return { status: "pending_approval", approvalId: a.id, canRegenerate: false };
    if (a.status === "rejected") return { status: "rejected", approvalId: a.id, reason: a.failureReason ?? undefined, canRegenerate: true };
    if (a.status === "failed") {
      const expired = /过期/.test(a.failureReason ?? "");
      return { status: expired ? "expired" : "failed", approvalId: a.id, reason: a.failureReason ?? undefined, canRegenerate: true };
    }
    if (a.status === "executed") return { status: "sent", canRegenerate: false };
  }
  if (input.blockers.length > 0) return { status: "blocked", blockers: input.blockers, canRegenerate: true };
  return { status: "none", canRegenerate: true };
}

/** 只替换 settingsJson.sunnyWarranty，其他键原样保留（与 sunnyProcess.zebraRatios 同一原则） */
export function withWarrantySettings(settingsJson: unknown, settings: WarrantySettings): Record<string, unknown> {
  const base = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson) ? { ...(settingsJson as Record<string, unknown>) } : {};
  base[WARRANTY_SETTINGS_KEY] = settings;
  return base;
}
