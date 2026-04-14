"use client";

import { TaskCard } from "./task-card";
import { EventCard } from "./event-card";
import { TaskAndEventCard } from "./task-and-event-card";
import { StageAdvanceCard } from "./stage-advance-card";
import { SupplierRecommendCard } from "./supplier-recommend-card";
import { QuestionEmailCard } from "./question-email-card";
import { AgentTaskCard } from "./agent-task-card";
import type { WorkSuggestionCardProps } from "./types";

export type { SimpleProject } from "./types";

export function WorkSuggestionCard({ suggestion, projects = [], projectId, onCreated }: WorkSuggestionCardProps) {
  if (suggestion.type === "agent_task" && suggestion.agentTask) {
    return <AgentTaskCard suggestion={suggestion.agentTask} onCreated={onCreated} />;
  }
  if (suggestion.type === "question_email" && suggestion.questionEmail) {
    return <QuestionEmailCard suggestion={suggestion.questionEmail} projectId={projectId} onCreated={onCreated} />;
  }
  if (suggestion.type === "supplier_recommend" && suggestion.supplierRecommend) {
    return <SupplierRecommendCard suggestion={suggestion.supplierRecommend} projectId={projectId} onCreated={onCreated} />;
  }
  if (suggestion.type === "stage_advance" && suggestion.stageAdvance) {
    return <StageAdvanceCard suggestion={suggestion.stageAdvance} onCreated={onCreated} />;
  }
  if (suggestion.type === "task_and_event" && suggestion.task && suggestion.event) {
    return (
      <TaskAndEventCard
        taskSuggestion={suggestion.task}
        eventSuggestion={suggestion.event}
        projects={projects}
        onCreated={onCreated}
      />
    );
  }
  if (suggestion.type === "event" && suggestion.event) {
    return <EventCard suggestion={suggestion.event} onCreated={onCreated} />;
  }
  if (suggestion.type === "task" && suggestion.task) {
    return <TaskCard suggestion={suggestion.task} projects={projects} onCreated={onCreated} />;
  }
  return null;
}
