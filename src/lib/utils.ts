import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export const TASK_STATUS = {
  todo: { label: "待办", color: "bg-slate-100 text-slate-700" },
  in_progress: { label: "进行中", color: "bg-blue-100 text-blue-700" },
  done: { label: "已完成", color: "bg-green-100 text-green-700" },
  cancelled: { label: "已取消", color: "bg-red-100 text-red-700" },
} as const;

export const TASK_PRIORITY = {
  low: { label: "低", color: "bg-slate-100 text-slate-600" },
  medium: { label: "中", color: "bg-yellow-100 text-yellow-700" },
  high: { label: "高", color: "bg-orange-100 text-orange-700" },
  urgent: { label: "紧急", color: "bg-red-100 text-red-700" },
} as const;

export type TaskStatus = keyof typeof TASK_STATUS;
export type TaskPriority = keyof typeof TASK_PRIORITY;
