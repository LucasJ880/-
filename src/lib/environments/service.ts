import { db } from "@/lib/db";
import type { TenantScope } from "@/lib/common/types";
import { DEFAULT_ENVIRONMENTS } from "@/lib/common/constants";

// ============================================================
// Environments 服务层
// ============================================================

/** 获取项目下的所有环境（多租户隔离查询） */
export async function listEnvironments(scope: Pick<TenantScope, "projectId">) {
  return db.environment.findMany({
    where: { projectId: scope.projectId!, status: "active" },
    orderBy: { createdAt: "asc" },
  });
}

/** 获取单个环境 */
export async function getEnvironmentById(
  projectId: string,
  envId: string
) {
  return db.environment.findFirst({
    where: { id: envId, projectId },
  });
}

/** 通过 code 获取环境 */
export async function getEnvironmentByCode(
  projectId: string,
  code: string
) {
  return db.environment.findFirst({
    where: { projectId, code },
  });
}

/** 创建自定义环境 */
export async function createEnvironment(input: {
  projectId: string;
  name: string;
  code: string;
}) {
  return db.environment.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      code: input.code,
    },
  });
}

/** 为项目初始化默认环境（test + prod） */
export async function initDefaultEnvironments(projectId: string) {
  const envs = [];
  for (const env of DEFAULT_ENVIRONMENTS) {
    const existing = await db.environment.findFirst({
      where: { projectId, code: env.code },
    });
    if (!existing) {
      envs.push(
        await db.environment.create({
          data: { projectId, name: env.name, code: env.code },
        })
      );
    }
  }
  return envs;
}

/** 归档环境（不删除，避免关联数据丢失） */
export async function archiveEnvironment(
  projectId: string,
  envId: string
) {
  return db.environment.update({
    where: { id: envId, projectId },
    data: { status: "archived" },
  });
}

/** 检查环境 code 是否已存在 */
export async function isEnvCodeTaken(
  projectId: string,
  code: string
): Promise<boolean> {
  const count = await db.environment.count({
    where: { projectId, code },
  });
  return count > 0;
}
