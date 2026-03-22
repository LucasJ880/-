/**
 * 项目讨论 — 类型定义 & 常量
 *
 * metadata 结构严格规范：所有系统消息 metadata 遵循 SystemEventMetadata 类型。
 */

export type MessageType = "TEXT" | "SYSTEM" | "STATUS";

export interface DiscussionMessage {
  id: string;
  conversationId: string;
  projectId: string;
  senderId: string | null;
  sender: {
    id: string;
    name: string;
    avatar: string | null;
  } | null;
  type: MessageType;
  body: string;
  metadata: SystemEventMetadata | null;
  replyToId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface DiscussionConversation {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  archivedAt: string | null;
  createdAt: string;
}

export interface DiscussionOverview {
  conversation: DiscussionConversation;
  memberCount: number;
  messageCount: number;
  messages: DiscussionMessage[];
  hasMore: boolean;
  nextCursor: string | null;
}

export const MESSAGE_MAX_LENGTH = 5000;
export const DEFAULT_PAGE_SIZE = 50;

// ─── 系统事件类型枚举 ───

export const SYSTEM_EVENT_TYPES = {
  PROJECT_CREATED: "project_created",
  MEMBER_JOINED: "member_joined",
  MEMBER_REMOVED: "member_removed",
  STAGE_CHANGED: "stage_changed",
  DATE_CHANGED: "date_changed",
  PROJECT_SUBMITTED: "project_submitted",
  STATUS_CHANGED: "status_changed",
} as const;

export type SystemEventType = (typeof SYSTEM_EVENT_TYPES)[keyof typeof SYSTEM_EVENT_TYPES];

// ─── 系统事件 metadata 严格类型 ───

interface BasePayload {
  eventType: SystemEventType;
  actorId?: string;
  actorName?: string;
  source: "manual" | "system" | "api";
}

interface ProjectCreatedPayload extends BasePayload {
  eventType: "project_created";
  projectName: string;
}

interface MemberJoinedPayload extends BasePayload {
  eventType: "member_joined";
  memberId?: string;
  memberName: string;
  memberRole: string;
}

interface MemberRemovedPayload extends BasePayload {
  eventType: "member_removed";
  memberId?: string;
  memberName: string;
}

interface StageChangedPayload extends BasePayload {
  eventType: "stage_changed";
  stageBefore: string;
  stageAfter: string;
}

interface DateChangedPayload extends BasePayload {
  eventType: "date_changed";
  field: string;
  before: string | null;
  after: string | null;
}

interface ProjectSubmittedPayload extends BasePayload {
  eventType: "project_submitted";
  submittedAt: string;
}

interface StatusChangedPayload extends BasePayload {
  eventType: "status_changed";
  statusBefore: string;
  statusAfter: string;
}

export type SystemEventMetadata =
  | ProjectCreatedPayload
  | MemberJoinedPayload
  | MemberRemovedPayload
  | StageChangedPayload
  | DateChangedPayload
  | ProjectSubmittedPayload
  | StatusChangedPayload;
