import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export const TASK_STATUS = {
  todo: { label: "待办", color: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
  in_progress: { label: "进行中", color: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]" },
  done: { label: "已完成", color: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]" },
  cancelled: { label: "已取消", color: "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" },
} as const;

export const TASK_PRIORITY = {
  low: { label: "低", color: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]" },
  medium: { label: "中", color: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]" },
  high: { label: "高", color: "bg-[rgba(176,106,40,0.08)] text-[#b06a28]" },
  urgent: { label: "紧急", color: "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" },
} as const;

export type TaskStatus = keyof typeof TASK_STATUS;
export type TaskPriority = keyof typeof TASK_PRIORITY;
