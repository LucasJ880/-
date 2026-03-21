import { db } from "@/lib/db";
import {
  getEnvironmentByCodeInProject,
  getEnvironmentInProject,
} from "@/lib/prompts/scope";

export type ResolvedKnowledgeDocument = {
  documentId: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  status: string;
  sortOrder: number;
  content: string;
  summary: string | null;
};

export type ResolveKbResult =
  | {
      ok: true;
      knowledgeBaseId: string;
      key: string;
      name: string;
      environmentId: string;
      activeKbVersionId: string;
      activeKbVersionNumber: number;
      documents: ResolvedKnowledgeDocument[];
    }
  | { ok: false; reason: "not_found" | "no_active_version" | "environment_mismatch" };

/**
 * 按 projectId + environmentId + key 读取当前生效 KB 版本下的 active 文档内容列表
 */
export async function getActiveKnowledgeBase(
  projectId: string,
  environmentId: string,
  key: string
): Promise<ResolveKbResult> {
  const env = await getEnvironmentInProject(projectId, environmentId);
  if (!env) {
    return { ok: false, reason: "environment_mismatch" };
  }

  const kb = await db.knowledgeBase.findFirst({
    where: { projectId, environmentId, key, status: "active" },
    include: {
      activeVersion: true,
    },
  });

  if (!kb) {
    return { ok: false, reason: "not_found" };
  }
  if (!kb.activeVersionId || !kb.activeVersion) {
    return { ok: false, reason: "no_active_version" };
  }

  const snaps = await db.knowledgeDocumentVersion.findMany({
    where: {
      knowledgeBaseVersionId: kb.activeVersionId,
      document: { status: "active" },
    },
    include: {
      document: true,
    },
  });

  const sorted = [...snaps].sort((a, b) => {
    if (a.document.sortOrder !== b.document.sortOrder) {
      return a.document.sortOrder - b.document.sortOrder;
    }
    return a.document.createdAt.getTime() - b.document.createdAt.getTime();
  });

  return {
    ok: true,
    knowledgeBaseId: kb.id,
    key: kb.key,
    name: kb.name,
    environmentId: kb.environmentId,
    activeKbVersionId: kb.activeVersion!.id,
    activeKbVersionNumber: kb.activeVersion!.version,
    documents: sorted.map((s) => ({
      documentId: s.documentId,
      title: s.document.title,
      sourceType: s.document.sourceType,
      sourceUrl: s.document.sourceUrl,
      status: s.document.status,
      sortOrder: s.document.sortOrder,
      content: s.content,
      summary: s.summary,
    })),
  };
}

/**
 * 按环境 code（如 test / prod）解析 KB
 */
export async function resolveKnowledgeBaseByEnvCode(
  projectId: string,
  environmentCode: string,
  key: string
): Promise<ResolveKbResult> {
  const env = await getEnvironmentByCodeInProject(
    projectId,
    environmentCode.trim().toLowerCase()
  );
  if (!env) {
    return { ok: false, reason: "environment_mismatch" };
  }
  return getActiveKnowledgeBase(projectId, env.id, key);
}
