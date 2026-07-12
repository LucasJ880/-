/**
 * 品牌记忆中枢 — 读取组织品牌档案并格式化为 prompt 注入文本
 *
 * 数据隔离：只按传入 orgId 精确查询，无平台级预设、无跨组织回退。
 * 未配置品牌档案时返回 null，调用方按「无品牌语料」降级，不阻塞业务。
 */

import type { BrandProfile } from "@prisma/client";
import { db } from "@/lib/db";

/** 进程内缓存（serverless 实例内有效），避免每次扇出都查库 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { text: string | null; expiresAt: number }>();

function section(label: string, value: string | null): string | null {
  const v = value?.trim();
  return v ? `${label}：\n${v}` : null;
}

/** 把品牌档案格式化为可直接拼入 system prompt 的文本 */
export function formatBrandContext(profile: BrandProfile): string {
  const parts = [
    `品牌名：${profile.brandName}${profile.tagline ? `（${profile.tagline.trim()}）` : ""}`,
    section("品牌定位", profile.positioning),
    section("核心卖点", profile.sellingPoints),
    section("目标客群", profile.targetAudience),
    section("语气与声音", profile.toneOfVoice),
    section("服务范围", profile.serviceScope),
    section("代表案例", profile.caseStudies),
    section("内容禁忌（禁止出现以下表述或承诺）", profile.forbiddenClaims),
  ].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * 读取组织的品牌上下文文本；未配置返回 null。
 * 结果按 org 缓存 5 分钟，档案更新走 invalidateBrandContext。
 */
export async function getBrandContext(orgId: string): Promise<string | null> {
  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.text;

  const profile = await db.brandProfile.findUnique({ where: { orgId } });
  const text = profile ? formatBrandContext(profile) : null;
  cache.set(orgId, { text, expiresAt: Date.now() + CACHE_TTL_MS });
  return text;
}

export function invalidateBrandContext(orgId: string): void {
  cache.delete(orgId);
}
