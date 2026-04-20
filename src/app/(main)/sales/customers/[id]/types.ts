export interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  wechatNote: string | null;
  status: string;
  tags: string | null;
  notes: string | null;
  createdAt: string;
  opportunities: Opportunity[];
  interactions: Interaction[];
  quotes: Quote[];
  blindsOrders: BlindsOrder[];
}

export interface Opportunity {
  id: string;
  title: string;
  stage: string;
  estimatedValue: number | null;
  priority: string;
  productTypes: string | null;
  nextFollowupAt: string | null;
  updatedAt: string;
  _count: { quotes: number; blindsOrders: number };
}

export interface Interaction {
  id: string;
  type: string;
  direction: string | null;
  summary: string;
  content: string | null;
  createdAt: string;
  createdBy: { name: string };
}

export interface Quote {
  id: string;
  version: number;
  status: string;
  grandTotal: number;
  createdAt: string;
  items: { id: string; product: string; fabric: string; price: number }[];
  /** Step 4：折扣率追踪字段（历史报价可能为 null） */
  finalDiscountPct: number | null;
  specialPromotion: number | null;
  totalMsrp: number | null;
  /** 兜底保存时的 pricing warnings 会 append 到这里 */
  notes?: string | null;
  /** 签约后销售补录的定金信息（为 null 表示尚未登记）*/
  depositAmount: number | null;
  depositMethod: string | null;
  depositCollectedAt: string | null;
  depositNote: string | null;
}

export interface BlindsOrder {
  id: string;
  code: string;
  status: string;
  createdAt: string;
}

export const STAGE_LABELS: Record<string, string> = {
  new_lead: "新线索",
  needs_confirmed: "需求确认",
  measure_booked: "预约量房",
  quoted: "已报价",
  negotiation: "洽谈中",
  signed: "已签单",
  producing: "生产中",
  installing: "安装中",
  completed: "已完成",
  lost: "已流失",
  on_hold: "暂搁置",
};

export const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-blue-100 text-blue-800",
  needs_confirmed: "bg-cyan-100 text-cyan-800",
  measure_booked: "bg-teal-100 text-teal-800",
  quoted: "bg-orange-100 text-orange-800",
  negotiation: "bg-purple-100 text-purple-800",
  signed: "bg-emerald-100 text-emerald-800",
  producing: "bg-amber-100 text-amber-800",
  installing: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  on_hold: "bg-gray-100 text-gray-600",
};

export const INTERACTION_ICONS: Record<string, string> = {
  phone_call: "📞",
  wechat: "💬",
  email: "📧",
  in_person: "🤝",
  note: "📝",
};
