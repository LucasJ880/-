import type { WorkSuggestion } from "@/lib/ai/schemas";

export interface SimpleProject {
  id: string;
  name: string;
}

export interface WorkSuggestionCardProps {
  suggestion: WorkSuggestion;
  projects?: SimpleProject[];
  projectId?: string;
  onCreated?: () => void;
}

export const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-[rgba(110,125,118,0.06)] text-[#6e7d76] border-[rgba(110,125,118,0.15)]",
  medium: "bg-[rgba(154,106,47,0.04)] text-[#9a6a2f] border-[rgba(154,106,47,0.15)]",
  high: "bg-[rgba(176,106,40,0.04)] text-[#b06a28] border-[rgba(176,106,40,0.15)]",
  urgent: "bg-[rgba(166,61,61,0.04)] text-[#a63d3d] border-[rgba(166,61,61,0.15)]",
};
