/**
 * Phase 2B：企业 Glossary — 禁止跨企业召回，禁止静默套用其他 Pack 术语
 */

import { db } from "@/lib/db";
import type { ConfigScope } from "@/lib/tenancy/scope";

export type GlossaryLookupStatus = "ok" | "missing";

export type GlossaryTermView = {
  id: string;
  orgId: string;
  workspaceId: string | null;
  canonicalTerm: string;
  displayName: string;
  aliases: string[];
  category: string;
  language: string;
  version: number;
  sourceScope: ConfigScope;
};

function asAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export async function lookupGlossaryTerm(params: {
  orgId: string;
  workspaceId?: string | null;
  query: string;
  language?: string;
}): Promise<{
  status: GlossaryLookupStatus;
  term: GlossaryTermView | null;
  message?: string;
}> {
  const q = params.query.trim();
  if (!q) {
    return { status: "missing", term: null, message: "空查询" };
  }

  const now = new Date();
  const lang = params.language;

  // Workspace 覆盖优先
  if (params.workspaceId) {
    const wsHit = await findInScope({
      orgId: params.orgId,
      scopeKey: params.workspaceId,
      workspaceId: params.workspaceId,
      q,
      lang,
      now,
      sourceScope: "WORKSPACE",
    });
    if (wsHit) return { status: "ok", term: wsHit };
  }

  const orgHit = await findInScope({
    orgId: params.orgId,
    scopeKey: "org",
    workspaceId: null,
    q,
    lang,
    now,
    sourceScope: "ORGANIZATION",
  });
  if (orgHit) return { status: "ok", term: orgHit };

  return {
    status: "missing",
    term: null,
    message: "未配置该术语（禁止回退其他企业或 Industry Pack 术语）",
  };
}

async function findInScope(params: {
  orgId: string;
  scopeKey: string;
  workspaceId: string | null;
  q: string;
  lang?: string;
  now: Date;
  sourceScope: ConfigScope;
}): Promise<GlossaryTermView | null> {
  const rows = await db.organizationGlossaryTerm.findMany({
    where: {
      orgId: params.orgId,
      scopeKey: params.scopeKey,
      status: "active",
      effectiveFrom: { lte: params.now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: params.now } }],
      ...(params.lang ? { language: params.lang } : {}),
    },
  });

  const qLower = params.q.toLowerCase();
  for (const row of rows) {
    const aliases = asAliases(row.aliasesJson);
    const names = [row.canonicalTerm, row.displayName, ...aliases];
    if (names.some((n) => n.toLowerCase() === qLower)) {
      return {
        id: row.id,
        orgId: row.orgId,
        workspaceId: row.workspaceId,
        canonicalTerm: row.canonicalTerm,
        displayName: row.displayName,
        aliases,
        category: row.category,
        language: row.language,
        version: row.version,
        sourceScope: params.sourceScope,
      };
    }
  }
  return null;
}

export async function listGlossaryForOrg(params: {
  orgId: string;
  workspaceId?: string | null;
}): Promise<GlossaryTermView[]> {
  const now = new Date();
  const scopeKeys = params.workspaceId
    ? ["org", params.workspaceId]
    : ["org"];
  const rows = await db.organizationGlossaryTerm.findMany({
    where: {
      orgId: params.orgId,
      status: "active",
      scopeKey: { in: scopeKeys },
      effectiveFrom: { lte: now },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      ],
    },
    orderBy: [{ category: "asc" }, { canonicalTerm: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    canonicalTerm: row.canonicalTerm,
    displayName: row.displayName,
    aliases: asAliases(row.aliasesJson),
    category: row.category,
    language: row.language,
    version: row.version,
    sourceScope: (row.scopeKey === "org" ? "ORGANIZATION" : "WORKSPACE") as ConfigScope,
  }));
}

export async function upsertGlossaryTerm(params: {
  orgId: string;
  workspaceId?: string | null;
  canonicalTerm: string;
  displayName: string;
  aliases?: string[];
  category?: string;
  language?: string;
  description?: string;
  createdById?: string;
}): Promise<{ id: string; version: number }> {
  const scopeKey = params.workspaceId ?? "org";
  const language = params.language ?? "zh";
  const existing = await db.organizationGlossaryTerm.findUnique({
    where: {
      orgId_scopeKey_canonicalTerm_language: {
        orgId: params.orgId,
        scopeKey,
        canonicalTerm: params.canonicalTerm,
        language,
      },
    },
  });

  if (existing) {
    const updated = await db.organizationGlossaryTerm.update({
      where: { id: existing.id },
      data: {
        displayName: params.displayName,
        aliasesJson: params.aliases ?? [],
        category: params.category ?? existing.category,
        description: params.description,
        version: existing.version + 1,
      },
    });
    return { id: updated.id, version: updated.version };
  }

  const created = await db.organizationGlossaryTerm.create({
    data: {
      orgId: params.orgId,
      workspaceId: params.workspaceId ?? null,
      scopeKey,
      canonicalTerm: params.canonicalTerm,
      displayName: params.displayName,
      aliasesJson: params.aliases ?? [],
      category: params.category ?? "general",
      language,
      description: params.description,
      createdById: params.createdById,
    },
  });
  return { id: created.id, version: created.version };
}
