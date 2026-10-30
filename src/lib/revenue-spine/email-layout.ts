/**
 * Revenue Spine — 跟进邮件版式：同一份内容（EmailDoc）出纯文本和 HTML 两个版本
 *
 * 纯文本 = 审批预览、守卫检查、邮件的 text 部分；HTML = 邮件正文（表格布局 + 内联样式，邮箱客户端通用）。
 * 两者出自同一份结构，不会说两套话。所有文字一律 HTML 转义，链接只收 https / mailto / wa.me。
 */

export interface EmailStyleCard {
  name: string;
  code: string;
  specUrl?: string | null;
  imageUrl?: string | null;
  chips?: string[];
}

export type EmailBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "label"; text: string }
  | { kind: "styles"; items: EmailStyleCard[] }
  | { kind: "chips"; title: string; items: string[] }
  | { kind: "steps"; items: Array<{ title: string; hint: string }> }
  | { kind: "quote"; text: string }
  | { kind: "cards"; items: Array<{ title: string; text: string }> }
  | { kind: "options"; items: Array<{ title: string; hint: string; href: string }> }
  | { kind: "buttons"; items: Array<{ label: string; href: string; primary?: boolean }> }
  | { kind: "facts"; imageUrl?: string | null; items: Array<{ value: string; label: string }> }
  | { kind: "note"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean };

export interface EmailSignature {
  name: string;
  title?: string | null;
  org: string;
  whatsapp?: string | null;
  website?: string | null;
}

export interface EmailDoc {
  /** zh = 只给审核人看的中文对照（纯文本标点 / 落款按中文） */
  lang?: "en" | "zh";
  subject: string;
  /** 收件箱里主题下面那行预览 */
  preheader: string;
  /** 抬头右侧的小字（如展位号） */
  headerNote?: string | null;
  greeting: string;
  blocks: EmailBlock[];
  signature: EmailSignature;
  /** 页脚每行一句 */
  footer: string[];
}

export interface EmailBrand {
  orgName: string;
  logoUrl?: string | null;
  accent: string;
}

const SAFE_URL = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|https:\/\/wa\.me\/\d+)$/i;

