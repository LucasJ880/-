import { db } from "@/lib/db";
import type { CreateSupplierInput, UpdateSupplierInput } from "@/lib/inquiry/types";

// ============================================================
// Supplier CRUD 服务层
// ============================================================

export async function createSupplier(input: CreateSupplierInput, userId: string) {
  return db.supplier.create({
    data: {
      orgId: input.orgId,
      name: input.name.trim(),
      contactName: input.contactName?.trim() || null,
      contactEmail: input.contactEmail?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      category: input.category?.trim() || null,
      region: input.region?.trim() || null,
      notes: input.notes?.trim() || null,
      createdById: userId,
      brochureUrl: input.brochureUrl || null,
      brochureParseStatus: input.brochureParseStatus || null,
      brochureParseResult: input.brochureParseResult ? (input.brochureParseResult as object) : undefined,
      brochureParseWarning: input.brochureParseWarning || null,
    },
  });
}

export async function updateSupplier(supplierId: string, input: UpdateSupplierInput) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.contactName !== undefined)
    data.contactName = input.contactName?.trim() || null;
  if (input.contactEmail !== undefined)
    data.contactEmail = input.contactEmail?.trim() || null;
  if (input.contactPhone !== undefined)
    data.contactPhone = input.contactPhone?.trim() || null;
  if (input.category !== undefined)
    data.category = input.category?.trim() || null;
  if (input.region !== undefined) data.region = input.region?.trim() || null;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.status !== undefined) data.status = input.status;

  return db.supplier.update({ where: { id: supplierId }, data });
}

export async function getSupplier(supplierId: string) {
  return db.supplier.findUnique({ where: { id: supplierId } });
}

export async function listSuppliers(
  orgId: string,
  opts?: { status?: string; search?: string; page?: number; pageSize?: number }
) {
  const page = opts?.page ?? 1;
  const pageSize = Math.min(opts?.pageSize ?? 50, 200);

  const where: Record<string, unknown> = { orgId };
  if (opts?.status) where.status = opts.status;
  if (opts?.search) {
    where.OR = [
      { name: { contains: opts.search, mode: "insensitive" } },
      { contactName: { contains: opts.search, mode: "insensitive" } },
      { contactEmail: { contains: opts.search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    db.supplier.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { inquiryItems: true } },
        inquiryItems: {
          select: {
            status: true,
            isSelected: true,
            inquiry: { select: { projectId: true } },
          },
        },
      },
    }),
    db.supplier.count({ where }),
  ]);

  const enriched = data.map((s) => {
    const projectIds = new Set(s.inquiryItems.map((i) => i.inquiry.projectId));
    const quotedCount = s.inquiryItems.filter((i) => i.status === "quoted").length;
    const selectedCount = s.inquiryItems.filter((i) => i.isSelected).length;
    const { inquiryItems: _items, _count, ...rest } = s;
    return {
      ...rest,
      stats: {
        projectCount: projectIds.size,
        inquiryCount: _count.inquiryItems,
        quotedCount,
        selectedCount,
      },
    };
  });

  return { data: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

// ── 供应商项目履历 ──────────────────────────────────────────

export interface SupplierHistoryItem {
  projectId: string;
  projectName: string;
  roundNumber: number;
  inquiryStatus: string;
  itemStatus: string;
  totalPrice: string | null;
  currency: string;
  isSelected: boolean;
  createdAt: Date;
}

export async function getSupplierHistory(supplierId: string): Promise<SupplierHistoryItem[]> {
  const items = await db.inquiryItem.findMany({
    where: { supplierId },
    select: {
      status: true,
      totalPrice: true,
      currency: true,
      isSelected: true,
      createdAt: true,
      inquiry: {
        select: {
          roundNumber: true,
          status: true,
          project: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return items.map((item) => ({
    projectId: item.inquiry.project.id,
    projectName: item.inquiry.project.name,
    roundNumber: item.inquiry.roundNumber,
    inquiryStatus: item.inquiry.status,
    itemStatus: item.status,
    totalPrice: item.totalPrice?.toString() ?? null,
    currency: item.currency,
    isSelected: item.isSelected,
    createdAt: item.createdAt,
  }));
}

export async function deleteSupplier(supplierId: string) {
  const refs = await db.inquiryItem.count({ where: { supplierId } });
  if (refs > 0) {
    throw new Error("该供应商已被询价引用，无法删除，请将其设为停用状态");
  }
  return db.supplier.delete({ where: { id: supplierId } });
}
