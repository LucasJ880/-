/**
 * 展会速记卡 — 夜间录入解析（纯函数，无 DB）
 *
 * 展位上每位买家一张纸卡（名片订在左上角 + 勾选项），卡上预印唯一卡号（如 CF140-0001）。
 * 当晚把卡片照片交给 AI 按模板列名转成表格，人工核对后在 /trade/booth-cards 上传；
 * 每张卡作为一条询盘走与网站询盘相同的链路（客户 / 商机 / RFQ / 评分 / 回复草稿进审批）。
 *
 * 卡号就是事件身份（eventId = card:<卡号>）：同一张卡重复上传只会补齐，不会多出线索。
 * 写给 Revenue Spine 的正文一律用英文：回复草稿的语言按正文判定，中文标签会让外国买家
 * 收到中文草稿。业务员的中文备注保留原文（占比低，不改变判定）。卡号、等级等内部信息
 * 只进线索时间线（page 字段），不进 RFQ 抽取读的正文。
 */

import * as XLSX from "xlsx";
import { normalizeInquiry, type IngestOrigin, type NormalizeResult } from "./website-inquiry";
import { describeStyle, type ResolvedStyle } from "./style-references";

export interface BoothCard {
  /** 表格中的行号（表头为第 1 行） */
  row: number;
  cardNo: string;
  date: string;
  sales: string;
  company: string;
  contactName: string;
  title: string;
  email: string;
  whatsapp: string;
  country: string;
  buyerType: string;
  styles: string;
  specs: string;
  volume: string;
  timing: string;
  nextStep: string;
  grade: string;
  /** 英文备注（会写进给买家的邮件草稿） */
  note: string;
  /** 卡上手写备注原文（中文，给同事看，只进时间线） */
  noteOriginal: string;
  voiceNote: string;
}

type Field = Exclude<keyof BoothCard, "row">;

/** 模板列（顺序即模板顺序）；aliases 用于识别 AI / 人工改过的列名（比较时去空格、小写） */
export const BOOTH_CARD_COLUMNS: Array<{ field: Field; header: string; aliases: string[]; hint: string }> = [
  { field: "cardNo", header: "卡号", aliases: ["card no", "card number", "card", "no", "编号", "卡片编号"], hint: "必填，卡片右上角预印，如 CF140-0001" },
  { field: "date", header: "日期", aliases: ["date", "展会日期"], hint: "勾选的日期，如 10/31" },
  { field: "sales", header: "业务员", aliases: ["sales", "sales rep", "负责人", "签名"], hint: "" },
  { field: "company", header: "公司", aliases: ["company", "company name", "公司名称", "客户名称"], hint: "名片上的公司名" },
  { field: "contactName", header: "联系人", aliases: ["contact", "contact name", "name", "姓名", "联系人姓名"], hint: "名片上的人名" },
  { field: "title", header: "职位", aliases: ["title", "job title", "position", "职务"], hint: "" },
  { field: "email", header: "邮箱", aliases: ["email", "e-mail", "电子邮箱", "邮件"], hint: "邮箱和 WhatsApp 至少一项" },
  { field: "whatsapp", header: "WhatsApp", aliases: ["whatsapp/微信", "whatsapp / 微信", "phone", "电话", "手机", "微信", "wechat", "mobile"], hint: "含国家区号，如 +1 604 555 0100" },
  { field: "country", header: "国家", aliases: ["country", "region", "国家/地区", "地区"], hint: "" },
  { field: "buyerType", header: "买家类型", aliases: ["buyer type", "类型"], hint: "进口/批发、零售/自有品牌、酒店项目、电商/亚马逊、可持续项目、其他" },
  { field: "styles", header: "感兴趣款号", aliases: ["styles", "style", "款号", "products", "product", "兴趣款号"], hint: "多个用逗号分隔，如 MX-BL-001, MX-BR-001" },
  { field: "specs", header: "规格/认证", aliases: ["specs", "specs/certs", "规格", "认证", "规格 / 认证"], hint: "勾选的认证 + 手写规格" },
  { field: "volume", header: "采购规模", aliases: ["volume", "规模"], hint: "<1柜、1-5柜、>5柜" },
  { field: "timing", header: "时间", aliases: ["timing", "采购时间"], hint: "有具体项目、3个月内、先了解" },
  { field: "nextStep", header: "下一步", aliases: ["next step", "next"], hint: "报价、寄样、视频验厂、只发目录（可多选）" },
  { field: "grade", header: "等级", aliases: ["grade", "level", "线索等级"], hint: "A / B / C" },
  { field: "note", header: "备注", aliases: ["note", "notes", "remark", "remarks", "memo", "备注（英文）", "英文备注"], hint: "卡上手写备注，翻成简洁英文（会被引用进给买家的跟进邮件草稿）" },
  { field: "noteOriginal", header: "备注原文", aliases: ["原文备注", "中文备注", "备注（中文）", "original note", "note (original)"], hint: "卡上手写备注照原文抄（中文，给同事看，不进邮件）" },
  { field: "voiceNote", header: "语音备注", aliases: ["voice note", "voice", "语音"], hint: "语音备注的英文要点（没有就留空）" },
];

