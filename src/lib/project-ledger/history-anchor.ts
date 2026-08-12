/**
 * Project History Anchor — 统一并发安全契约（T3.5 Foundation Hardening §5/§6/§11）
 *
 * 背景不变式（对任何受支持的业务路径必须恒成立）：
 *
 *   NOT ( Project 缺失 AND 存在权威项目历史 )
 *   其中权威项目历史 = ProjectEvent | ProjectCost | TenderArchiveItem
 *
 * 四表刻意无 Project FK（项目硬删不级联抹史），因此 Project 行是「授权/归档锚」。
 * 若 hard delete 与 ledger writer 并发且不加锁，存在 TOCTOU 窗口：
 *   Writer 读到 Project 存在 → Delete 查历史=0 → Delete 删 Project → Writer 追加历史
 *   结果 Project 缺失但历史 > 0（orphan 授权锚）。
 *
 * 锁契约（PostgreSQL row lock，语义最小）：
 *   Writer 端：创建任何权威历史前，对 Project 行取 FOR KEY SHARE。
 *              多个 writer 之间 FKS 相互兼容 → 保持并发（不牺牲吞吐）。
 *   Delete 端：进入删除事务后，对 Project 行取 FOR UPDATE，再在同一事务内查历史 + 删除。
 *              FOR UPDATE 与 writer 的 FOR KEY SHARE 互斥 → 关闭 TOCTOU 窗口：
 *                · Writer 先持锁：Delete 的 FOR UPDATE 阻塞至 writer 提交 → 删除侧随后看到历史 → 409。
 *                · Delete 先持锁：Writer 的 FOR KEY SHARE 阻塞至删除提交 → 锚已消失 → writer 读到 0 行
 *                  → 抛 LedgerTenantError → writer 事务整体回滚（不产生 orphan）。
 *
 * 未来任何 authoritative history writer（含尚未实现的 Archive writer）都必须遵守本契约：
 *   在写历史前于同事务调用 lockProjectHistoryAnchorShared。
 */
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Writer 侧锚点锁：对 Project 行取 FOR KEY SHARE（org 精确匹配）。
 * 返回 true = 行存在且属于该 org（已持锁）；false = 不存在/跨 org（调用方应抛租户错误）。
 * 必须在同一事务内、创建任何权威历史之前调用。
 */
export async function lockProjectHistoryAnchorShared(
  tx: Tx,
  orgId: string,
  projectId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Project"
    WHERE "id" = ${projectId} AND "orgId" = ${orgId}
    FOR KEY SHARE
  `;
  return rows.length > 0;
}

/**
 * Delete 侧锚点锁：对 Project 行取 FOR UPDATE。
 * 返回 true = 行存在（已持锁）；false = 已被并发删除（调用方按不存在处理）。
 * 必须在删除事务内、查询历史与执行删除之前调用。
 */
export async function lockProjectHistoryAnchorForDelete(
  tx: Tx,
  projectId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Project"
    WHERE "id" = ${projectId}
    FOR UPDATE
  `;
  return rows.length > 0;
}

export interface ProjectHistoryCounts {
  events: number;
  costs: number;
  archive: number;
  total: number;
}

/**
 * 在删除事务内（取得 FOR UPDATE 锚锁之后）统计权威历史。
 * 顺序执行（interactive tx 单连接，避免同连接并发查询问题）。
 * 只应在 SCHEMA_READY 时调用——SCHEMA_READY=false 时禁止访问 M1 表。
 */
export async function countProjectAuthoritativeHistory(
  tx: Tx,
  projectId: string,
): Promise<ProjectHistoryCounts> {
  const events = await tx.projectEvent.count({ where: { projectId } });
  const costs = await tx.projectCost.count({ where: { projectId } });
  const archive = await tx.tenderArchiveItem.count({ where: { projectId } });
  return { events, costs, archive, total: events + costs + archive };
}
