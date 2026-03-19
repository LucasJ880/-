import { db } from "@/lib/db";
import { getEnvironmentInProject, getEnvironmentByCodeInProject } from "./scope";

export interface ResolvedActivePrompt {
  promptId: string;
  versionId: string;
  version: number;
  key: string;
  name: string;
  type: string;
  content: string;
}

export type ResolvePromptResult =
  | { ok: true; data: ResolvedActivePrompt }
  | { ok: false; reason: "not_found" | "no_active_version" | "archived" | "invalid_env" };

/**
 * 按 projectId + environmentId + key 读取当前生效 Prompt 内容（仅 activeVersion）
 */
export async function getActivePromptByKey(
  projectId: string,
  environmentId: string,
  key: string
): Promise<ResolvePromptResult> {
  const env = await getEnvironmentInProject(projectId, environmentId);
  if (!env) {
    return { ok: false, reason: "invalid_env" };
  }

  const prompt = await db.prompt.findFirst({
    where: {
      projectId,
      environmentId,
      key,
      status: "active",
    },
    include: {
      activeVersion: true,
    },
  });

  if (!prompt) {
    return { ok: false, reason: "not_found" };
  }

  if (prompt.status !== "active") {
    return { ok: false, reason: "archived" };
  }

  if (!prompt.activeVersionId || !prompt.activeVersion) {
    return { ok: false, reason: "no_active_version" };
  }

  return {
    ok: true,
    data: {
      promptId: prompt.id,
      versionId: prompt.activeVersion.id,
      version: prompt.activeVersion.version,
      key: prompt.key,
      name: prompt.name,
      type: prompt.type,
      content: prompt.activeVersion.content,
    },
  };
}

/**
 * 按环境 code（如 test / prod）解析，内部校验 environment 属于 project
 */
export async function resolveActivePromptByEnvCode(
  projectId: string,
  environmentCode: string,
  key: string
): Promise<ResolvePromptResult> {
  const env = await getEnvironmentByCodeInProject(projectId, environmentCode);
  if (!env) {
    return { ok: false, reason: "invalid_env" };
  }
  return getActivePromptByKey(projectId, env.id, key);
}
