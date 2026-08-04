import { ScopeResolutionError } from "./errors";
import type { ScopeContext } from "./types";

/** Memory / 文件访问：必须与当前 scope.orgId 一致 */
export function assertSameOrg(
  scope: ScopeContext,
  resourceOrgId: string | null | undefined,
  label = "resource",
): void {
  if (!resourceOrgId || resourceOrgId !== scope.orgId) {
    throw new ScopeResolutionError(
      "cross_scope_denied",
      `${label} 跨组织访问被拒绝`,
      403,
    );
  }
}

/** PROJECT scope 下资源必须属于同一项目 */
export function assertSameProject(
  scope: ScopeContext,
  resourceProjectId: string | null | undefined,
  label = "resource",
): void {
  if (scope.scopeType !== "PROJECT" && !scope.projectId) return;
  const expected = scope.projectId;
  if (!expected) return;
  if (!resourceProjectId || resourceProjectId !== expected) {
    throw new ScopeResolutionError(
      "project_org_mismatch",
      `${label} 跨项目访问被拒绝`,
      403,
    );
  }
}

/** Tool 不得用参数覆盖 ScopeContext 中的租户字段 */
export function assertToolArgsDoNotOverrideScope(
  scope: ScopeContext,
  args: Record<string, unknown>,
): void {
  const argOrg = typeof args.orgId === "string" ? args.orgId.trim() : "";
  if (argOrg && argOrg !== scope.orgId) {
    throw new ScopeResolutionError(
      "untrusted_claim_rejected",
      "工具参数不得覆盖 ScopeContext.orgId",
      403,
    );
  }
  const argProject =
    typeof args.projectId === "string" ? args.projectId.trim() : "";
  if (
    argProject &&
    scope.projectId &&
    argProject !== scope.projectId
  ) {
    throw new ScopeResolutionError(
      "untrusted_claim_rejected",
      "工具参数不得覆盖 ScopeContext.projectId",
      403,
    );
  }
}