const CARD_NO_RE = /^[A-Z][A-Z0-9]{1,15}-\d{1,6}$/;

const LIMITS = { short: 120, long: 1000 } as const;

function headerKey(h: string): string {
  return h.replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")").toLowerCase();
}

const HEADER_INDEX: Map<string, Field> = (() => {
  const m = new Map<string, Field>();
  for (const c of BOOTH_CARD_COLUMNS) {
    m.set(headerKey(c.header), c.field);
    for (const a of c.aliases) m.set(headerKey(a), c.field);
  }
  return m;
})();

function cell(v: unknown, max: number): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeCardNo(v: string): string {
  return v.replace(/\s+/g, "").replace(/[–—_]/g, "-").toUpperCase();
}

/** 展会日期只记 月/日：Excel 把 10/31 存成日期后会带上年份（10/31/26、2026-10-31） */
export function normalizeDate(v: string): string {
  const us = /^(\d{1,2})[/.](\d{1,2})[/.]\d{2,4}$/.exec(v);
  if (us) return `${Number(us[1])}/${Number(us[2])}`;
  const iso = /^\d{4}-(\d{1,2})-(\d{1,2})/.exec(v);
  if (iso) return `${Number(iso[1])}/${Number(iso[2])}`;
  return v;
}

export function normalizeGrade(v: string): string {
  const t = v.replace(/\s+/g, "").toUpperCase().replace(/级$/, "");
  return /^[ABC]$/.test(t) ? t : v.trim();
}

/** 款号：统一大写、去重，逗号分隔（中文顿号 / 分号 / 换行都算分隔） */
export function normalizeStyles(v: string): string {
  const parts = v
    .split(/[,，、;；\n/]+/)
    .map((x) => x.trim().toUpperCase().replace(/\s+/g, ""))
    .filter(Boolean);
  return [...new Set(parts)].join(", ");
}

const EMPTY_CARD: Omit<BoothCard, "row"> = {
  cardNo: "", date: "", sales: "", company: "", contactName: "", title: "", email: "", whatsapp: "",
  country: "", buyerType: "", styles: "", specs: "", volume: "", timing: "", nextStep: "", grade: "", note: "", noteOriginal: "",
  voiceNote: "",
};

const LONG_FIELDS = new Set<Field>(["note", "noteOriginal", "voiceNote", "specs"]);

/** 任意来源（表格行 / 录入接口 JSON）→ 清洗、归一后的卡片；不信任调用方已处理 */
export function boothCardFromInput(raw: Partial<Record<Field, unknown>>, row: number): BoothCard {
  const card: BoothCard = { row, ...EMPTY_CARD };
  for (const f of Object.keys(EMPTY_CARD) as Field[]) {
    card[f] = cell(raw[f], LONG_FIELDS.has(f) ? LIMITS.long : LIMITS.short);
  }
  card.cardNo = normalizeCardNo(card.cardNo);
  card.date = normalizeDate(card.date);
  card.email = card.email.toLowerCase();
  card.grade = card.grade ? normalizeGrade(card.grade) : "";
  card.styles = normalizeStyles(card.styles);
  return card;
}

