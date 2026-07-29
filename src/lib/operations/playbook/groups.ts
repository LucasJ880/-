/**
 * 稳定账号组：groupKey 不随 displayName 变更
 * 兼容旧 MatrixAccount.groupName：按需 ensure，不删除旧字符串字段
 */

import { db } from "@/lib/db";

function slugifyGroupKey(displayName: string): string {
  const base = displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `group-${Date.now().toString(36)}`;
}

/** 确保 org 下存在组；返回稳定 id。不因改名改变 groupKey。 */
export async function ensureMatrixAccountGroup(input: {
  orgId: string;
  displayName: string;
  preferredKey?: string;
}): Promise<{ id: string; groupKey: string; displayName: string; created: boolean }> {
  const displayName = input.displayName.trim() || "默认组";
  const preferred = (input.preferredKey || slugifyGroupKey(displayName)).slice(
    0,
    80,
  );

  const byKey = await db.matrixAccountGroup.findUnique({
    where: { orgId_groupKey: { orgId: input.orgId, groupKey: preferred } },
  });
  if (byKey) {
    if (byKey.displayName !== displayName) {
      const updated = await db.matrixAccountGroup.update({
        where: { id: byKey.id },
        data: { displayName },
      });
      return {
        id: updated.id,
        groupKey: updated.groupKey,
        displayName: updated.displayName,
        created: false,
      };
    }
    return {
      id: byKey.id,
      groupKey: byKey.groupKey,
      displayName: byKey.displayName,
      created: false,
    };
  }

  // 同显示名已有组则复用（避免重复）
  const byName = await db.matrixAccountGroup.findFirst({
    where: { orgId: input.orgId, displayName },
  });
  if (byName) {
    return {
      id: byName.id,
      groupKey: byName.groupKey,
      displayName: byName.displayName,
      created: false,
    };
  }

  let groupKey = preferred;
  for (let i = 0; i < 5; i++) {
    try {
      const created = await db.matrixAccountGroup.create({
        data: {
          orgId: input.orgId,
          groupKey,
          displayName,
        },
      });
      return {
        id: created.id,
        groupKey: created.groupKey,
        displayName: created.displayName,
        created: true,
      };
    } catch {
      groupKey = `${preferred}-${i + 1}`;
    }
  }
  throw new Error("无法创建账号组");
}

/** 将账号挂到稳定组（同步 groupName 显示名，不改已有 groupKey） */
export async function linkAccountToGroup(input: {
  orgId: string;
  accountId: string;
  displayName: string;
}): Promise<string> {
  const group = await ensureMatrixAccountGroup({
    orgId: input.orgId,
    displayName: input.displayName,
  });
  await db.matrixAccount.update({
    where: { id: input.accountId },
    data: {
      groupId: group.id,
      groupName: group.displayName,
    },
  });
  return group.id;
}
