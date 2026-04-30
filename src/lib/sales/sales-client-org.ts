/**
 * 销售模块客户端 — orgId 并入请求体与创建按钮禁用判断
 * 当前组织请使用：import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id"
 */

/** 将 orgId 并入 JSON body（须已由 useSalesCurrentOrgId 解析出非空 orgId） */
export function withSalesOrgId<T extends Record<string, unknown>>(
  orgId: string,
  body: T,
): T & { orgId: string } {
  return { ...body, orgId };
}

/** 创建类操作是否应禁用（多组织未选 / 无组织 / 加载中） */
export function isSalesOrgCreateBlocked(
  loading: boolean,
  ambiguous: boolean,
  orgId: string | null,
): boolean {
  return loading || ambiguous || !orgId;
}

/** 用于按钮 title / 提示文案 */
export function salesOrgCreateBlockedHint(
  loading: boolean,
  ambiguous: boolean,
  orgId: string | null,
): string | null {
  if (loading) return null;
  if (ambiguous) {
    return "您属于多个组织，请先在组织入口或外贸模块选择当前组织后再操作。";
  }
  if (!orgId) {
    return "无法确定当前组织，请刷新页面或通过组织设置加入组织。";
  }
  return null;
}