export interface ParsedBoothSheet {
  cards: Array<{ card: BoothCard; errors: string[] }>;
  /** 必需但缺失的列（目前只有卡号） */
  missingColumns: string[];
  /** 没认出来的列名（提示用，不报错） */
  unknownColumns: string[];
}

function rowsFromWorkbook(wb: XLSX.WorkBook): Record<string, unknown>[] {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "", raw: false });
}

/** 解析上传的 xlsx（ArrayBuffer）或 csv（string）；逐行校验，错误不中断其它行 */
export function parseBoothCardSheet(input: ArrayBuffer | string): ParsedBoothSheet {
  // CSV 一律按文本读：不把 10/31 猜成日期、不把 +9715… 猜成数字
  const wb = typeof input === "string" ? XLSX.read(input, { type: "string", raw: true }) : XLSX.read(input, { type: "array" });
  const rows = rowsFromWorkbook(wb);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const mapping = new Map<string, Field>();
  const unknownColumns: string[] = [];
  for (const h of headers) {
    const f = HEADER_INDEX.get(headerKey(h));
    if (f && ![...mapping.values()].includes(f)) mapping.set(h, f);
    else if (!f && !/^__EMPTY/.test(h)) unknownColumns.push(h);
  }
  const missingColumns = [...mapping.values()].includes("cardNo") ? [] : ["卡号"];
  if (missingColumns.length) return { cards: [], missingColumns, unknownColumns };

  const seen = new Map<string, number>();
  const cards: ParsedBoothSheet["cards"] = [];
  rows.forEach((raw, i) => {
    const values: Partial<Record<Field, unknown>> = {};
    for (const [h, f] of mapping) values[f] = raw[h];
    const card = boothCardFromInput(values, i + 2);
    // 整行空白（表格末尾的空行）直接跳过
    if (Object.entries(card).every(([k, v]) => k === "row" || v === "")) return;

    const errors = validateBoothCard(card);
    if (card.cardNo) {
      const first = seen.get(card.cardNo);
      if (first !== undefined) errors.push(`卡号与第 ${first} 行重复`);
      else seen.set(card.cardNo, card.row);
    }
    cards.push({ card, errors });
  });
  return { cards, missingColumns, unknownColumns };
}

/** 单张卡的校验（解析和录入接口都用；录入接口不信任前端已校验） */
export function validateBoothCard(card: BoothCard): string[] {
  const errors: string[] = [];
  if (!card.cardNo) errors.push("缺卡号");
  else if (!CARD_NO_RE.test(card.cardNo)) errors.push(`卡号格式不对：${card.cardNo}（应如 CF140-0001）`);
  else if (/-0+$/.test(card.cardNo)) errors.push("这是模板的示例行（卡号 0000），请删除");
  if (!card.email && !card.whatsapp) errors.push("邮箱和 WhatsApp 至少填一项");
  if (card.grade && !/^[ABC]$/.test(card.grade)) errors.push(`等级只能是 A / B / C：${card.grade}`);
  if (!card.company && !card.contactName) errors.push("公司和联系人至少填一项");
  const n = normalizeInquiry({ email: card.email, phone: card.whatsapp });
  if (!n.ok && card.email) errors.push(n.error);
  return errors;
}

/**
 * 勾选项的中文 → 英文。措辞刻意避开 RFQ 规则抽取会误判的写法：不带数字（"3 个月" 会被当成
 * 交期和数量）、不用 label / packaging 等包装定制关键词（"Private label" 会被当成定制要求）。
 */
