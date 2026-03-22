export interface DashboardRange {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  days: number;
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface MetricWithDelta {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number;
}

export interface IssueDistribution {
  type: string;
  count: number;
}

export interface DashboardOverview {
  totalConversations: MetricWithDelta;
  recentConversations: MetricWithDelta;
  avgAutoScore: MetricWithDelta;
  avgHumanScore: MetricWithDelta;
  lowScoreCount: MetricWithDelta;
  runtimeFailures: MetricWithDelta;
  openFeedbacks: number;
  highPriorityNotifications: number;
}

export interface DashboardTrends {
  conversations: TrendPoint[];
  evaluationScores: TrendPoint[];
  feedbacks: TrendPoint[];
  runtimeFailures: TrendPoint[];
}

export interface RiskItem {
  id: string;
  level: "high" | "medium" | "low";
  title: string;
  description: string;
  metric?: string;
}

export interface DashboardQuality {
  avgAutoScore: number | null;
  avgHumanRating: number | null;
  totalAutoEvaluations: number;
  totalHumanFeedbacks: number;
  issueDistribution: IssueDistribution[];
  recentLowScores: { id: string; score: number; createdAt: string; conversationId: string | null }[];
  recentNegativeFeedbacks: { id: string; rating: number; note: string | null; createdAt: string; conversationId: string }[];
}

export interface DashboardRuntime {
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number | null;
  toolCallCount: number;
  recentFailures: { id: string; title: string; error: string | null; createdAt: string }[];
}

export interface DashboardAssets {
  prompts: number;
  knowledgeBases: number;
  documents: number;
  agents: number;
  tools: number;
  environments: number;
  recentPublishes: number;
}

export interface ProjectDashboardData {
  overview: DashboardOverview;
  trends: DashboardTrends;
  risks: RiskItem[];
  quality: DashboardQuality;
  runtime: DashboardRuntime;
  assets: DashboardAssets;
  range: { days: number; start: string; end: string };
}
