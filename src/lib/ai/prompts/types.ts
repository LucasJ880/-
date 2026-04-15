/**
 * 青砚 AI 提示词 — 共享类型定义
 */

// ── 工作上下文（第一层：每次对话自动注入） ─────────────────────

export interface ProjectSummary {
  id: string;
  name: string;
  clientOrganization: string | null;
  tenderStatus: string | null;
  estimatedValue: number | null;
  currency: string | null;
  closeDate: string | null;
  priority: string;
  status: string;
  sourceSystem: string | null;
}

export interface TaskSummaryItem {
  title: string;
  priority: string;
  status: string;
  dueDate: string | null;
  projectName: string | null;
}

export interface ProjectProgressBrief {
  projectName: string;
  taskProgress: number;
  timeProgress: number;
  daysRemaining: number;
  riskLevel: string;
  isOverdue: boolean;
}

export interface WorkContext {
  projects: ProjectSummary[];
  recentTasks: TaskSummaryItem[];
  urgentProjects: ProjectSummary[];
  projectProgress?: ProjectProgressBrief[];
}

// ── 深度上下文（第二层：提到具体项目时注入） ─────────────────────

export interface SupplierSummary {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  contactEmail: string | null;
}

export interface InquirySummary {
  roundNumber: number;
  status: string;
  itemCount: number;
  quotedCount: number;
  selectedSupplier: string | null;
}

export interface ProjectDeepContext {
  project: ProjectSummary & {
    description: string | null;
    location: string | null;
    solicitationNumber: string | null;
    publicDate: string | null;
    questionCloseDate: string | null;
    createdAt: string;
  };
  intelligence: {
    recommendation: string;
    riskLevel: string;
    fitScore: number;
    summary: string | null;
  } | null;
  documents: Array<{
    title: string; fileType: string;
    contentText?: string | null; parseStatus?: string | null;
    aiSummaryJson?: string | null; aiSummaryStatus?: string | null;
  }>;
  taskStats: { total: number; done: number; overdue: number };
  recentDiscussion: Array<{ sender: string; body: string; createdAt: string; type: string }>;
  members: Array<{ name: string; role: string }>;
  suppliers: SupplierSummary[];
  inquiries: InquirySummary[];
}

// ── 邮件草稿 ──────────────────────────────────────────────────

export interface EmailDraftContext {
  project: {
    name: string;
    clientOrganization: string | null;
    description: string | null;
    solicitationNumber: string | null;
    closeDate: string | null;
  };
  supplier: {
    name: string;
    contactEmail: string;
    contactName: string | null;
    category: string | null;
    region: string | null;
  };
  inquiry: {
    roundNumber: number;
    title: string | null;
    scope: string | null;
    dueDate: string | null;
  };
  inquiryItem: {
    status: string;
    contactNotes: string | null;
  };
  senderName: string;
  senderOrg: string | null;
}

// ── 报价对比分析 ──────────────────────────────────────────────

export interface QuoteAnalysisContext {
  project: {
    name: string;
    description: string | null;
    closeDate: string | null;
  };
  inquiry: {
    roundNumber: number;
    title: string | null;
    scope: string | null;
  };
  quotes: Array<{
    supplierName: string;
    unitPrice: string | null;
    totalPrice: string | null;
    currency: string;
    deliveryDays: number | null;
    quoteNotes: string | null;
    isSelected: boolean;
  }>;
}

// ── 跨语言理解 ──────────────────────────────────────────────

export type LanguageAssistMode = "translate" | "understand_and_reply";

// ── 项目问题澄清邮件 ──────────────────────────────────────────

export interface ProjectQuestionEmailContext {
  project: {
    name: string;
    solicitationNumber: string | null;
    clientOrganization: string | null;
    description: string | null;
  };
  question: {
    title: string;
    description: string;
    locationOrReference: string | null;
    clarificationNeeded: string | null;
    impactNote: string | null;
  };
  senderName: string;
  senderOrg: string | null;
  toRecipients: string | null;
}

// ── 项目进度/清单上下文 ──────────────────────────────────────

export interface ProgressSummaryContext {
  project: {
    name: string;
    clientOrganization: string | null;
    tenderStatus: string | null;
    priority: string;
    closeDate: string | null;
    location: string | null;
    estimatedValue: number | null;
    currency: string | null;
    description: string | null;
  };
  taskStats: { total: number; done: number; overdue: number };
  recentDiscussion: { sender: string; body: string; createdAt: string; type: string }[];
  inquiries: { roundNumber: number; status: string; itemCount: number; quotedCount: number; selectedSupplier: string | null }[];
  members: { name: string; role: string }[];
  documents: {
    title: string; fileType: string;
    contentText?: string | null; parseStatus?: string | null;
    aiSummaryJson?: string | null; aiSummaryStatus?: string | null;
  }[];
}

// ── 催促邮件 ──────────────────────────────────────────────────

export interface FollowupEmailContext {
  project: {
    name: string;
    clientOrganization: string | null;
    solicitationNumber: string | null;
    closeDate: string | null;
  };
  supplier: {
    name: string;
    contactName: string | null;
    contactEmail: string;
    category: string | null;
  };
  inquiry: {
    roundNumber: number;
    title: string | null;
    dueDate: string | null;
  };
  daysSinceContact: number;
  senderName: string;
  senderOrg: string | null;
}

// ── 报价副驾驶 ──────────────────────────────────────────────

export interface QuoteTemplateRecommendContext {
  project: {
    name: string;
    clientOrganization: string | null;
    category: string | null;
    sourceSystem: string | null;
    tenderStatus: string | null;
    description: string | null;
    location: string | null;
  };
}

export interface QuoteDraftContext {
  project: {
    name: string;
    clientOrganization: string | null;
    description: string | null;
    closeDate: string | null;
    location: string | null;
    currency: string | null;
  };
  supplierQuotes: Array<{
    supplierName: string;
    totalPrice: string | null;
    unitPrice: string | null;
    currency: string;
    deliveryDays: number | null;
    quoteNotes: string | null;
  }>;
  templateType: string;
  inquiryScope: string | null;
  memory: string;
}

export interface QuoteReviewContext {
  templateType: string;
  header: {
    currency: string;
    tradeTerms: string;
    paymentTerms: string;
    deliveryDays: number | null;
    validUntil: string;
    moq: number | null;
    originCountry: string;
  };
  lineItems: Array<{
    category: string;
    itemName: string;
    quantity: number | null;
    unitPrice: number | null;
    totalPrice: number | null;
    costPrice: number | null;
  }>;
  totals: {
    subtotal: number;
    internalCost: number;
    profitMargin: number | null;
  };
  projectDescription: string | null;
  supplierQuoteCount: number;
}