const BUYER_TYPE_EN: Array<[RegExp, string]> = [
  [/进口|批发|import|wholesal/i, "importer / wholesaler"],
  [/零售|自有品牌|retail|private/i, "retailer (own brand)"],
  [/酒店|hotel|hospitality/i, "hotel project"],
  [/电商|亚马逊|amazon|e-?commerce/i, "e-commerce / Amazon seller"],
  [/可持续|sustainab/i, "sustainable sourcing program"],
  [/^其他$|^other$/i, "other"],
];
const VOLUME_EN: Array<[RegExp, string]> = [
  [/[<＜]\s*1\s*柜|小于\s*1\s*柜|under\s*1/i, "under one container"],
  [/1\s*[-–~到]\s*5\s*柜|1\s*[-–~]\s*5\s*(fcl|container)/i, "one to five containers"],
  [/[>＞]\s*5\s*柜|5\s*柜以上|over\s*5|more than\s*5/i, "over five containers"],
];
const TIMING_EN: Array<[RegExp, string]> = [
  [/具体项目|live project/i, "has a live project"],
  [/3\s*个月|three months|3\s*months/i, "plans to buy within three months"],
  [/先了解|exploring/i, "exploring for now"],
];
const NEXT_STEP_EN: Array<[RegExp, string]> = [
  [/报价|quot/i, "quotation"],
  [/寄样|sample/i, "samples"],
  [/验厂|audit/i, "video factory audit"],
  [/目录|catalog/i, "catalog only"],
];

/** 按字段的选项表翻译；多选去重；没认出的值原样保留 */
export function toEnglishOptions(v: string, table: Array<[RegExp, string]>): string {
  if (!v) return "";
  const out = v
    .split(/[,，、;；/]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => table.find(([re]) => re.test(x))?.[1] ?? x);
  return [...new Set(out)].join(", ");
}

function plain(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return /[.!?。！？]$/.test(v) ? v : `${v}.`;
}

function sentence(label: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return `${label}: ${v}${/[.!?。！？]$/.test(v) ? "" : "."}`;
}

/**
 * 交给 Revenue Spine 的正文（RFQ 抽取 / 评分 / 起草都读它）：只写买家相关的事实，一句一个，
 * 不含卡号、日期、业务员、等级、展会名这些内部信息（它们里的数字会被当成数量）。
 */
