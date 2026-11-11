/**
 * VIS-1e 按请求取预览（spec authorization/position-preview，design D4 / D5）。
 *
 * - `getRequestPreview(request, userId)`：路由处理函数用，读 `request.cookies`。
 * - `getAmbientPreview(userId)`：没有 request 的库函数用。先看本模块 AsyncLocalStorage 里显式注入的 token
 *   （`withPreviewToken` / `withoutPreview`：代理、登录与测试用），没有再读 `next/headers` 的 `cookies()`；
 *   `cookies()` 抛错先 `unstable_rethrow`（放过 Next 内部控制流错误），其余按无预览。
 * - 两者都做两层校验：无库（签名、aud、过期、属于该用户，见 token.ts）与有库（本人仍是 super_admin、仍是该企业
 *   active 成员、企业仍是岗位模式且 active、岗位都是该企业 active 的人类岗位）。结果按「token + userId」缓存 30 秒。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hasPositionTemplates } from "@/lib/authorization/role-defaults";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { verifySession } from "@/lib/auth/session";
import { PREVIEW_COOKIE, verifyPreviewToken, type PreviewClaims } from "./token";
import {
  PREVIEW_ORG_ROLE,
  PREVIEW_PLATFORM_ROLE,
  activePreviewFor,
  previewFingerprint,
  type ActivePreview,
  type InvalidPreview,
  type InvalidReason,
  type PreviewBinding,
  type PreviewState,
} from "./identity";

type Scope = { token: string | null };
const scope = new AsyncLocalStorage<Scope>();

/** 在显式给定的预览 token 下执行（代理、测试）；token 为空即无预览 */
export function withPreviewToken<T>(token: string | null | undefined, fn: () => T): T {
  return scope.run({ token: token ?? null }, fn);
}

/** 当前显式注入的预览 token：不在注入范围内为 undefined（测试用的假加载器据此判断） */
export function injectedPreviewToken(): string | null | undefined {
  const injected = scope.getStore();
  return injected ? injected.token : undefined;
}

/** 在「无预览」下执行（登录、退出等不应带预览身份的流程） */
export function withoutPreview<T>(fn: () => T): T {
  return scope.run({ token: null }, fn);
}

const SESSION_COOKIE = "qy_session";
const sessionSubCache = new Map<string, { at: number; sub: Promise<string | null> }>();

/** 会话 cookie 的用户（按 token 缓存 30 秒）：预览只对当前会话用户生效（spec「横幅与失效」最后一句） */
async function sessionSubOf(sessionToken: string | null | undefined): Promise<string | null> {
  if (!sessionToken) return null;
  const now = Date.now();
  const hit = sessionSubCache.get(sessionToken);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.sub;
  const sub = verifySession(sessionToken).then((p) => p?.sub ?? null);
  sessionSubCache.set(sessionToken, { at: now, sub });
  if (sessionSubCache.size > CACHE_MAX) {
    const oldest = sessionSubCache.keys().next().value;
    if (oldest !== undefined) sessionSubCache.delete(oldest);
  }
  return sub;
}

/** 当前请求里属于 userId 本人会话的预览 token；显式注入优先（代理已核对会话，测试直接给定） */
async function ambientTokenFor(userId: string): Promise<string | null> {
  const injected = scope.getStore();
  if (injected) return injected.token;
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const token = jar.get(PREVIEW_COOKIE)?.value ?? null;
    if (!token) return null;
    return (await sessionSubOf(jar.get(SESSION_COOKIE)?.value)) === userId ? token : null;
  } catch (err) {
    const { unstable_rethrow } = await import("next/navigation");
    unstable_rethrow(err);
    return null;
  }
}

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: Promise<PreviewState | null> }>();

/** 仅测试用：改库后清掉预览校验缓存 */
export function __resetPreviewCacheForTests(): void {
  cache.clear();
  sessionSubCache.clear();
}

