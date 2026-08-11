import { redirect } from "next/navigation";

/**
 * T1A：独立「调查室」路由退出一级 UX（REMOVE_FROM_PRIMARY_UX + SAFE REDIRECT）。
 * 内容已按域归位项目详情 5-tab：调查区块/事实 → 情报 tab；分析面板 → 招标要求/提交；
 * 中国供应商简报 → 标书与报价；调查启动 → 工作台。
 * Backend（bid-intelligence API 家族）保持不变；物理删除留待后续 Cleanup。
 */

type Props = { params: Promise<{ id: string }> };

export default async function IntelligenceRoomPage({ params }: Props) {
  const { id } = await params;
  redirect(`/projects/${id}?tab=intel`);
}
