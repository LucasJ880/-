/**
 * 项目会话 KB 上下文注入（A-P1，自 lib/runtime/kb-context.ts 收敛而来）
 *
 * 取知识库 active 版本的最近文档，拼为 prompt 注入片段。
 */

import { db } from "@/lib/db";

const MAX_DOCS = 5;
const MAX_CHARS_PER_DOC = 2000;
const MAX_TOTAL_CHARS = 6000;

export async function buildKBContext(
  knowledgeBaseId: string | null | undefined,
): Promise<string | null> {
  if (!knowledgeBaseId) return null;

  const kb = await db.knowledgeBase.findUnique({
    where: { id: knowledgeBaseId },
    select: { activeVersionId: true },
  });
  if (!kb?.activeVersionId) return null;

  const docs = await db.knowledgeDocument.findMany({
    where: { knowledgeBaseId, status: "active" },
    orderBy: { updatedAt: "desc" },
    take: MAX_DOCS,
    select: {
      title: true,
      versions: {
        where: { knowledgeBaseVersionId: kb.activeVersionId },
        take: 1,
        select: { content: true },
      },
    },
  });

  if (docs.length === 0) return null;

  let totalLen = 0;
  const parts: string[] = [];

  for (const doc of docs) {
    if (totalLen >= MAX_TOTAL_CHARS) break;
    const text = doc.versions[0]?.content ?? "";
    if (!text) continue;
    const truncated = text.slice(0, MAX_CHARS_PER_DOC);
    const chunk = `【${doc.title}】\n${truncated}${text.length > MAX_CHARS_PER_DOC ? "…" : ""}`;
    parts.push(chunk);
    totalLen += chunk.length;
  }

  return parts.join("\n\n");
}
