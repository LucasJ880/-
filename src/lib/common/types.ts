// ============================================================
// 全局通用类型定义
// ============================================================

/** 分页请求参数 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

/** 分页响应包装 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 统一 API 成功响应 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

/** 统一 API 错误响应 */
export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, string[]>;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/** 排序参数 */
export interface SortParams {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/** 多租户查询上下文：所有业务查询都应携带 */
export interface TenantScope {
  orgId: string;
  projectId?: string;
  environmentId?: string;
}

/** 时间范围过滤 */
export interface DateRangeFilter {
  from?: Date | string;
  to?: Date | string;
}
