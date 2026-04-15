"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  Plus,
  Pin,
  PinOff,
  Trash2,
  MessageSquare,
  FolderKanban,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── 类型 ──────────────────────────────────────────────────────

export interface AiThread {
  id: string;
  title: string;
  projectId: string | null;
  pinned: boolean;
  lastMessageAt: string;
  createdAt: string;
  project: { id: string; name: string } | null;
  _count: { messages: number };
}

export interface ThreadSidebarProps {
  threads: AiThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (projectId?: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  showMobile: boolean;
  onCloseMobile: () => void;
}

// ── 线程列表侧栏 ─────────────────────────────────────────────

export function ThreadSidebar({
  threads,
  activeId,
  onSelect,
  onCreate,
  onTogglePin,
  onDelete,
  showMobile,
  onCloseMobile,
}: ThreadSidebarProps) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const pinned = threads.filter((t) => t.pinned);
  const projectThreads = threads.filter((t) => !t.pinned && t.projectId);
  const generalThreads = threads.filter((t) => !t.pinned && !t.projectId);

  const renderGroup = (label: string, items: AiThread[], icon?: ReactNode) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-3">
        <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
          {icon}
          {label}
        </div>
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
              t.id === activeId
                ? "bg-accent/10 text-accent font-medium"
                : "text-foreground/80 hover:bg-accent/5"
            )}
            onClick={() => { onSelect(t.id); onCloseMobile(); }}
          >
            {t.project ? (
              <FolderKanban size={14} className="shrink-0 text-muted/60" />
            ) : (
              <MessageSquare size={14} className="shrink-0 text-muted/60" />
            )}
            <span className="flex-1 truncate">{t.title}</span>
            <button
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(menuOpen === t.id ? null : t.id);
              }}
            >
              <MoreHorizontal size={14} className="text-muted" />
            </button>
            {menuOpen === t.id && (
              <div
                className="absolute right-0 top-8 z-50 w-36 rounded-lg border border-border bg-card-bg py-1 shadow-lg"
                onMouseLeave={() => setMenuOpen(null)}
              >
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(t.id, !t.pinned);
                    setMenuOpen(null);
                  }}
                >
                  {t.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                  {t.pinned ? "取消置顶" : "置顶"}
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(t.id);
                    setMenuOpen(null);
                  }}
                >
                  <Trash2 size={12} />
                  删除
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-3 pb-2">
        <h2 className="text-sm font-semibold">对话列表</h2>
        <button
          onClick={() => onCreate()}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent transition-colors hover:bg-accent/20"
          title="新建对话"
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {threads.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted/60">
            暂无对话，点击 + 开始
          </div>
        )}
        {renderGroup("置顶", pinned, <Pin size={10} />)}
        {renderGroup("项目对话", projectThreads, <FolderKanban size={10} />)}
        {renderGroup("通用对话", generalThreads, <MessageSquare size={10} />)}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden w-60 shrink-0 border-r border-border lg:block">
        {sidebar}
      </div>
      {/* Mobile overlay */}
      {showMobile && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={onCloseMobile}
          />
          <div className="relative w-72 bg-background shadow-xl">
            {sidebar}
          </div>
        </div>
      )}
    </>
  );
}
