/**
 * 项目讨论 — 类型定义
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
  metadata: Record<string, unknown> | null;
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
