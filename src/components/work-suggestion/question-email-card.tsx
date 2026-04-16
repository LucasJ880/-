"use client";

import { useState } from "react";
import {
  FolderKanban,
  MapPin,
} from "lucide-react";
import type { QuestionEmailSuggestion } from "@/lib/ai/schemas";
import { FileQuestion, Mail } from "lucide-react";
import { ProjectQuestionDialog, type QuestionPrefill } from "@/components/project-question/project-question-dialog";

export function QuestionEmailCard({
  suggestion,
  projectId,
  onCreated,
}: {
  suggestion: QuestionEmailSuggestion;
  projectId?: string;
  onCreated?: () => void;
}) {
  const [showDialog, setShowDialog] = useState(false);

  const effectiveProjectId = projectId || suggestion.projectId;

  const prefill: QuestionPrefill = {
    title: suggestion.title,
    description: suggestion.description,
    locationOrReference: suggestion.locationOrReference || undefined,
    clarificationNeeded: suggestion.clarificationNeeded || undefined,
    impactNote: suggestion.impactNote || undefined,
    toRecipients: suggestion.toRecipients || undefined,
  };

  if (!effectiveProjectId) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-xs text-[#a63d3d]">
        缺少项目信息，无法生成问题邮件
      </div>
    );
  }

  return (
    <>
      <div className="my-2 rounded-xl border border-[rgba(90,80,150,0.15)] bg-gradient-to-br from-[rgba(90,80,150,0.03)] to-[rgba(90,80,150,0.02)]">
        <div className="flex items-center gap-1.5 border-b border-[rgba(90,80,150,0.08)] px-4 py-2.5">
          <FileQuestion size={13} className="text-[#5a5096]" />
          <span className="text-xs font-semibold text-[#5a5096]">
            AI 识别到项目问题 — 可生成澄清邮件
          </span>
        </div>

        <div className="space-y-2 p-4">
          <h4 className="text-sm font-semibold text-foreground">{suggestion.title}</h4>
          <p className="text-xs leading-relaxed text-muted">{suggestion.description}</p>

          <div className="flex flex-wrap gap-2">
            {suggestion.project && (
              <span className="flex items-center gap-1 rounded-full border border-[rgba(90,80,150,0.15)] bg-[rgba(90,80,150,0.04)] px-2 py-0.5 text-[11px] font-medium text-[#5a5096]">
                <FolderKanban size={11} />
                {suggestion.project}
              </span>
            )}
            {suggestion.locationOrReference && (
              <span className="flex items-center gap-1 rounded-full border border-[rgba(110,125,118,0.15)] bg-[rgba(110,125,118,0.06)] px-2 py-0.5 text-[11px] font-medium text-[#6e7d76]">
                <MapPin size={11} />
                {suggestion.locationOrReference}
              </span>
            )}
          </div>

          {suggestion.clarificationNeeded && (
            <div className="rounded-lg bg-[rgba(90,80,150,0.04)] px-3 py-2 text-xs text-[#5a5096]">
              <span className="font-medium">需确认：</span>{suggestion.clarificationNeeded}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[rgba(90,80,150,0.08)] px-4 py-2.5">
          <button
            onClick={() => setShowDialog(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#5a5096] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#5a5096]/90"
          >
            <Mail size={13} />
            生成澄清邮件并发送
          </button>
        </div>
      </div>

      <ProjectQuestionDialog
        projectId={effectiveProjectId}
        open={showDialog}
        onOpenChange={setShowDialog}
        prefill={prefill}
        onSent={() => {
          setShowDialog(false);
          onCreated?.();
        }}
      />
    </>
  );
}
