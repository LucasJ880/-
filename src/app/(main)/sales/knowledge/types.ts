export interface Playbook {
  id: string;
  channel: string;
  language: string;
  scene: string;
  sceneLabel: string;
  content: string;
  example: string | null;
  effectiveness: number;
  tags: string | null;
  usageCount: number;
  createdAt: string;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  language: string;
  category: string;
  categoryLabel: string;
  productTags: string | null;
  frequency: number;
  createdAt: string;
}

export type Tab = "playbooks" | "faqs" | "rag";
