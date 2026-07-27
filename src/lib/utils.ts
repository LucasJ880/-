import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TASK_STATUS = {
  todo: { label: "待办", color: "bg-muted/15 text-muted" },
  in_progress: { label: "进行中", color: "bg-accent-soft text-accent" },
  done: { label: "已完成", color: "bg-success-bg text-success" },
  cancelled: { label: "已取消", color: "bg-danger-bg text-danger" },
} as const;

export const TASK_PRIORITY = {
  low: { label: "低", color: "bg-muted/15 text-muted" },
  medium: { label: "中", color: "bg-warning-bg text-warning" },
  high: { label: "高", color: "bg-warning-bg text-warning" },
  urgent: { label: "紧急", color: "bg-danger-bg text-danger" },
} as const;

export type TaskStatus = keyof typeof TASK_STATUS;
export type TaskPriority = keyof typeof TASK_PRIORITY;