async function validate(claims: PreviewClaims): Promise<PreviewState> {
  const [user, org, member, profiles] = await Promise.all([
    db.user.findUnique({ where: { id: claims.sub }, select: { role: true, status: true } }),
    db.organization.findUnique({ where: { id: claims.orgId }, select: { name: true, status: true, industryPackId: true } }),
    db.organizationMember.findUnique({
      where: { orgId_userId: { orgId: claims.orgId, userId: claims.sub } },
      select: { status: true },
    }),
    db.roleProfile.findMany({
      where: { orgId: claims.orgId, key: { in: claims.keys } },
      include: { permissions: true },
    }),
  ]);
  const byKey = new Map(profiles.map((p) => [p.key, p]));
  const positions = claims.keys.map((key) => ({ key, name: byKey.get(key)?.name ?? key }));
  const expiresAt = new Date(claims.exp * 1000);
  const invalid = (reason: InvalidReason): InvalidPreview => ({
    state: "invalid",
    userId: claims.sub,
    orgId: claims.orgId,
    orgName: org?.name ?? null,
    positions,
    expiresAt,
    reason,
  });
  if (!user || user.status !== "active" || !isSuperAdmin(user.role ?? "")) return invalid("not_super_admin");
  if (!org || org.status !== "active") return invalid("org_unavailable");
  if (member?.status !== "active") return invalid("not_member");
  if (!hasPositionTemplates(org.industryPackId)) return invalid("not_position_mode");
  const usable = claims.keys.every((k) => {
    const p = byKey.get(k);
    return !!p && p.status === "active" && p.principalType === "HUMAN";
  });
  if (!usable) return invalid("position_inactive");

  const bindings: PreviewBinding[] = [];
  for (const key of claims.keys) {
    const profile = byKey.get(key)!;
    for (const perm of profile.permissions) {
      bindings.push({
        permissionKey: perm.permissionKey,
        dataScope: perm.dataScope,
        effect: perm.effect === "DENY" ? "DENY" : "ALLOW",
        source: `preview:${profile.key}:${perm.id}`,
      });
    }
  }
  const active: ActivePreview = {
    state: "active",
    userId: claims.sub,
    orgId: claims.orgId,
    orgName: org.name,
    positions,
    expiresAt,
    bindings,
    fingerprint: previewFingerprint(claims),
  };
  return active;
}

/** 给定 token 的预览状态（签名不过 / 不属于该用户为 null；签名过、库校验不过为 invalid） */
export async function resolvePreviewToken(token: string | null | undefined, userId: string | null | undefined): Promise<PreviewState | null> {
  if (!token || !userId) return null;
  const key = `${userId}|${token}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const value = (async () => {
    const claims = await verifyPreviewToken(token, userId);
    return claims ? validate(claims) : null;
  })();
  cache.set(key, { at: now, value });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  value.catch(() => cache.delete(key));
  return value;
}

/** 请求里属于 userId 本人会话的预览 token；显式注入（withPreviewToken / withoutPreview）优先 */
async function previewTokenFromRequest(request: Pick<NextRequest, "cookies">, userId: string): Promise<string | null> {
  const injected = scope.getStore();
  if (injected) return injected.token;
  const token = request.cookies.get(PREVIEW_COOKIE)?.value ?? null;
  if (!token) return null;
  return (await sessionSubOf(request.cookies.get(SESSION_COOKIE)?.value)) === userId ? token : null;
}

/** 路由处理函数用：按请求 cookie 取该用户的预览状态 */
export async function getRequestPreview(request: Pick<NextRequest, "cookies">, userId: string | null | undefined): Promise<PreviewState | null> {
  if (!userId) return null;
  return resolvePreviewToken(await previewTokenFromRequest(request, userId), userId);
}

/** 库函数用：按当前请求（或显式注入）取该用户的预览状态 */
/**
 * 不经会话鉴权的公开路由用（如客户分享链接）：请求带着属于当前会话用户、签名有效的预览 cookie（含已失效）即为只读。
 */
export async function isRequestPreviewReadonly(request: Pick<NextRequest, "cookies">): Promise<boolean> {
  const sub = await sessionSubOf(request.cookies.get(SESSION_COOKIE)?.value);
  return !!sub && (await getRequestPreview(request, sub)) !== null;
}

export async function getAmbientPreview(userId: string | null | undefined): Promise<PreviewState | null> {
  if (!userId) return null;
  return resolvePreviewToken(await ambientTokenFor(userId), userId);
}

/**
 * 预览中（active 或已失效、尚未退出）：写一律不做（与代理拒写同口径，spec「写拒绝只看签名」）。
 * 给 GET 里的懒初始化、缓存写、当前企业回写等用。
 */
export async function isPreviewReadonly(userId: string | null | undefined): Promise<boolean> {
  return (await getAmbientPreview(userId)) !== null;
}

/** 本人有效的 active 成员关系：预览中只有预览企业（org_member），否则读库 */
export async function listEffectiveMemberships(userId: string): Promise<Array<{ orgId: string; role: string }>> {
  const preview = await getActivePreview(userId);
  if (preview) return [{ orgId: preview.orgId, role: PREVIEW_ORG_ROLE }];
  return db.organizationMember.findMany({ where: { userId, status: "active" }, select: { orgId: true, role: true } });
}

/** 本人有效的平台角色：预览中为 user */
export async function effectivePlatformRole(userId: string, dbRole: string | null | undefined): Promise<string> {
  return (await getActivePreview(userId)) ? PREVIEW_PLATFORM_ROLE : (dbRole ?? "user");
}

/** 库函数用：只要 active 的预览（读取改写身份时用） */
export async function getActivePreview(userId: string | null | undefined): Promise<ActivePreview | null> {
  return activePreviewFor(await getAmbientPreview(userId), userId);
}

/** 路由处理函数用：只要 active 的预览 */
export async function getActiveRequestPreview(
  request: Pick<NextRequest, "cookies">,
  userId: string | null | undefined,
): Promise<ActivePreview | null> {
  return activePreviewFor(await getRequestPreview(request, userId), userId);
}
