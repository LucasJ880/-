export const CONVERSATION_STATUSES = [
  "active",
  "completed",
  "failed",
  "archived",
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_CHANNELS = [
  "web",
  "internal",
  "api",
  "demo",
] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const MESSAGE_ROLES = [
  "user",
  "assistant",
  "system",
  "tool",
] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_CONTENT_TYPES = [
  "text",
  "json",
  "markdown",
] as const;
export type MessageContentType = (typeof MESSAGE_CONTENT_TYPES)[number];

export const MESSAGE_STATUSES = [
  "success",
  "error",
  "partial",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export function isValidConversationStatus(
  s: string
): s is ConversationStatus {
  return (CONVERSATION_STATUSES as readonly string[]).includes(s);
}

export function isValidChannel(s: string): s is ConversationChannel {
  return (CONVERSATION_CHANNELS as readonly string[]).includes(s);
}

export function isValidMessageRole(s: string): s is MessageRole {
  return (MESSAGE_ROLES as readonly string[]).includes(s);
}

export function isValidContentType(s: string): s is MessageContentType {
  return (MESSAGE_CONTENT_TYPES as readonly string[]).includes(s);
}

export function isValidMessageStatus(s: string): s is MessageStatus {
  return (MESSAGE_STATUSES as readonly string[]).includes(s);
}