export function safeUrl(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  return SAFE_URL.test(u) ? u : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 显示用的网址：去掉协议和 www（mengxinhometextile.com） */
export function displayHost(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** WhatsApp 号码 → wa.me 链接（只保留数字） */
export function whatsappLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

// ── 纯文本 ───────────────────────────────────────────────

function textBlock(b: EmailBlock, zh: boolean): string {
  switch (b.kind) {
    case "paragraph":
    case "note":
      return b.text;
    case "label":
      return b.text;
    case "styles":
      return b.items
        .map((s) => [s.name === s.code ? `- ${s.code}` : `- ${s.name} (ref. ${s.code})`, s.specUrl ? `  ${zh ? "规格页" : "Specification"}: ${s.specUrl}` : null].filter(Boolean).join("\n"))
        .join("\n");
    case "chips":
      return zh ? `${b.title}：${b.items.join("、")}。` : `${b.title}: ${b.items.map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join(", ")}.`;
    case "steps":
      return b.items.map((s, i) => `${i + 1}. ${s.title} — ${s.hint}`).join("\n");
    case "quote":
      return `  ${b.text}`;
    case "cards":
      return b.items.map((c) => `- ${c.title}${zh ? "：" : ": "}${c.text}`).join("\n");
    case "options":
      return b.items.map((o, i) => `${i + 1} — ${o.title}${zh ? "：" : ": "}${o.hint}`).join("\n");
    case "buttons":
      return b.items
        .filter((x) => !x.href.startsWith("mailto:"))
        .map((x) => `${x.label}${zh ? "：" : ": "}${x.href}`)
        .join("\n");
    case "facts":
      return b.items.map((f) => `${f.value} ${f.label}`).join(" · ");
    case "list":
      return b.items.map((x, i) => (b.ordered ? `${i + 1}. ${x}` : `- ${x}`)).join("\n");
  }
}

export function renderEmailText(doc: EmailDoc): string {
  const zh = doc.lang === "zh";
  const parts = [doc.greeting, ...doc.blocks.map((b) => textBlock(b, zh)).filter((t) => t.trim())];
  const sig = doc.signature;
  const sigLines = [
    zh ? "此致" : "Best regards,",
    sig.name,
    [sig.title, sig.org].filter(Boolean).join(" · "),
    [sig.whatsapp ? `WhatsApp ${sig.whatsapp}` : null, sig.website ? displayHost(sig.website) : null].filter(Boolean).join(" · "),
  ].filter((l) => l.trim());
  return [...parts, sigLines.join("\n")].join("\n\n");
}

// ── HTML ─────────────────────────────────────────────────

const FONT = "'DM Sans',Helvetica,Arial,sans-serif";
const INK = "#2C2C2C";
const BODY = "#3D3936";
const MUTED = "#6E6A66";
const LINE = "#E8E0DC";
const SOFT = "#FAF8F5";
const TINT = "#F6E7E4";
const TINT_INK = "#6B4A3E";

const e = escapeHtml;

function row(inner: string, pad = "0 32px 20px"): string {
  return `<tr><td style="padding:${pad}">${inner}</td></tr>`;
}

function chip(text: string, bg = TINT, color = TINT_INK, size = 11): string {
  return `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 9px;border-radius:999px;background:${bg};color:${color};font-size:${size}px;line-height:1.3">${e(text)}</span>`;
}

function button(label: string, href: string, primary: boolean, accent: string): string {
  const url = safeUrl(href);
  if (!url) return "";
  const style = primary
    ? `background:${accent};color:#FFFFFF;border:1.5px solid ${accent}`
    : `background:#FFFFFF;color:${accent};border:1.5px solid ${accent}`;
  return `<a href="${e(url)}" style="display:inline-block;margin:0 10px 10px 0;padding:12px 22px;border-radius:8px;${style};font-size:15px;font-weight:700;text-decoration:none">${e(label)}</a>`;
}

function styleCard(s: EmailStyleCard, accent: string): string {
  const img = safeUrl(s.imageUrl);
  const spec = safeUrl(s.specUrl);
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px;border-collapse:separate;overflow:hidden">`,
    img ? `<tr><td><img src="${e(img)}" alt="${e(s.name)}" width="258" style="display:block;width:100%;height:auto;border:0"></td></tr>` : "",
    `<tr><td style="padding:14px 16px 16px">`,
    `<div style="font-size:16px;font-weight:700;line-height:1.3;color:${INK}">${e(s.name)}</div>`,
    s.name === s.code ? `<div style="height:8px"></div>` : `<div style="font-size:12px;color:${MUTED};padding:4px 0 8px">Ref. ${e(s.code)}</div>`,
    (s.chips ?? []).map((c) => chip(c)).join(""),
    spec ? `<div style="padding-top:6px"><a href="${e(spec)}" style="font-size:14px;font-weight:700;color:${accent};text-decoration:none">View specification&nbsp;&rarr;</a></div>` : "",
    `</td></tr></table>`,
  ].join("");
}

function htmlBlock(b: EmailBlock, accent: string): string {
  switch (b.kind) {
    case "paragraph":
      return row(`<p style="margin:0;font-size:16px;line-height:1.6;color:${BODY}">${e(b.text)}</p>`, "0 32px 16px");
    case "note":
      return row(`<p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED}">${e(b.text)}</p>`, "0 32px 16px");
    case "label":
      return row(`<div style="font-size:12px;font-weight:700;letter-spacing:0.14em;color:${accent};text-transform:uppercase">${e(b.text)}</div>`, "12px 32px 12px");
    case "styles": {
      const cells: string[] = [];
      for (let i = 0; i < b.items.length; i += 2) {
        const pair = b.items.slice(i, i + 2);
        cells.push(
          `<tr>${pair.map((s, j) => `<td width="50%" valign="top" style="padding:0 ${j === 0 ? "8px" : "0"} 16px ${j === 1 ? "8px" : "0"}">${styleCard(s, accent)}</td>`).join("")}${pair.length === 1 ? "<td width=\"50%\"></td>" : ""}</tr>`,
        );
      }
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells.join("")}</table>`, "0 32px 4px");
    }
    case "chips":
      return row(
        `<div style="padding:18px 20px;background:${SOFT};border-radius:10px"><div style="font-size:15px;font-weight:700;color:${INK};padding-bottom:10px">${e(b.title)}</div>${b.items.map((c) => chip(c, "#FFFFFF", INK, 13)).join("")}</div>`,
      );
    case "steps":
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${b.items
          .map(
            (s, i) =>
              `<td valign="top" width="${Math.floor(100 / b.items.length)}%" style="padding:0 ${i < b.items.length - 1 ? "10px" : "0"} 0 0"><div style="border:1px solid ${LINE};border-radius:10px;padding:14px"><div style="font-size:22px;font-weight:700;color:${accent}">${i + 1}</div><div style="font-size:14px;font-weight:700;color:${INK};padding-top:4px">${e(s.title)}</div><div style="font-size:13px;line-height:1.4;color:${MUTED};padding-top:4px">${e(s.hint)}</div></div></td>`,
          )
          .join("")}</tr></table>`,
      );
    case "quote":
      return row(`<div style="padding:16px 18px;border-radius:10px;background:${SOFT};border:1px dashed #D9C9C2;font-size:15px;line-height:1.6;color:${BODY}">${e(b.text)}</div>`);
    case "cards":
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${b.items
          .map(
            (c, i) =>
              `<td valign="top" width="${Math.floor(100 / b.items.length)}%" style="padding:0 ${i < b.items.length - 1 ? "10px" : "0"} 0 0"><div style="border:1px solid ${LINE};border-radius:10px;padding:14px"><div style="font-size:14px;font-weight:700;color:${INK}">${e(c.title)}</div><div style="font-size:13px;line-height:1.45;color:${MUTED};padding-top:6px">${e(c.text)}</div></div></td>`,
          )
          .join("")}</tr></table>`,
      );
    case "options":
      return row(
        b.items
          .map((o, i) => {
            const url = safeUrl(o.href);
            const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px;border-collapse:separate"><tr><td width="56" style="padding:14px 0 14px 18px"><div style="width:36px;height:36px;line-height:36px;text-align:center;border-radius:999px;background:${i === 0 ? accent : TINT};color:${i === 0 ? "#FFFFFF" : TINT_INK};font-size:17px;font-weight:700">${i + 1}</div></td><td style="padding:14px 18px 14px 12px"><div style="font-size:15px;font-weight:700;color:${INK}">${e(o.title)}</div><div style="font-size:13px;color:${MUTED};padding-top:2px">${e(o.hint)}</div></td></tr></table>`;
            return `<div style="padding-bottom:10px">${url ? `<a href="${e(url)}" style="text-decoration:none;color:${INK}">${inner}</a>` : inner}</div>`;
          })
          .join(""),
      );
    case "buttons":
      return row(b.items.map((x) => button(x.label, x.href, Boolean(x.primary), accent)).join(""), "4px 32px 12px");
    case "facts": {
      const img = safeUrl(b.imageUrl);
      const grid = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${[0, 2]
        .map(
          (k) =>
            `<tr>${b.items
              .slice(k, k + 2)
              .map((f) => `<td width="50%" valign="top" style="padding:8px 10px"><div style="font-size:22px;font-weight:700;color:${INK}">${e(f.value)}</div><div style="font-size:12px;line-height:1.35;color:${MUTED}">${e(f.label)}</div></td>`)
              .join("")}</tr>`,
        )
        .join("")}</table>`;
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px;border-collapse:separate;overflow:hidden"><tr>${
          img ? `<td width="50%" valign="middle"><img src="${e(img)}" alt="" width="268" style="display:block;width:100%;height:auto;border:0"></td>` : ""
        }<td valign="middle" style="padding:10px 10px">${grid}</td></tr></table>`,
        "8px 32px 16px",
      );
    }
    case "list":
      return row(
        `<${b.ordered ? "ol" : "ul"} style="margin:0;padding-left:22px;font-size:16px;line-height:1.6;color:${BODY}">${b.items.map((x) => `<li>${e(x)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`,
        "0 32px 16px",
      );
  }
}

function brandAccent(brand: EmailBrand): string {
  return /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : "#8E6657";
}

/** 外框：背景、600px 白卡片、抬头（Logo + 公司名 + 右侧小字）、页脚 */
function frame(input: { subject: string; preheader: string; headerNote?: string | null; footer: string[]; rows: string[] }, brand: EmailBrand): string {
  const logo = safeUrl(brand.logoUrl);
  return [
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(input.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:#F4EFEC">`,
    input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(input.preheader)}</div>` : "",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EFEC"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px;border-collapse:separate;font-family:${FONT};color:${INK}">`,
    `<tr><td style="padding:18px 32px;border-bottom:1px solid #F0E8E4"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`,
    `<td>${logo ? `<img src="${e(logo)}" alt="" width="24" style="vertical-align:middle;border:0;margin-right:10px">` : ""}<span style="font-size:12px;font-weight:700;letter-spacing:0.16em;vertical-align:middle">${e(brand.orgName.toUpperCase())}</span></td>`,
    input.headerNote ? `<td align="right" style="font-size:12px;color:${MUTED}">${e(input.headerNote)}</td>` : "",
    `</tr></table></td></tr>`,
    ...input.rows,
    input.footer.length
      ? `<tr><td style="padding:18px 32px 22px;background:${SOFT};border-radius:0 0 12px 12px;font-size:11px;line-height:1.6;color:${MUTED}">${input.footer.map((l) => e(l)).join("<br>")}</td></tr>`
      : "",
    `</table></td></tr></table></body></html>`,
  ].join("");
}

