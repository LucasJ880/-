"use client";

import {
  Info,
  GitBranch,
  CalendarClock,
  UserPlus,
  UserMinus,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import type { DiscussionMessage, MentionItem, TextMessageMetadata } from "@/lib/project-discussion/types";

interface Props {
  message: DiscussionMessage;
}

const SYSTEM_ICONS: Record<string, typeof Info> = {
  project_created: Info,
  member_joined: UserPlus,
  member_removed: UserMinus,
  stage_changed: GitBranch,
  date_changed: CalendarClock,
  project_submitted: CheckCircle2,
  status_changed: RefreshCw,
};

export function ProjectDiscussionMessageItem({ message }: Props) {
  if (message.type === "SYSTEM" || message.type === "STATUS") {
    return <SystemEventItem message={message} />;
  }

  return <TextMessageItem message={message} />;
}

function TextMessageItem({ message }: { message: DiscussionMessage }) {
  const time = new Date(message.createdAt).toLocaleTimeString("zh-CN", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="group flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[rgba(95,143,139,0.03)]">
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
        {message.sender?.avatar ? (
          <img
            src={message.sender.avatar}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          (message.sender?.name ?? "?").charAt(0).toUpperCase()
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">
            {message.sender?.name ?? "未知用户"}
          </span>
          <span className="text-[10px] text-muted/60">{time}</span>
          {message.editedAt && (
            <span className="text-[10px] text-muted/40">（已编辑）</span>
          )}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
          {renderBodyWithMentions(message.body, message.metadata)}
        </p>
      </div>
    </div>
  );
}

function SystemEventItem({ message }: { message: DiscussionMessage }) {
  const meta = message.metadata as Record<string, unknown> | null;
  const eventType = meta?.eventType as string | undefined;
  const Icon = (eventType && SYSTEM_ICONS[eventType]) || Info;

  const time = new Date(message.createdAt).toLocaleTimeString("zh-CN", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="my-1.5 flex items-start gap-2 rounded-lg bg-[rgba(95,143,139,0.04)] px-3 py-2">
      <Icon
        size={14}
        className="mt-0.5 shrink-0 text-accent/50"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-relaxed text-muted">{message.body}</p>
      </div>
      <span className="shrink-0 text-[10px] text-muted/50">{time}</span>
    </div>
  );
}

function renderBodyWithMentions(
  body: string,
  metadata: DiscussionMessage["metadata"]
): React.ReactNode {
  const mentions: MentionItem[] =
    (metadata as TextMessageMetadata | null)?.mentions ?? [];
  if (mentions.length === 0) return body;

  const names = mentions.map((m) => m.name).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(@(?:${names.map(escapeRegex).join("|")}))`, "g");

  const parts = body.split(pattern);
  return parts.map((part, i) => {
    if (part.startsWith("@") && mentions.some((m) => part === `@${m.name}`)) {
      return (
        <span key={i} className="rounded bg-accent/10 px-0.5 font-medium text-accent">
          {part}
        </span>
      );
    }
    return part;
  });
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
