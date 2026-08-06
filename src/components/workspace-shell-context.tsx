"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

/**
 * Phase 2 的 Shell 插槽契约。
 *
 * 业务页面只能登记面向业务用户的标题、摘要与右栏内容；不把 runtime、tool call
 * 或 prompt 等诊断字段塞进这里。具体项目 / 客户 / 报价页从 Phase 3 起逐页接入。
 */
export interface WorkspaceContextDescriptor {
  /** 例如“项目”“客户”“报价单”。 */
  eyebrow?: ReactNode;
  /** 当前实体或页面名称。 */
  title: ReactNode;
  /** 可选的状态、负责人、更新时间等简短业务摘要。 */
  summary?: ReactNode;
  /** 右侧上下文面板标题。未提供 panel 时不会显示右栏入口。 */
  panelTitle?: string;
  /** 仅放业务摘要、风险、下一步与待确认动作。 */
  panel?: ReactNode;
}

interface WorkspaceShellContextValue {
  context: WorkspaceContextDescriptor | null;
  setContext: (context: WorkspaceContextDescriptor | null) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
}

const WorkspaceShellContext = createContext<WorkspaceShellContextValue>({
  context: null,
  setContext: () => {},
  panelOpen: false,
  setPanelOpen: () => {},
  togglePanel: () => {},
});

export function useWorkspaceShell() {
  return useContext(WorkspaceShellContext);
}

export function WorkspaceShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [context, setContext] = useState<WorkspaceContextDescriptor | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // 切换路由时绝不让上一个实体的右栏继续占用新页面。
  useEffect(() => {
    setPanelOpen(false);
  }, [pathname]);

  const value = useMemo<WorkspaceShellContextValue>(
    () => ({
      context,
      setContext,
      panelOpen,
      setPanelOpen,
      togglePanel: () => setPanelOpen((open) => !open),
    }),
    [context, panelOpen],
  );

  return (
    <WorkspaceShellContext.Provider value={value}>
      {children}
    </WorkspaceShellContext.Provider>
  );
}

/**
 * 页面接入 Shell 的轻量声明组件。它不请求数据、不改变权限或 AI Scope。
 * 页面对 descriptor 的变化会自动同步；卸载时清空上下文，避免跨路由残留。
 */
export function WorkspacePageContext({
  context,
}: {
  context: WorkspaceContextDescriptor;
}) {
  const { setContext } = useWorkspaceShell();

  useEffect(() => {
    setContext(context);
    return () => setContext(null);
  }, [context, setContext]);

  return null;
}
