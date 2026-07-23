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
import { useAppScrollLock } from "@/lib/mobile/use-app-scroll-lock";

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
  useAppScrollLock(showMobile, "assistant-thread-sidebar");

  const pinned = threads.filter((t) => t.pinned);
  const projectThreads = threads.filter((t) => !t.pinned && t.projectId);
  const generalThreads = threads.filter((t) => !t.pinned && !t.projectId);

  const renderGroup = (label: string, items: AiThread[], icon?: ReactNode) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-5">
        <div className="mb-1.5 flex items-center gap-1.5 px-3 text-[10px] font-semibold uppercase tracking-normal text-[#7c8480]">
          {icon}
          {label}
        </div>
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "group relative flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition-colors",
              t.id === activeId
                ? "border-black/[0.06] bg-white font-medium text-[#171a19] shadow-xs"
                : "border-transparent text-[#4b524f] hover:bg-black/[0.035] hover:text-[#171a19]"
            )}
            onClick={() => { onSelect(t.id); onCloseMobile(); }}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                t.id === activeId
                  ? "bg-[#edf3f1] text-[#2b6055]"
                  : "bg-black/[0.035] text-[#7c8480]",
              )}
            >
              {t.project ? <FolderKanban size={13} /> : <MessageSquare size={13} />}
            </span>
            <span className="flex-1 truncate">{t.title}</span>
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#7c8480] opacity-100 hover:bg-black/[0.05] lg:opacity-0 lg:group-hover:opacity-100"
              title="对话操作"
              aria-label="对话操作"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(menuOpen === t.id ? null : t.id);
              }}
            >
              <MoreHorizontal size={14} className="text-muted" />
            </button>
            {menuOpen === t.id && (
              <div
                className="absolute right-0 top-10 z-50 w-36 rounded-md border border-black/10 bg-white py-1 shadow-dialog"
                onMouseLeave={() => setMenuOpen(null)}
              >
                <button
                  className="flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-black/[0.04]"
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
                  className="flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-xs text-[#a33f3f] hover:bg-[#fff4f4]"
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
      <div className="flex items-center justify-between px-4 pb-4 pt-5">
        <div>
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-normal text-[#8b928f]">
            Qingyan Workspace
          </p>
          <h2 className="text-[15px] font-semibold tracking-normal text-[#171a19]">工作对话</h2>
        </div>
        <button
          onClick={() => onCreate()}
          className="flex h-9 w-9 items-center justify-center rounded-md bg-[#171a19] text-white shadow-xs transition-colors hover:bg-[#2b6055]"
          title="新建对话"
          aria-label="新建对话"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {threads.length === 0 && (
          <div className="mx-2 rounded-md border border-dashed border-black/10 bg-white/50 px-4 py-8 text-center">
            <MessageSquare size={18} className="mx-auto mb-2 text-[#8b928f]" />
            <p className="text-xs font-medium text-[#4b524f]">还没有工作对话</p>
            <p className="mt-1 text-[11px] text-[#8b928f]">新建后会自动保存在这里</p>
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
      <div className="hidden w-[272px] shrink-0 border-r border-black/[0.06] bg-[#f0f2f1] lg:block">
        {sidebar}
      </div>
      {/* Mobile overlay */}
      {showMobile && (
        <div
          className="fixed inset-0 z-[var(--ui-z-drawer-panel)] flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="会话列表"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={onCloseMobile}
          />
          <div className="relative w-[min(82vw,304px)] max-h-dvh overflow-y-auto overscroll-contain bg-[#f0f2f1] pb-safe shadow-dialog">
            {sidebar}
          </div>
        </div>
      )}
    </>
  );
}
