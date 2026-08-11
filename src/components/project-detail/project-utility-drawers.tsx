"use client";

/**
 * 贯穿式抽屉（T1A）：资料（项目文件）与问青砚（项目 AI 对话）。
 * 文件与 AI 对话不再占一级 tab，从任意 tab 呼出，不打断当前工作流。
 *
 * BodyPortal：app-shell 主内容列带 backdrop-blur（app-shell.tsx:92），在现代
 * Chromium 中会成为 fixed 后代的 containing block，使页面内渲染的 Drawer 错位。
 * 这里把抽屉传送到 body，不改共享 ui/drawer.tsx（POTENTIAL_PHASE2_CONFLICT 规避）。
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Drawer } from "@/components/ui/drawer";
import { ProjectFileManager } from "@/components/project-files/project-file-manager";
import { ProjectAiChat } from "@/components/project-ai-chat/project-ai-chat";

export function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

export function ProjectFilesDrawer({
  projectId,
  closeDate,
  open,
  onClose,
  onProjectUpdate,
}: {
  projectId: string;
  closeDate: string | null;
  open: boolean;
  onClose: () => void;
  onProjectUpdate: () => void;
}) {
  return (
    <BodyPortal>
      <Drawer
        open={open}
        onClose={onClose}
        title="项目资料"
        width="w-[min(760px,calc(100vw-1rem))]"
        contentClassName="p-4"
      >
        {open ? (
          <ProjectFileManager
            projectId={projectId}
            closeDate={closeDate}
            onProjectUpdate={onProjectUpdate}
          />
        ) : null}
      </Drawer>
    </BodyPortal>
  );
}

export function ProjectChatDrawer({
  projectId,
  projectName,
  orgId,
  open,
  onClose,
  onProjectUpdate,
}: {
  projectId: string;
  projectName: string;
  orgId: string | null;
  open: boolean;
  onClose: () => void;
  onProjectUpdate: () => void;
}) {
  return (
    <BodyPortal>
      <Drawer
        open={open}
        onClose={onClose}
        title="问青砚 · 项目助手"
        width="w-[min(640px,calc(100vw-1rem))]"
        contentClassName="p-4"
      >
        {open ? (
          <ProjectAiChat
            projectId={projectId}
            projectName={projectName}
            orgId={orgId}
            onProjectUpdate={onProjectUpdate}
          />
        ) : null}
      </Drawer>
    </BodyPortal>
  );
}
