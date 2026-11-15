/**
 * RFQ-AUTO-5 供应商分组（DB 侧）
 *
 * 一个人在一个组织里一份分组。状态 = 他最近一条保存记录（只追加，记录即状态）——
 * 不新增表与字段，不放进组织设置的 JSON（那里是整块读改写，会互相覆盖）。
 * 记录的 id 就是「这一版的标识」：保存时带上读到的那一版，库里最新的不是它就拒绝，不覆盖。
 * 本文件不发信、不建审批卡。
 */
import { db } from "@/lib/db";
import { isRfqSupplierGroupsEnabledForOrg } from "./supplier-groups-flags";
import {
  EMPTY_SUPPLIER_GROUPS,
  SUPPLIER_GROUPS_AUDIT_ACTION,
  SUPPLIER_GROUPS_TARGET,
  buildSupplierGroupsEntry,
  readStoredSupplierGroups,
  sameSupplierGroups,
  supplierIdsInGroups,
  validateSupplierGroups,
  type SupplierGroupsDoc,
  type SupplierGroupsEntry,
} from "./supplier-groups";
import { orderEntrySuppliers } from "./web-entry-pure";

export type StoredSupplierGroups = {
  doc: SupplierGroupsDoc;
  version: string | null;
  /** 有保存记录，但内容读不出来（不是分组的样子）。这不等于「他没有分组」：自动起草据此不起草，而不是退回常用供应商 */
  unreadable?: boolean;
};

type Reader = Pick<typeof db, "auditLog">;
type LatestRow = { id: string; createdAt: Date; afterData: string | null };

async function readLatestRow(client: Reader, orgId: string, userId: string): Promise<LatestRow | null> {
  // 只读他自己的、只读这个组织的。「最近」按记录时间排——保存时保证每条都比上一条晚（见 saveSupplierGroups）
  return client.auditLog.findFirst({
    where: { orgId, userId, action: SUPPLIER_GROUPS_AUDIT_ACTION, targetType: SUPPLIER_GROUPS_TARGET, targetId: userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, createdAt: true, afterData: true },
  });
}

function toStored(row: LatestRow | null): StoredSupplierGroups {
  if (!row) return { doc: EMPTY_SUPPLIER_GROUPS, version: null };
  const read = readStoredSupplierGroups(row.afterData);
  return { doc: read.doc, version: row.id, ...(read.readable ? {} : { unreadable: true }) };
}

async function readLatest(client: Reader, orgId: string, userId: string): Promise<StoredSupplierGroups> {
  return toStored(await readLatestRow(client, orgId, userId));
}

/** 这个人保存的分组，不看功能开关（保存与冲突处理用） */
export async function loadStoredSupplierGroups(orgId: string, userId: string): Promise<StoredSupplierGroups> {
  return readLatest(db, orgId, userId);
}

/** 现在生效的分组：功能关闭 → 没有分组，且不查库 */
export async function loadActiveSupplierGroups(orgId: string, userId: string): Promise<StoredSupplierGroups> {
  if (!isRfqSupplierGroupsEnabledForOrg(orgId)) return { doc: EMPTY_SUPPLIER_GROUPS, version: null };
  return readLatest(db, orgId, userId);
}

export type SaveSupplierGroupsResult =
  | { ok: true; doc: SupplierGroupsDoc; version: string | null; changed: boolean }
  | { ok: false; errorCode: "DISABLED" | "INVALID" | "FOREIGN_SUPPLIER"; message: string }
  | { ok: false; errorCode: "VERSION_CONFLICT"; message: string; current: StoredSupplierGroups };

/**
 * 整份保存本人的分组。调用方负责项目写权限与「userId 就是登录的那个人」。
 * 在一个短事务里：取本人的事务级锁 → 读最近一条 → 不是请求方基于的那一版就拒绝 → 追加一条记录。
 * 事务里只有这几条语句，不包任何别的调用。
 */