export function renderEmailHtml(doc: EmailDoc, brand: EmailBrand): string {
  const accent = brandAccent(brand);
  const sig = doc.signature;
  const wa = whatsappLink(sig.whatsapp);
  const site = safeUrl(sig.website);
  const initials = sig.name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const rows = [
    row(`<p style="margin:0;font-size:16px;line-height:1.6;color:${INK}">${e(doc.greeting)}</p>`, "28px 32px 14px"),
    ...doc.blocks.map((b) => htmlBlock(b, accent)),
    // 签名
    `<tr><td style="padding:8px 32px 24px"><table role="presentation" cellpadding="0" cellspacing="0" style="border-top:1px solid #F0E8E4;width:100%"><tr>`,
    `<td width="62" style="padding-top:20px"><div style="width:48px;height:48px;line-height:48px;text-align:center;border-radius:999px;background:${TINT};color:${TINT_INK};font-size:16px;font-weight:700">${e(initials)}</div></td>`,
    `<td style="padding-top:20px"><div style="font-size:15px;font-weight:700">${e(sig.name)}</div>`,
    `<div style="font-size:13px;color:${MUTED};padding-top:2px">${e([sig.title, sig.org].filter(Boolean).join(" · "))}</div>`,
    wa || site
      ? `<div style="font-size:13px;color:${MUTED};padding-top:2px">${[
          wa && sig.whatsapp ? `WhatsApp <a href="${e(wa)}" style="color:${accent}">${e(sig.whatsapp)}</a>` : null,
          site ? `<a href="${e(site)}" style="color:${accent}">${e(displayHost(site))}</a>` : null,
        ]
          .filter(Boolean)
          .join(" · ")}</div>`
      : "",
    `</td></tr></table></td></tr>`,
  ];
  return frame({ subject: doc.subject, preheader: doc.preheader, headerNote: doc.headerNote, footer: doc.footer, rows }, brand);
}

/**
 * 纯文本正文（官网询盘回复：模板 + 可选 AI 润色）套同一个外框：内容一字不改，按空行分段、行内换行保留，
 * 落款就是正文里的落款。
 */
export function renderPlainEmailHtml(input: { subject: string; body: string; footer?: string[] }, brand: EmailBrand): string {
  const paras = input.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const rows = paras.map((p, i) =>
    row(
      `<p style="margin:0;font-size:16px;line-height:1.6;color:${i === 0 ? INK : BODY}">${p
        .split("\n")
        .map((l) => e(l))
        .join("<br>")}</p>`,
      i === 0 ? "28px 32px 14px" : i === paras.length - 1 ? "0 32px 28px" : "0 32px 16px",
    ),
  );
  const preheader = (paras[1] ?? "").replace(/\s+/g, " ").slice(0, 140);
  return frame({ subject: input.subject, preheader, footer: input.footer ?? [], rows }, brand);
}
