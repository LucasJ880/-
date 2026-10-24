/**
 * 款号参考表 — 组织级「款号 → 品类名」（OrgBusinessRule：trade.style_references，按版本发布）
 *
 * OEM 工厂展示的款号是做过、能做的参考款，不是有固定规格和价格的现货：表里只放通用品类名
 * （英文，会写进给买家的跟进邮件），用于让 RFQ 识别出产品类目、让草稿点名买家看过的参考款。
 * 尺寸、面料、克重、价格等一律按买家规格另行确认，不进这张表。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const RULE_KEY_STYLE_REFERENCES = "trade.style_references";

export interface StyleReference {
  code: string;
  name: string;
  /** 官网规格页（可选，进邮件的「View specification」） */
  specUrl?: string | null;
  /** 款式图片（可选，邮件里的参考款卡片；用 jpg/png，Outlook 不显示 webp） */
  imageUrl?: string | null;
}

/** 草稿 / 正文里引用的参考款；name 为空 = 款号不在参考表里 */
export interface ResolvedStyle {
  code: string;
  name: string | null;
  specUrl?: string | null;
  imageUrl?: string | null;
}

const CODE_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const MAX_REFS = 500;

export function normalizeStyleCode(v: string): string {
  return v.replace(/\s+/g, "").replace(/[–—_]/g, "-").toUpperCase();
}

const HTTPS_RE = /^https:\/\/[^\s"'<>]+$/i;

/**
 * 解析页面上粘贴的文本：一行一个「款号, 品类名[, 规格页链接[, 图片链接]]」（逗号、制表符或竖线分隔；表格直接复制也行）。
 * 链接可省；空行和 # 开头的行忽略；同一款号出现多次以最后一次为准。
 */
export function parseStyleReferenceText(text: string): { refs: StyleReference[]; errors: string[] } {
  const byCode = new Map<string, StyleReference>();
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const m = /^([^,，\t|]+)[,，\t|]+(.+)$/.exec(t);
    if (!m) {
      errors.push(`第 ${i + 1} 行：缺少品类名（格式：款号, 品类名）`);
      return;
    }
    const code = normalizeStyleCode(m[1]);
    // 品类名里可能有逗号；链接从第一个「, https://」起
    const [namePart, ...urls] = m[2].split(/\s*[,，\t|]\s*(?=https?:\/\/)/);
    const name = namePart.replace(/[,，\t|]+\s*$/, "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!CODE_RE.test(code)) {
      errors.push(`第 ${i + 1} 行：款号格式不对：${m[1].trim()}`);
      return;
    }
    if (!name) {
      errors.push(`第 ${i + 1} 行：缺少品类名`);
      return;
    }
    const cleanUrls = urls.map((u) => u.replace(/[,，\t|]+\s*$/, "").trim());
    const bad = cleanUrls.find((u) => !HTTPS_RE.test(u));
    if (bad) {
      errors.push(`第 ${i + 1} 行：链接要以 https:// 开头：${bad}`);
      return;
    }
    byCode.set(code, { code, name, ...(cleanUrls[0] ? { specUrl: cleanUrls[0] } : {}), ...(cleanUrls[1] ? { imageUrl: cleanUrls[1] } : {}) });
  });
  const refs = [...byCode.values()];
  if (refs.length > MAX_REFS) errors.push(`最多 ${MAX_REFS} 个款号`);
  return { refs: refs.slice(0, MAX_REFS), errors };
}

export function formatStyleReferenceText(refs: StyleReference[]): string {
  // 图片链接排在规格页之后，没有规格页时不写图片（否则读回来会当成规格页）
  return refs.map((r) => [r.code, r.name, r.specUrl, r.specUrl ? r.imageUrl : null].filter(Boolean).join(", ")).join("\n");
}

function fromConfig(config: unknown): StyleReference[] {
  const list = (config as { refs?: unknown } | null)?.refs;
  if (!Array.isArray(list)) return [];
  return list
    .filter((r): r is StyleReference => typeof r?.code === "string" && typeof r?.name === "string")
    .map((r) => ({
      code: normalizeStyleCode(r.code),
      name: r.name,
      ...(typeof r.specUrl === "string" && HTTPS_RE.test(r.specUrl) ? { specUrl: r.specUrl } : {}),
      ...(typeof r.imageUrl === "string" && HTTPS_RE.test(r.imageUrl) ? { imageUrl: r.imageUrl } : {}),
    }));
}

export async function loadStyleReferences(orgId: string): Promise<StyleReference[]> {
  const row = await db.orgBusinessRule.findFirst({
    where: { orgId, ruleKey: RULE_KEY_STYLE_REFERENCES, status: "active" },
    orderBy: { version: "desc" },
    select: { configJson: true },
  });
  return fromConfig(row?.configJson ?? null);
}

/** 发布新版本（旧 active → superseded），与 revenue_spine 规则同一口径 */
export async function saveStyleReferences(orgId: string, refs: StyleReference[], userId: string | null): Promise<{ version: number }> {
  return db.$transaction(async (tx) => {
    const latest = await tx.orgBusinessRule.findFirst({
      where: { orgId, ruleKey: RULE_KEY_STYLE_REFERENCES },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    await tx.orgBusinessRule.updateMany({
      where: { orgId, ruleKey: RULE_KEY_STYLE_REFERENCES, status: "active" },
      data: { status: "superseded" },
    });
    await tx.orgBusinessRule.create({
      data: {
        orgId,
        ruleKey: RULE_KEY_STYLE_REFERENCES,
        version,
        status: "active",
        configJson: { refs } as unknown as Prisma.InputJsonValue,
        createdById: userId,
        updatedById: userId,
      },
    });
    return { version };
  });
}

/** 卡上「感兴趣款号」（已归一，逗号分隔）→ 参考款列表，保持卡上顺序 */
export function resolveStyles(styles: string, refs: StyleReference[]): ResolvedStyle[] {
  const byCode = new Map(refs.map((r) => [r.code, r]));
  return styles
    .split(/\s*,\s*/)
    .map((c) => normalizeStyleCode(c))
    .filter(Boolean)
    .map((code) => {
      const r = byCode.get(code);
      return r ? { code, name: r.name, ...(r.specUrl ? { specUrl: r.specUrl } : {}), ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}) } : { code, name: null };
    });
}

/** 正文 / 草稿里的写法：「品类名 (ref. 款号)」，不在表里的只写款号 */
export function describeStyle(s: ResolvedStyle): string {
  return s.name ? `${s.name} (ref. ${s.code})` : s.code;
}
