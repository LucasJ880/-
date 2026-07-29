import { formatCAD } from "@/lib/blinds/pricing-engine";

export function formatSalesMoney(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return formatCAD(0);
  return formatCAD(amount);
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function relativeTimeLabel(date: Date | string | null | undefined): string {
  if (!date) return "暂无互动";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "暂无互动";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(d);
}

export const HOME_STAGE_LABELS: Record<string, string> = {
  new_lead: "新线索",
  needs_confirmed: "已联系",
  measure_booked: "已预约",
  quoted: "已报价",
  negotiation: "谈判中",
  signed: "已签约",
  producing: "生产中",
  installing: "安装中",
  completed: "已完成",
  lost: "已流失",
  on_hold: "暂搁置",
};

/** 首页漏斗展示阶段（与指令对齐，映射现有 stage） */
export const HOME_FUNNEL_STAGES = [
  { stage: "new_lead", label: "新线索" },
  { stage: "needs_confirmed", label: "已联系" },
  { stage: "measure_booked", label: "已预约" },
  { stage: "quoted", label: "已报价" },
  { stage: "negotiation", label: "谈判中" },
  { stage: "signed", label: "已签约" },
] as const;
