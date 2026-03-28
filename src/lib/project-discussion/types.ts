/**
 * 项目讨论 — 类型定义 & 常量
 *
 * metadata 结构严格规范：所有系统消息 metadata 遵循 SystemEventMetadata 类型。
 */

export type MessageType = "TEXT" | "SYSTEM" | "STATUS";

export interface MentionItem {
  userId: string;
  name: string;
}

export interface TextMessageMetadata {
  mentions?: MentionItem[];
}

export type MessageMetadata = SystemEventMetadata | TextMessageMetadata | null;

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
  metadata: MessageMetadata;
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
  PROJECT_ABANDONED: "project_abandoned",
  TASK_CREATED: "task_created",
  EVENT_CREATED: "event_created",
  STAGE_ADVANCED: "stage_advanced",
  EMAIL_SENT: "email_sent",
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

interface ProjectAbandonedPayload extends BasePayload {
  eventType: "project_abandoned";
  abandonedStage: string;
  reason?: string;
}

interface TaskCreatedPayload extends BasePayload {
  eventType: "task_created";
  taskId: string;
  taskTitle: string;
  taskPriority?: string;
}

interface EventCreatedPayload extends BasePayload {
  eventType: "event_created";
  eventId: string;
  eventTitle: string;
  startTime: string;
}

interface StageAdvancedPayload extends BasePayload {
  eventType: "stage_advanced";
  fromStage: string;
  toStage: string;
  advanceSource: "ai_suggestion" | "manual";
  confidence?: number;
}

interface EmailSentPayload extends BasePayload {
  eventType: "email_sent";
  emailId: string;
  toEmail: string;
  toName: string | null;
  supplierName: string;
  subject: string;
}

export type SystemEventMetadata =
  | ProjectCreatedPayload
  | MemberJoinedPayload
  | MemberRemovedPayload
  | StageChangedPayload
  | DateChangedPayload
  | ProjectSubmittedPayload
  | StatusChangedPayload
  | ProjectAbandonedPayload
  | TaskCreatedPayload
  | EventCreatedPayload
  | StageAdvancedPayload
  | EmailSentPayload;
