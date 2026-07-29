import type { DeliveryHealthStatus } from "./health";
import type { DeliveryStage } from "./stage";

export type DeliveryProjectListItem = {
  id: string;
  name: string;
  clientOrganization: string | null;
  ownerId: string;
  ownerName: string | null;
  deliveryStage: DeliveryStage | null;
  deliveryStageLabel: string;
  health: DeliveryHealthStatus;
  healthLabel: string;
  primaryRisk: string | null;
  plannedCompletionDate: string | null;
  actualCompletionDate: string | null;
  openTaskCount: number;
  overdueTaskCount: number;
  blockedTaskCount: number;
  waitingTaskCount: number;
  updatedAt: string;
};

export type DeliveryProjectDetail = DeliveryProjectListItem & {
  description: string | null;
  orgId: string | null;
  workDomain: "delivery";
  sourceTenderProjectId: string | null;
  sourceTenderProjectName: string | null;
  /** 仅当当前用户可读取来源投标项目时为可点击链接 */
  sourceTenderHref: string | null;
  nextStepSuggestion: string | null;
  recentActivity: Array<{
    id: string;
    action: string;
    createdAt: string;
    userName: string | null;
    summary: string | null;
  }>;
  riskSignals: Array<{
    kind: string;
    label: string;
    source: string;
  }>;
  documentsCount: number;
  messagesCount: number;
  canManage: boolean;
  canReopenCompleted: boolean;
};

export type DeliveryProjectListResponse = {
  items: DeliveryProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
  view: "mine" | "team";
  canToggleTeamView: boolean;
  sections?: {
    needsAttention: number;
    active: number;
    onHold: number;
    recentlyCompleted: number;
  };
};
