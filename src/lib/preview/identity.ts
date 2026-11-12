/**
 * VIS-1e 预览身份与拒写判定（spec authorization/position-preview，design D1 / D6）。纯模块：不导入数据库与 next/*。
 *
 * 预览身份：平台角色 `user`；预览企业的 active 成员，成员角色 `org_member`，不是企业所有者；有效权限 = 所选岗位在
 * 预览企业的权限行；岗位模式；其他企业非成员。userId 仍是本人。
 */

export const PREVIEW_PLATFORM_ROLE = "user";
export const PREVIEW_ORG_ROLE = "org_member";
export const PREVIEW_READONLY_CODE = "PREVIEW_READONLY";
export const PREVIEW_READONLY_MESSAGE = "预览中为只读，不能修改数据。退出预览后再操作。";

export type PreviewBinding = {
  permissionKey: string;
  dataScope: string;
  effect: "ALLOW" | "DENY";
  source: string;
};

export type PreviewPosition = { key: string; name: string };

export type InvalidReason = "not_super_admin" | "org_unavailable" | "not_member" | "not_position_mode" | "position_inactive";

/** 签名有效、库校验通过 */
export type ActivePreview = {
  state: "active";
  userId: string;
  orgId: string;
  orgName: string;
  positions: PreviewPosition[];
  expiresAt: Date;
  bindings: PreviewBinding[];
  /** 区分预览与非预览、不同预览的缓存指纹 */
  fingerprint: string;
};

/** 签名有效、库校验不过：读取恢复本人身份，写照旧被拒，横幅显示「已失效」 */
export type InvalidPreview = {
  state: "invalid";
  userId: string;
  orgId: string;
  orgName: string | null;
  positions: PreviewPosition[];
  expiresAt: Date;
  reason: InvalidReason;
};

export type PreviewState = ActivePreview | InvalidPreview;

export function previewFingerprint(claims: { orgId: string; keys: readonly string[]; exp: number }): string {
  return `pv:${claims.orgId}:${[...claims.keys].sort().join("+")}:${claims.exp}`;
}

/** 预览身份的 ALLOW 键（与 loadPermissionKeys 同口径：只取 ALLOW，去重） */
export function previewAllowKeys(preview: Pick<ActivePreview, "bindings">): string[] {
  return [...new Set(preview.bindings.filter((b) => b.effect === "ALLOW").map((b) => b.permissionKey))];
}

/** 只对本人、且状态为 active 的预览生效 */
export function activePreviewFor(state: PreviewState | null | undefined, userId: string | null | undefined): ActivePreview | null {
  return state && state.state === "active" && !!userId && state.userId === userId ? state : null;
}

/** 预览中的成员关系：预览企业为 org_member，其他企业非成员 */
export function previewMembershipFor(preview: ActivePreview, orgId: string | null | undefined): { role: string; status: "active" } | null {
  return orgId && orgId === preview.orgId ? { role: PREVIEW_ORG_ROLE, status: "active" } : null;
}

/** 当前用户接口里给横幅的预览信息（不含 token） */
export function previewBannerInfo(state: PreviewState): {
  state: "active" | "invalid";
  orgId: string;
  orgName: string | null;
  positions: PreviewPosition[];
  expiresAt: string;
} {
  return {
    state: state.state,
    orgId: state.orgId,
    orgName: state.orgName,
    positions: state.positions,
    expiresAt: state.expiresAt.toISOString(),
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** 预览中仍放行的写请求：退出预览、登出、登录 */
export function isPreviewWriteExempt(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  const p = pathname.replace(/\/+$/, "") || "/";
  return (m === "DELETE" && p === "/api/admin/preview") || (m === "POST" && (p === "/api/auth/logout" || p === "/api/auth/login"));
}

/** 代理拒写：非 GET / HEAD / OPTIONS、不是豁免请求、带签名有效的本人预览 cookie（design D6） */
export function shouldRefusePreviewWrite(input: { method: string; pathname: string; hasSignedPreview: boolean }): boolean {
  if (!input.hasSignedPreview) return false;
  if (SAFE_METHODS.has(input.method.toUpperCase())) return false;
  return !isPreviewWriteExempt(input.method, input.pathname);
}

export function previewReadonlyBody(): { error: string; code: string } {
  return { error: PREVIEW_READONLY_MESSAGE, code: PREVIEW_READONLY_CODE };
}