export function buildBoothCardMessage(card: BoothCard, styles: ResolvedStyle[] = []): string {
  // 款号是参考款（做过、能做的款式），按参考表写成「品类名 (ref. 款号)」，让 RFQ 能识别类目
  const interested = styles.length ? styles.map(describeStyle).join("; ") : card.styles;
  return [
    "Met at our trade show booth.",
    sentence("Buyer type", toEnglishOptions(card.buyerType, BUYER_TYPE_EN)),
    sentence(styles.length ? "Interested in reference styles" : "Interested in", interested),
    sentence("Requirements", card.specs),
    sentence("Volume", toEnglishOptions(card.volume, VOLUME_EN)),
    sentence("Timing", toEnglishOptions(card.timing, TIMING_EN)),
    sentence("Agreed next step", toEnglishOptions(card.nextStep, NEXT_STEP_EN)),
    // 备注 / 语音备注是业务员记下的买家需求：原句写入，不加标签（被引用进草稿时不带 "Notes:"）
    plain(card.note),
    plain(card.voiceNote),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 只进线索时间线的内部信息（「展会」一行，给看中文的同事）：展会、卡号、日期、业务员、卡上等级、职位，
 * 以及卡上勾选项和备注的中文原文。英文正文只给 AI 分析和起草用。
 */
export function buildBoothCardContext(card: BoothCard, event: string): string {
  return [
    event || "展会",
    `卡号 ${card.cardNo}`,
    card.date,
    card.sales && `业务员 ${card.sales}`,
    card.grade && `等级 ${card.grade}`,
    card.title && `职位 ${card.title}`,
    card.buyerType && `买家类型 ${card.buyerType}`,
    card.volume && `规模 ${card.volume}`,
    card.timing && `时间 ${card.timing}`,
    card.nextStep && `下一步 ${card.nextStep}`,
    card.specs && `规格认证 ${card.specs}`,
    card.noteOriginal && `备注原文 ${card.noteOriginal}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

const CONTEXT_LABELS = {
  卡号: "cardNo",
  业务员: "sales",
  等级: "grade",
  职位: "title",
  买家类型: "buyerType",
  规模: "volume",
  时间: "timing",
  下一步: "nextStep",
  规格认证: "specs",
  备注原文: "noteOriginal",
} as const;

export type BoothContextFields = Partial<Record<(typeof CONTEXT_LABELS)[keyof typeof CONTEXT_LABELS], string>>;

/** 读回 buildBoothCardContext 写的「展会」一行（展会小结用） */
export function parseBoothCardContext(page: string): BoothContextFields {
  const out: BoothContextFields = {};
  // 备注原文是最后一项、可能自带「 · 」：整段取到行尾
  const noteAt = page.indexOf(" · 备注原文 ");
  if (noteAt >= 0) {
    out.noteOriginal = page.slice(noteAt + " · 备注原文 ".length).trim();
    page = page.slice(0, noteAt);
  }
  for (const part of page.split(" · ")) {
    const m = /^(\S+) ([\s\S]+)$/.exec(part);
    const key = m ? CONTEXT_LABELS[m[1] as keyof typeof CONTEXT_LABELS] : undefined;
    if (key && m) out[key] = m[2].trim();
  }
  return out;
}

/** 卡片 → 归一化询盘（与网站表单同一校验）；事件身份 = card:<卡号> */
export function boothCardToInquiry(card: BoothCard, event: string, styles: ResolvedStyle[] = []): NormalizeResult {
  return normalizeInquiry({
    name: card.contactName,
    email: card.email,
    phone: card.whatsapp,
    company: card.company,
    country: card.country,
    product: card.styles,
    message: buildBoothCardMessage(card, styles),
    page: buildBoothCardContext(card, event),
    utm_source: "booth",
    utm_medium: "card",
    utm_campaign: event,
    utm_content: card.cardNo,
    eventId: `card:${card.cardNo}`,
  });
}

/** 录入来源：展会名、参考款、卡上等级、接待业务员（落款） */
export function boothCardOrigin(card: BoothCard, event: string, styles: ResolvedStyle[] = []): IngestOrigin {
  return { kind: "trade_show", event: event || null, styles, grade: card.grade || null, sales: card.sales || null };
}

/** 下载用的空白模板：表头 + 一行示例 + 「说明」页 */
export function buildBoothCardTemplate(): Buffer {
  const header = BOOTH_CARD_COLUMNS.map((c) => c.header);
  const example: Record<Field, string> = {
    cardNo: "CF140-0000",
    date: "10/31",
    sales: "Cathy",
    company: "Maple Home Goods Ltd.",
    contactName: "Emma Brown",
    title: "Purchasing Manager",
    email: "emma@maplehome.example",
    whatsapp: "+1 604 555 0100",
    country: "Canada",
    buyerType: "零售/自有品牌",
    styles: "MX-BL-001, MX-BR-001",
    specs: "OEKO-TEX; 280gsm, 127x152cm",
    volume: "1-5柜",
    timing: "3个月内",
    nextStep: "报价, 寄样",
    grade: "A",
    note: "Wants own-brand gift packaging for the Christmas season",
    noteOriginal: "要自有品牌礼盒包装，圣诞季",
    voiceNote: "",
  };
  const sheet = XLSX.utils.aoa_to_sheet([header, BOOTH_CARD_COLUMNS.map((c) => example[c.field])]);
  sheet["!cols"] = BOOTH_CARD_COLUMNS.map((c) => ({ wch: Math.max(10, c.header.length * 2 + 4) }));
  const guide = XLSX.utils.aoa_to_sheet([
    ["列名", "填写说明"],
    ...BOOTH_CARD_COLUMNS.map((c) => [c.header, c.hint]),
    [],
    ["", "第 2 行是示例（卡号 0000，不会被录入），上传前删掉。每张卡一行，卡号不能重复；同一张卡重复上传不会多出线索。"],
  ]);
  guide["!cols"] = [{ wch: 14 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "速记卡");
  XLSX.utils.book_append_sheet(wb, guide, "说明");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
