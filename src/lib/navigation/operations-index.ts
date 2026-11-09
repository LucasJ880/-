/**
 * VIS-1b：/operations 索引卡片（spec navigation/entry-visibility「/operations 索引只列放行的卡片」；design D9 / Q9）
 *
 * 卡片清单仍是这张页内静态表（文案不变，多数卡片不在导航里），逐张按路由门判定；平台 super_admin 全部显示。
 */

import { BarChart3, BookOpen, CalendarDays, Clapperboard, Megaphone, Search, ShieldCheck, TrendingUp, Users, type LucideIcon } from "lucide-react";
import type { RouteGateContext } from "./filter-context";
import { canOpenHref } from "./landing";

export type OperationsIndexCard = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** 强调边框（增长中心、营销数字员工） */
  highlight?: true;
};

export const OPERATIONS_INDEX_CARDS: readonly OperationsIndexCard[] = [
  { href: "/operations/growth", title: "增长中心", description: "企业事实、七维体检、增长任务、推广计划与营销实验闭环", icon: TrendingUp, highlight: true },
  { href: "/marketing/employee", title: "营销数字员工", description: "产品档案、客户研究、竞品、文案、邮件与广告规划（副作用须审批）", icon: Megaphone, highlight: true },
  { href: "/operations/intelligence", title: "市场情报", description: "调用青砚营销分析，拆解竞品全渠道打法并设计首个增长实验", icon: Search },
  { href: "/operations/matrix", title: "矩阵账号", description: "英文社媒 + 小红书账号台账，按账号组管理通道与配额", icon: Users },
  { href: "/operations/assets", title: "视频资产", description: "Aivora 成片自动入库，AI 差异化文案后扇出派发到矩阵账号", icon: Clapperboard },
  { href: "/operations/review", title: "发布审核队列", description: "抽检任务与规则拦截任务在此人工通过或驳回", icon: ShieldCheck },
  { href: "/operations/dashboard", title: "数据看板", description: "账号健康、发布任务状态与近 14 天发布趋势", icon: BarChart3 },
  { href: "/operations/brand", title: "品牌记忆", description: "统一品牌语料，文案变体与内容技能自动引用，口径一致", icon: BookOpen },
  { href: "/operations/tender-profile", title: "投标业务档案", description: "与品牌档案分离：投标起草、备忘录、合规响应只读这份档案，不回退到其他业务线", icon: BookOpen },
  { href: "/operations/calendar", title: "内容日历", description: "AI 按品牌记忆批量出选题，审核后关联视频扇出", icon: CalendarDays },
];

/** 对判定输入放行的卡片（canOpenHref：super_admin 一律放行） */
export function visibleOperationsCards(ctx: RouteGateContext): OperationsIndexCard[] {
  return OPERATIONS_INDEX_CARDS.filter((card) => canOpenHref(card.href, ctx));
}
