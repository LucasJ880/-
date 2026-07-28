import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  TASK_STATUS_META,
  type TaskStatusValue,
} from "@/lib/tasks/status";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** @deprecated 优先使用 @/lib/tasks；保留兼容现有导入 */
export const TASK_STATUS = TASK_STATUS_META;

export const TASK_PRIORITY = {
  low: { label: "低", color: "bg-muted/15 text-muted" },
  medium: { label: "中", color: "bg-warning-bg text-warning" },
  high: { label: "高", color: "bg-warning-bg text-warning" },
  urgent: { label: "紧急", color: "bg-danger-bg text-danger" },
} as const;

export type TaskStatus = TaskStatusValue;
export type TaskPriority = keyof typeof TASK_PRIORITY;
