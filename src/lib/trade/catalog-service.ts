import { db } from "@/lib/db";
import { logActivity } from "@/lib/trade/activity-log";
import {
  CATALOG_FACT_FOB,
  CATALOG_FACT_LEAD,
  CATALOG_FACT_MOQ,
  commercialFromFacts,
  formatFobPrice,
  formatLeadTimeDays,
  normalizeCatalogDraft,
  type CatalogDraft,
} from "@/lib/trade/catalog";

const FACT_KEYS = [CATALOG_FACT_FOB, CATALOG_FACT_MOQ, CATALOG_FACT_LEAD];

export type CatalogListItem = {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  status: string;
  fobPrice: number | null;
  moq: string | null;
  leadTimeDays: number | null;
};

function toItem(row: {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  status: string;
  facts: { fieldKey: string; value: unknown; status: string }[];
}): CatalogListItem {
  const commercial = commercialFromFacts(row.facts);
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    nameEn: row.nameEn,
    status: row.status,
    ...commercial,
  };
}

const factSelect = {
  where: { fieldKey: { in: FACT_KEYS }, status: { in: ["confirmed", "extracted", "needs_review"] } },
  select: { fieldKey: true, value: true, status: true },
} as const;

export async function listTradeCatalog(orgId: string): Promise<CatalogListItem[]> {
  const rows = await db.tradeProduct.findMany({
    where: { orgId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      sku: true,
      name: true,
      nameEn: true,
      status: true,
      facts: factSelect,
    },
  });
  return rows.map(toItem);
}

async function writeFact(input: {
  orgId: string;
  productId: string;
  userId: string;
  fieldKey: string;
  value: string | null;
}) {
  const existing = await db.productFact.findFirst({
    where: {
      orgId: input.orgId,
      productId: input.productId,
      fieldKey: input.fieldKey,
      sourceType: "manual",
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!input.value) {
    if (existing && existing.status !== "rejected") {
      await db.productFact.update({
        where: { id: existing.id },
        data: { status: "rejected", value: "" },
      });
    }
    return;
  }
  const data = {
    value: input.value,
    status: "confirmed",
    confirmedById: input.userId,
    confirmedAt: new Date(),
    locked: true,
  };
  if (existing) {
    await db.productFact.update({ where: { id: existing.id }, data });
    return;
  }
  await db.productFact.create({
    data: {
      orgId: input.orgId,
      productId: input.productId,
      fieldKey: input.fieldKey,
      sourceType: "manual",
      confidence: 1,
      ...data,
    },
  });
}

async function writeCommercial(orgId: string, productId: string, userId: string, draft: CatalogDraft) {
  await writeFact({
    orgId,
    productId,
    userId,
    fieldKey: CATALOG_FACT_FOB,
    value: draft.fobPrice == null ? null : formatFobPrice(draft.fobPrice),
  });
  await writeFact({
    orgId,
    productId,
    userId,
    fieldKey: CATALOG_FACT_MOQ,
    value: draft.moq,
  });
  await writeFact({
    orgId,
    productId,
    userId,
    fieldKey: CATALOG_FACT_LEAD,
    value: draft.leadTimeDays == null ? null : formatLeadTimeDays(draft.leadTimeDays),
  });
}

async function reload(orgId: string, productId: string) {
  const row = await db.tradeProduct.findFirst({
    where: { id: productId, orgId },
    select: {
      id: true,
      sku: true,
      name: true,
      nameEn: true,
      status: true,
      facts: factSelect,
    },
  });
  return row ? toItem(row) : null;
}

export async function createTradeCatalogItem(input: {
  orgId: string;
  userId: string;
  body: Record<string, unknown>;
}) {
  const parsed = normalizeCatalogDraft(input.body);
  if (!parsed.ok) return { ok: false as const, error: parsed.error, status: 400 };
  const draft = parsed.draft;
  const dup = await db.tradeProduct.findFirst({
    where: { orgId: input.orgId, sku: draft.sku },
    select: { id: true },
  });
  if (dup) return { ok: false as const, error: "这个货号已经有了", status: 409 };

  const row = await db.tradeProduct.create({
    data: {
      orgId: input.orgId,
      sku: draft.sku,
      name: draft.name,
      nameEn: draft.nameEn,
      status: draft.status,
      industryPack: "home_textile",
      createdById: input.userId,
    },
  });
  await writeCommercial(input.orgId, row.id, input.userId, draft);
  await logActivity({
    orgId: input.orgId,
    action: "catalog_create",
    detail: `货号 ${draft.sku} ${draft.name}`,
    meta: { productId: row.id },
  });
  const item = await reload(input.orgId, row.id);
  return { ok: true as const, item };
}

export async function updateTradeCatalogItem(input: {
  orgId: string;
  userId: string;
  productId: string;
  body: Record<string, unknown>;
}) {
  const current = await db.tradeProduct.findFirst({
    where: { id: input.productId, orgId: input.orgId },
  });
  if (!current) return { ok: false as const, error: "货号不存在", status: 404 };

  const touchesCommercial =
    "fobPrice" in input.body || "moq" in input.body || "leadTimeDays" in input.body;
  const parsed = normalizeCatalogDraft({
    sku: input.body.sku ?? current.sku,
    name: input.body.name ?? current.name,
    nameEn: input.body.nameEn ?? current.nameEn ?? "",
    fobPrice: "fobPrice" in input.body ? input.body.fobPrice : undefined,
    moq: "moq" in input.body ? input.body.moq : undefined,
    leadTimeDays: "leadTimeDays" in input.body ? input.body.leadTimeDays : undefined,
    status: input.body.status ?? current.status,
  });
  if (!parsed.ok) return { ok: false as const, error: parsed.error, status: 400 };
  const draft = parsed.draft;
  if (draft.sku !== current.sku) {
    const dup = await db.tradeProduct.findFirst({
      where: { orgId: input.orgId, sku: draft.sku },
      select: { id: true },
    });
    if (dup) return { ok: false as const, error: "这个货号已经有了", status: 409 };
  }

  await db.tradeProduct.update({
    where: { id: current.id },
    data: {
      sku: draft.sku,
      name: draft.name,
      nameEn: draft.nameEn,
      status: draft.status,
    },
  });
  if (touchesCommercial) {
    await writeCommercial(input.orgId, current.id, input.userId, draft);
  }
  await logActivity({
    orgId: input.orgId,
    action: "catalog_update",
    detail: `货号 ${draft.sku} ${draft.status === "archived" ? "停用" : "更新"}`,
    meta: { productId: current.id },
  });
  const item = await reload(input.orgId, current.id);
  return { ok: true as const, item };
}
