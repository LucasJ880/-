import { NextResponse } from "next/server";

/**
 * POST /api/projects/[id]/inquiries/batch-followup —— 已下线（T-2，Evan 2026-11-07 拍板 ②）
 *
 * 原来每次调用都跑一次模型生成没人用的催促草稿，且 W-1 已删掉它唯一的调用方。
 * 催单现在走询价追踪页「现在就催」（POST /api/projects/[id]/tender-rfq/chase，起草审批卡）或催单扫描。
 * 这里只返回 410：不鉴权、不调模型、不读写库（不泄露任何信息）。
 */
export async function POST() {
  return NextResponse.json(
    { error: "这个接口已下线：请到询价追踪页（/bids/rfq）或项目的询价区催单。", code: "GONE" },
    { status: 410 },
  );
}
