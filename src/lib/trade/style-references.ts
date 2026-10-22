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
}

/** 草稿 / 正文里引用的参考款；name 为空 = 款号不在参考表里 */
export interface ResolvedStyle {
  code: string;
  name: string | null;
}

const CODE_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const MAX_REFS = 500;

export function normalizeStyleCode(v: string): string {
  return v.replace(/\s+/g, "").replace(/[–—_]/g, "-").toUpperCase();
}

/**
 * 解析页面上粘贴的文本：一行一个「款号, 品类名」（逗号、制表符或竖线分隔；表格直接复制也行）。
 * 空行和 # 开头的行忽略；同一款号出现多次以最后一次为准。
 */
export function parseStyleReferenceText(text: string): { refs: StyleReference[]; errors: string[] } {
  const byCode = new Map<string, string>();
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
    const name = m[2].replace(/\s+/g, " ").trim().slice(0, 120);
    if (!CODE_RE.test(code)) {
      errors.push(`第 ${i + 1} 行：款号格式不对：${m[1].trim()}`);
      return;
    }
    if (!name) {
      errors.push(`第 ${i + 1} 行：缺少品类名`);
      return;
    }
    byCode.set(code, name);
  });
  const refs = [...byCode].map(([code, name]) => ({ code, name }));
  if (refs.length > MAX_REFS) errors.push(`最多 ${MAX_REFS} 个款号`);
  return { refs: refs.slice(0, MAX_REFS), errors };
}

export function formatStyleReferenceText(refs: StyleReference[]): string {
  return refs.map((r) => `${r.code}, ${r.name}`).join("\n");
}

function fromConfig(config: unknown): StyleReference[] {
  const list = (config as { refs?: unknown } | null)?.refs;
  if (!Array.isArray(list)) return [];
  return list
    .filter((r): r is StyleReference => typeof r?.code === "string" && typeof r?.name === "string")
    .map((r) => ({ code: normalizeStyleCode(r.code), name: r.name }));
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
  const byCode = new Map(refs.map((r) => [r.code, r.name]));
  return styles
    .split(/\s*,\s*/)
    .map((c) => normalizeStyleCode(c))
    .filter(Boolean)
    .map((code) => ({ code, name: byCode.get(code) ?? null }));
}

/** 正文 / 草稿里的写法：「品类名 (ref. 款号)」，不在表里的只写款号 */
export function describeStyle(s: ResolvedStyle): string {
  return s.name ? `${s.name} (ref. ${s.code})` : s.code;
}
