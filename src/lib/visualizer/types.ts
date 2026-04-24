/**
 * Visualizer 前后端共享 TS 类型
 *
 * - 所有 API 响应必须通过这里的类型约束
 * - 前端组件从这里导入，避免字段漂移
 * - 新增字段时：DB schema 改动 + 这里同步 + API 路由序列化
 */

export type VisualizerSessionStatus = "draft" | "active" | "archived";

/** 列表摘要（客户 tab / 机会入口卡片用） */
export interface VisualizerSessionSummary {
  id: string;
  title: string;
  status: VisualizerSessionStatus;
  customerId: string;
  customerName: string;
  opportunityId: string | null;
  opportunityTitle: string | null;
  quoteId: string | null;
  createdById: string;
  salesOwnerId: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    sourceImages: number;
    variants: number;
  };
}

/** 会话详情（session 编辑页用） */
export interface VisualizerSessionDetail extends VisualizerSessionSummary {
  measurementRecordId: string | null;
  shareToken: string | null;
  shareExpiresAt: string | null;
  customer: { id: string; name: string };
  opportunity: { id: string; title: string; stage: string } | null;
  quote: { id: string; version: number; status: string } | null;
  sourceImages: VisualizerSourceImageSummary[];
  variants: VisualizerVariantSummary[];
}

export interface VisualizerSourceImageSummary {
  id: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  roomLabel: string | null;
  createdAt: string;
  regionCount: number;
  regions: VisualizerWindowRegionDetail[];
}

export type VisualizerRegionShape = "rect" | "polygon";

export interface VisualizerWindowRegionDetail {
  id: string;
  sourceImageId: string;
  measurementWindowId: string | null;
  label: string | null;
  shape: VisualizerRegionShape;
  /** 原图像素坐标：rect = [[x1,y1],[x2,y2]]；polygon = [[x,y], ...] */
  points: Array<[number, number]>;
  widthIn: number | null;
  heightIn: number | null;
  createdAt: string;
}

export interface VisualizerProductOptionTransform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface VisualizerProductOptionDetail {
  id: string;
  variantId: string;
  regionId: string;
  productCatalogId: string;
  productName: string;
  productCategory: string;
  color: string | null;
  colorHex: string | null;
  opacity: number;
  mountingType: string | null;
  transform: VisualizerProductOptionTransform | null;
  notes: string | null;
  createdAt: string;
}

export interface VisualizerVariantSummary {
  id: string;
  name: string;
  notes: string | null;
  exportImageUrl: string | null;
  sortOrder: number;
  productOptionCount: number;
  hasSalesSelection: boolean;
  hasCustomerSelection: boolean;
  createdAt: string;
  updatedAt: string;
  productOptions: VisualizerProductOptionDetail[];
}

/** POST /api/visualizer/images/[imageId]/regions */
export interface CreateRegionRequest {
  shape: VisualizerRegionShape;
  points: Array<[number, number]>;
  label?: string | null;
  widthIn?: number | null;
  heightIn?: number | null;
  measurementWindowId?: string | null;
}

/** PATCH /api/visualizer/regions/[regionId] */
export interface UpdateRegionRequest {
  shape?: VisualizerRegionShape;
  points?: Array<[number, number]>;
  label?: string | null;
  widthIn?: number | null;
  heightIn?: number | null;
  measurementWindowId?: string | null;
}

/** POST /api/visualizer/sessions/[id]/variants */
export interface CreateVariantRequest {
  name?: string;
  notes?: string | null;
}

/** PATCH /api/visualizer/variants/[variantId] */
export interface UpdateVariantRequest {
  name?: string;
  notes?: string | null;
  sortOrder?: number;
  exportImageUrl?: string | null;
}

/** POST /api/visualizer/variants/[variantId]/product-options */
export interface CreateProductOptionRequest {
  regionId: string;
  productCatalogId: string;
  color?: string | null;
  colorHex?: string | null;
  opacity?: number;
  mountingType?: string | null;
  transform?: VisualizerProductOptionTransform | null;
  notes?: string | null;
}

/** PATCH /api/visualizer/product-options/[id] */
export interface UpdateProductOptionRequest {
  color?: string | null;
  colorHex?: string | null;
  opacity?: number;
  mountingType?: string | null;
  transform?: VisualizerProductOptionTransform | null;
  notes?: string | null;
  productCatalogId?: string;
}

/** POST /api/visualizer/sessions 请求体 */
export interface CreateVisualizerSessionRequest {
  customerId: string;
  title?: string;
  opportunityId?: string | null;
  quoteId?: string | null;
  measurementRecordId?: string | null;
}

/** PATCH /api/visualizer/sessions/[id] 请求体 */
export interface UpdateVisualizerSessionRequest {
  title?: string;
  status?: VisualizerSessionStatus;
  salesOwnerId?: string | null;
  opportunityId?: string | null;
  quoteId?: string | null;
  measurementRecordId?: string | null;
}

/** 状态中文标签 */
export const VISUALIZER_SESSION_STATUS_LABEL: Record<VisualizerSessionStatus, string> = {
  draft: "草稿",
  active: "进行中",
  archived: "已归档",
};