export async function saveSupplierGroups(input: {
  orgId: string;
  projectId: string;
  userId: string;
  /** 请求方读到的那一版；从没保存过为 null */
  baseVersion: string | null;
  groups: unknown;
}): Promise<SaveSupplierGroupsResult> {
  if (!isRfqSupplierGroupsEnabledForOrg(input.orgId)) {
    return { ok: false, errorCode: "DISABLED", message: "供应商分组还没有对你的组织开放。" };
  }
  const validated = validateSupplierGroups(input.groups);
  if (!validated.ok) return { ok: false, errorCode: "INVALID", message: validated.error };
  const next = validated.doc;

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`rfq-supplier-groups:${input.orgId}:${input.userId}`}))) AS l`;
    const latestRow = await readLatestRow(tx, input.orgId, input.userId);
    const current = toStored(latestRow);
    if (current.version !== input.baseVersion) {
      return { ok: false as const, errorCode: "VERSION_CONFLICT" as const, message: "分组在别处被改过了，已换成最新的。请再操作一次。", current };
    }
    if (sameSupplierGroups(current.doc, next)) return { ok: true as const, doc: current.doc, version: current.version, changed: false };

    // 新加进来的供应商必须属于这个组织；这一版里本来就有的不再查（它们加入时查过；之后被删掉的供应商不应卡住别的修改）
    const known = new Set(supplierIdsInGroups(current.doc));
    const added = supplierIdsInGroups(next).filter((id) => !known.has(id));
    if (added.length) {
      const found = await tx.supplier.count({ where: { orgId: input.orgId, id: { in: added } } });
      if (found !== added.length) {
        return { ok: false as const, errorCode: "FOREIGN_SUPPLIER" as const, message: "有供应商不在你的组织里，没有保存。" };
      }
    }

    // 记录时间由应用服务器的时钟给出：两台机器的时钟有先后，或时钟被往回拨，新写的一条就可能排在旧的后面、
    // 「最近一条」仍是旧的。所以这里明确给时间：至少比上一条晚 1 毫秒（已经持有本人的锁，不会有并发的写入）。
    const createdAt = new Date(Math.max(Date.now(), (latestRow?.createdAt.getTime() ?? 0) + 1));
    // 直接写这一条（而不是经 writeAuditLog）是为了能指定时间并拿回记录号；字段与它写的相同
    const row = await tx.auditLog.create({
      data: {
        userId: input.userId,
        orgId: input.orgId,
        projectId: input.projectId,
        action: SUPPLIER_GROUPS_AUDIT_ACTION,
        targetType: SUPPLIER_GROUPS_TARGET,
        targetId: input.userId,
        beforeData: JSON.stringify({ groups: current.doc.groups, version: current.version }),
        afterData: JSON.stringify({ groups: next.groups }),
        createdAt,
      },
      select: { id: true },
    });
    return { ok: true as const, doc: next, version: row.id, changed: true };
  });
}

/**
 * 接口响应用：把一份分组配上「每组现在几家可选」与「这个项目对上了哪一组」。
 * 就绪规则用询价入口的同一个函数（orderEntrySuppliers）。
 */
export async function buildSupplierGroupsEntryFor(input: { orgId: string; projectId: string; stored: StoredSupplierGroups }): Promise<SupplierGroupsEntry> {
  const ids = supplierIdsInGroups(input.stored.doc);
  const [project, rows] = await Promise.all([
    db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { name: true } }),
    ids.length ? db.supplier.findMany({ where: { orgId: input.orgId, id: { in: ids } }, select: { id: true, name: true, contactEmail: true, status: true } }) : Promise.resolve([]),
  ]);
  return buildSupplierGroupsEntry({
    doc: input.stored.doc,
    version: input.stored.version,
    projectName: project?.name ?? null,
    readySupplierIds: new Set(orderEntrySuppliers(rows, []).filter((s) => s.ready).map((s) => s.id)),
  });
}
