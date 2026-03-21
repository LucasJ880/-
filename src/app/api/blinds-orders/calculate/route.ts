import { NextRequest, NextResponse } from "next/server";
import { calculateItem, type ItemInput } from "@/lib/blinds/calculation-engine";
import { RULE_VERSION } from "@/lib/blinds/deduction-rules";

/**
 * 即时计算接口 — 不入库，仅返回计算结果
 * 前端编辑时调用，用于实时预览裁切尺寸
 */
export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.items || !Array.isArray(body.items)) {
    return NextResponse.json(
      { error: "请提供 items 数组" },
      { status: 400 }
    );
  }

  const results = (body.items as Record<string, unknown>[]).map(
    (item: Record<string, unknown>) => {
      const input: ItemInput = {
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
        productType: String(item.productType || "斑马帘"),
        measureType: String(item.measureType || "IN"),
        controlType: String(item.controlType || "普通"),
        headrailType: String(item.headrailType || "亮白插片圆盒"),
        fabricRatio: item.fabricRatio != null ? Number(item.fabricRatio) : null,
        silkRatio: item.silkRatio != null ? Number(item.silkRatio) : null,
        bottomBarWidth:
          item.bottomBarWidth != null ? Number(item.bottomBarWidth) : null,
      };

      if (input.width <= 0 || input.height <= 0) {
        return { error: "宽度和高度必须大于0", input };
      }

      return calculateItem(input);
    }
  );

  return NextResponse.json({ ruleVersion: RULE_VERSION, results });
}
