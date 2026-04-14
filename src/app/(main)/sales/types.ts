export const STAGES = [
  { key: "new_lead", label: "新线索", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { key: "needs_confirmed", label: "需求确认", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
  { key: "measure_booked", label: "预约量房", color: "bg-teal-100 text-teal-800 border-teal-200" },
  { key: "quoted", label: "已报价", color: "bg-orange-100 text-orange-800 border-orange-200" },
  { key: "negotiation", label: "洽谈中", color: "bg-purple-100 text-purple-800 border-purple-200" },
  { key: "signed", label: "已签单", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { key: "producing", label: "生产中", color: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "installing", label: "安装中", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  { key: "completed", label: "已完成", color: "bg-green-100 text-green-800 border-green-200" },
  { key: "lost", label: "已流失", color: "bg-red-100 text-red-800 border-red-200" },
  { key: "on_hold", label: "暂搁置", color: "bg-gray-100 text-gray-600 border-gray-200" },
] as const;

export const PRIORITIES = {
  hot: { label: "热", class: "bg-red-500 text-white" },
  warm: { label: "温", class: "bg-amber-500 text-white" },
  cold: { label: "冷", class: "bg-blue-400 text-white" },
};

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  status: string;
  tags?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
  opportunities?: Opportunity[];
  _count?: { interactions: number; quotes: number; blindsOrders: number };
  _offlinePending?: boolean;
}

export interface Opportunity {
  id: string;
  title: string;
  stage: string;
  estimatedValue: number | null;
  priority: string;
  productTypes: string | null;
  customer?: { id: string; name: string; phone: string | null };
  _count?: { interactions: number; quotes: number; blindsOrders: number };
  nextFollowupAt: string | null;
  updatedAt: string;
  createdAt: string;
  latestQuoteTotal: number | null;
  latestQuoteStatus: string | null;
}

export interface ImportResult {
  totalRows: number;
  customersCreated: number;
  opportunitiesCreated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export type ViewMode = "pipeline" | "customers";

export type HealthInfo = { score: number; sentiment: string | null; tip: string | null; hasKnowledge: boolean };

export interface AlertItem {
  title: string;
  description: string;
  severity: string;
  category: string;
  action?: { payload?: { customerId?: string; opportunityId?: string } };
}

export interface BriefingData {
  date: string;
  stats: Record<string, number>;
  urgentItems: AlertItem[];
  aiSummary: string;
  generatedAt: string;
}

export const EMAIL_SCENES: Record<string, string> = {
  quote_pending: "quote_followup",
  viewed_not_signed: "quote_viewed",
  stale_opportunity: "general_followup",
  new_lead_stale: "general_followup",
};

export interface InlineEmail {
  to: string; subject: string; html: string; scene: string;
  customerId: string; quoteId?: string;
}
