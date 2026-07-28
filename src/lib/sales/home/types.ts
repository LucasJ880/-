/** Sales Command Center 首页聚合响应 */

export type PriorityLevel = "urgent" | "important" | "normal";

export interface SalesPriorityItem {
  id: string;
  level: PriorityLevel;
  customerId: string | null;
  customerName: string;
  title: string;
  reason: string;
  category: string;
  updatedAt: string | null;
  amount: number | null;
  primaryAction: {
    type: string;
    label: string;
    href?: string;
    payload?: Record<string, unknown>;
  };
  secondaryAction?: {
    type: string;
    label: string;
    href?: string;
  };
}

export interface SalesPriorityCustomer {
  customerId: string;
  customerName: string;
  stage: string;
  stageLabel: string;
  estimatedValue: number | null;
  lastInteractionLabel: string;
  suggestion: string;
  badge: "较高成交可能" | "需要尽快跟进" | null;
}

export interface SalesHomeAppointment {
  id: string;
  startAt: string;
  type: string;
  title: string | null;
  customerId: string | null;
  customerName: string;
  location: string | null;
  isPhone: boolean;
}

export interface SalesHomePendingDeposit {
  id: string;
  customerId: string | null;
  customerName: string;
  grandTotal: number;
  agreedDepositAmount: number | null;
  signedAt: string;
}

export interface SalesHomeResponse {
  period: {
    start: string;
    end: string;
    currency: string;
  };
  userName: string;
  performance: {
    targetAmount: number | null;
    signedAmount: number;
    signedCount: number;
    remainingAmount: number | null;
    completionRate: number | null;
    weeklySignedAmount: number;
    averageOrderValue: number;
  };
  activity: {
    activeOpportunities: number;
    followupsDue: number;
    todayAppointments: number;
    pendingDeposits: number;
  };
  trend: Array<{ date: string; signedAmount: number }>;
  priorities: SalesPriorityItem[];
  priorityTotal: number;
  priorityCustomers: SalesPriorityCustomer[];
  appointments: SalesHomeAppointment[];
  funnel: Array<{
    stage: string;
    label: string;
    count: number;
    amount: number;
    conversionRate: number | null;
  }>;
  quoteSummary: {
    draft: { count: number; amount: number };
    sentNotViewed: { count: number; amount: number };
    viewedNotSigned: { count: number; amount: number };
    signedPendingDeposit: { count: number; amount: number };
    expiring: { count: number; amount: number };
  };
  paymentSummary: {
    signedAmount: number;
    pendingDepositAmount: number;
    collectedDepositAmount: number;
    pendingBalanceAmount: number;
    pendingDeposits: SalesHomePendingDeposit[];
  };
}
