/**
 * 从助手回复中启发式提取 ProjectInsight 草稿（不调用额外模型，MVP）
 */

import { db } from "@/lib/db";

const KIND_PATTERNS: Array<{ kind: string; re: RegExp; title: string }> = [
  { kind: "risk", re: /最大风险|主要风险|风险在于|红线/, title: "识别到风险" },
  {
    kind: "advantage",
    re: /优势|竞争力|赢标|我方强项/,
    title: "识别到优势",
  },
  {
    kind: "decision",
    re: /建议推进|建议放弃|条件推进|不建议投标|建议投标/,
    title: "建议决定",
  },
  {
    kind: "next_step",
    re: /下一步|建议你|请先|需要确认/,
    title: "下一步建议",
  },
  {
    kind: "requirement",
    re: /强制|必须|Mandatory|Canadian (Supplier|Goods)/i,
    title: "强制/资格要求",
  },
];

export async function extractInsightsFromAssistantReply(input: {
  projectId: string;
  orgId: string | null | undefined;
  assistantText: string;
}): Promise<number> {
  const text = (input.assistantText || "").trim();
  if (text.length < 40) return 0;

  const created: string[] = [];
  for (const p of KIND_PATTERNS) {
    if (!p.re.test(text)) continue;
    const idx = text.search(p.re);
    const snippet = text.slice(Math.max(0, idx - 20), idx + 280).trim();
    if (snippet.length < 16) continue;

    const row = await db.projectInsight.create({
      data: {
        orgId: input.orgId || null,
        projectId: input.projectId,
        kind: p.kind,
        title: p.title,
        content: snippet,
        source: "chat",
        status: "draft",
      },
      select: { id: true },
    });
    created.push(row.id);
    if (created.length >= 3) break;
  }
  return created.length;
}
