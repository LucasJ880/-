"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  AUTO_AI_PANELS_EVENT,
  requestAutoAiPanels,
} from "@/lib/projects/auto-ai-panels";

/**
 * 挂在项目详情页：监听事件后并行生成「进展摘要 + 投标准备清单」，
 * 并在首次进入且尚无数据时自动触发一次。
 */
export function AutoAiPanelsRunner({
  projectId,
  enabled = true,
}: {
  projectId: string;
  enabled?: boolean;
}) {
  const running = useRef(false);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (!enabled || !projectId) return;

    const run = async (force: boolean) => {
      if (running.current) return;
      running.current = true;
      try {
        if (!force) {
          const [summaryRes, checklistRes] = await Promise.all([
            apiFetch(`/api/projects/${projectId}/progress-summary`).then((r) =>
              r.json().catch(() => ({})),
            ),
            apiFetch(`/api/projects/${projectId}/checklist`).then((r) =>
              r.json().catch(() => ({})),
            ),
          ]);
          const hasSummary = !!summaryRes?.summary;
          const hasChecklist = !!checklistRes?.checklist;
          if (hasSummary && hasChecklist) {
            // 通知面板刷新已有数据
            window.dispatchEvent(
              new CustomEvent("qingyan:ai-panels-updated", {
                detail: { projectId },
              }),
            );
            return;
          }
        }

        await Promise.allSettled([
          apiFetch(`/api/projects/${projectId}/progress-summary`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trigger: "auto" }),
          }),
          apiFetch(`/api/projects/${projectId}/checklist`, {
            method: "POST",
          }),
        ]);

        window.dispatchEvent(
          new CustomEvent("qingyan:ai-panels-updated", {
            detail: { projectId },
          }),
        );
      } finally {
        running.current = false;
      }
    };

    const onAuto = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      void run(true);
    };

    window.addEventListener(AUTO_AI_PANELS_EVENT, onAuto);

    if (!bootstrapped.current) {
      bootstrapped.current = true;
      // 稍延迟，避免与首屏其它请求挤在一起
      const t = window.setTimeout(() => {
        void run(false);
      }, 800);
      return () => {
        window.clearTimeout(t);
        window.removeEventListener(AUTO_AI_PANELS_EVENT, onAuto);
      };
    }

    return () => {
      window.removeEventListener(AUTO_AI_PANELS_EVENT, onAuto);
    };
  }, [projectId, enabled]);

  // 暴露给调试：也可被其它模块直接调用
  useEffect(() => {
    (window as unknown as { __qyRequestAutoAiPanels?: typeof requestAutoAiPanels })
      .__qyRequestAutoAiPanels = requestAutoAiPanels;
  }, []);

  return null;
}
