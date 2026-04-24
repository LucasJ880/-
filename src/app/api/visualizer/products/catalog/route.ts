import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { VISUALIZER_MOCK_PRODUCTS } from "@/lib/visualizer/mock-products";

/**
 * GET /api/visualizer/products/catalog
 * MVP：返回静态 mock 目录。升级到真产品表后，仅此路由内部换实现。
 */
export const GET = withAuth(async () => {
  return NextResponse.json({ products: VISUALIZER_MOCK_PRODUCTS });
});
