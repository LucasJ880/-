/**
 * FIX-3 组织设置（Organization.settingsJson）的写入入口
 *
 * 这一块 JSON 被很多功能共用：收信游标、Muse 偏好与绑定、询价设置、投标资料、日历监听、门店折扣……
 * 各自都是「读出整块、改一个键、把整块写回」。两处写入只要交错几毫秒，后写的就会用它读到的旧内容
 * 把先写的冲掉，而且没有任何报错。
 *
 * 规矩：写这一块之前先锁住该组织的行，在锁里读最新的内容、只改自己那一块、写回。
 *   - 独立的写入用 mutateOrgSettings；
 *   - 已经在事务里的写入，先 lockOrganizationRow(tx, orgId) 再读，或用 mutateOrgSettingsInTx。
 * 只改一部分写入方是不够的：不加锁的那一处照样能把别人的修改冲掉。
 * src/lib/organizations/__tests__/settings-write-guard.test.ts 会拦住绕开这里的新写入。
 *
 * 锁里只做「读一行、算、写一行」：fn 必须是同步的纯函数，不查库、不发请求。
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Tx = Prisma.TransactionClient;

/**
 * 锁住这个组织的行，直到事务结束。与既有的几处（斑马帘比例、质保设置、能力配额策略）是同一句，
 * 所以新旧写入方之间也互相等待。之后在同一事务里读到的 settingsJson 就是最新的。
 */
export async function lockOrganizationRow(tx: Tx, orgId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
}

/** fn 的返回：next = 要写回的整块（不给 = 这次不写）；result = 带回给调用方的东西 */
export type OrgSettingsMutation<T> = { next?: unknown; result: T };

export type MutateOrgSettingsResult<T> =
  | { found: false }
  | { found: true; written: boolean; before: unknown; after: unknown; result: T };

/** 在调用方已有的事务里：锁行 → 读最新 → fn 算出新的整块 → 写回 */
export async function mutateOrgSettingsInTx<T>(
  tx: Tx,
  orgId: string,
  fn: (current: unknown) => OrgSettingsMutation<T>,
): Promise<MutateOrgSettingsResult<T>> {
  await lockOrganizationRow(tx, orgId);
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) return { found: false };
  const before: unknown = org.settingsJson ?? null;
  const out = fn(before);
  if (out.next === undefined) return { found: true, written: false, before, after: before, result: out.result };
  await tx.organization.update({ where: { id: orgId }, data: { settingsJson: out.next as Prisma.InputJsonValue } });
  return { found: true, written: true, before, after: out.next, result: out.result };
}

/** 独立的写入：开一个短事务做上面那件事 */
export async function mutateOrgSettings<T>(
  orgId: string,
  fn: (current: unknown) => OrgSettingsMutation<T>,
): Promise<MutateOrgSettingsResult<T>> {
  return db.$transaction((tx) => mutateOrgSettingsInTx(tx, orgId, fn));
}
