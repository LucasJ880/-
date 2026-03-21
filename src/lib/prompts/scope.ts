import { db } from "@/lib/db";
import type { Environment } from "@prisma/client";

/**
 * 校验 environment 属于指定 project；否则返回 null
 */
export async function getEnvironmentInProject(
  projectId: string,
  environmentId: string
): Promise<Environment | null> {
  const env = await db.environment.findFirst({
    where: { id: environmentId, projectId },
  });
  return env ?? null;
}

export async function getEnvironmentByCodeInProject(
  projectId: string,
  code: string
): Promise<Environment | null> {
  return db.environment.findFirst({
    where: { projectId, code },
  });
}
