/**
 * M1 — 外部情报：加拿大政府合同披露（open.canada.ca CKAN datastore）
 *
 * 证据纪律：每条 finding 携带来源 URL + 原始记录；AI/系统绝不发明中标方或金额。
 * 查询只读公开数据；出站行为由 TENDER_EXTERNAL_INTEL_ENABLED 总闸控制（默认 OFF）。
 *
 * 数据源（已在线验证 schema）：
 *   GET https://open.canada.ca/data/en/api/3/action/datastore_search
 *       ?resource_id=<contracts resource>&q=<keyword>&limit=N
 *   字段：vendor_name / description_en / contract_value / contract_date /
 *         buyer_name / reference_number / owner_org_title …
 *   默认 resource 为「Contracts over $10,000」datastore 子集；可用
 *   EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID 指向更全资源（UAT 配置步骤）。
 */

import { toAmountNumber } from "./awards";

export const EXTERNAL_INTEL_FLAG = "TENDER_EXTERNAL_INTEL_ENABLED" as const;

export function isExternalIntelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[EXTERNAL_INTEL_FLAG] ?? "").trim() === "1";
}

const CKAN_BASE = "https://open.canada.ca/data/en/api/3/action/datastore_search";
/**
 * 阶段3（用户定的首源）：联邦「Contracts over $10,000」全量披露资源
 * （1.31M 行，2026-08-20 实证含 334 条 Meltwater 合同、精确命中 ESDC $42,540.75）。
 * env EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID 可覆盖；默认即全量集。
 * 查询语法：datastore_search 的 field-scoped JSON q（全文 q 在此资源失灵——实测）。
 */
const CONTRACTS_FULL_RESOURCE = "fac950c0-00d5-4ec1-a4d3-9cbebf98a305";

export type VendorContractRow = {
  vendorName: string;
  contractValue: number | null;
  contractDate: string | null;
  buyer: string | null;
  descriptionEn: string | null;
  referenceNumber: string | null;
};

export type VendorContractsResult = {
  ok: boolean;
  total: number;
  rows: VendorContractRow[];
  note?: string;
  fetchedAt: string;
};

/** 供应商价格带汇总（纯函数，供 memo 输入与 UI；金额缺失行不计入统计） */
export function summarizeVendorContracts(rows: VendorContractRow[]): {
  sampleSize: number;
  min: number | null;
  max: number | null;
  median: number | null;
  recent: VendorContractRow[];
} {
  const vals = rows
    .map((r) => r.contractValue)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  const median =
    vals.length === 0
      ? null
      : vals.length % 2
        ? vals[(vals.length - 1) / 2]
        : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  const recent = [...rows]
    .filter((r) => r.contractDate)
    .sort((a, b) => (b.contractDate ?? "").localeCompare(a.contractDate ?? ""))
    .slice(0, 5);
  return {
    sampleSize: vals.length,
    min: vals[0] ?? null,
    max: vals[vals.length - 1] ?? null,
    median,
    recent,
  };
}

/**
 * 按供应商名查联邦合同披露（现任供应商价格带对标——把用户手工验证过的
 * 「查供应商政府合同价」收编为自动动作）。flag 门与 M1 相同；失败温和降级。
 */
export async function searchContractsByVendor(input: {
  vendor: string;
  limit?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<VendorContractsResult> {
  const env = input.env ?? process.env;
  const fetchedAt = new Date().toISOString();
  if (!isExternalIntelEnabled(env)) {
    return { ok: false, total: 0, rows: [], note: "外部情报开关未启用", fetchedAt };
  }
  const vendor = input.vendor.trim();
  if (!vendor) return { ok: false, total: 0, rows: [], note: "缺少供应商名", fetchedAt };
  const resource =
    env.EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID?.trim() || CONTRACTS_FULL_RESOURCE;
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const q = encodeURIComponent(JSON.stringify({ vendor_name: vendor }));
    const url = `${CKAN_BASE}?resource_id=${resource}&limit=${Math.min(input.limit ?? 60, 100)}&q=${q}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await doFetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, total: 0, rows: [], note: `CKAN ${res.status}`, fetchedAt };
    }
    const json = (await res.json()) as {
      result?: { total?: number; records?: Array<Record<string, unknown>> };
    };
    const rows: VendorContractRow[] = (json.result?.records ?? []).map((r) => ({
      vendorName: String(r.vendor_name ?? ""),
      contractValue: toAmountNumber(r.contract_value),
      contractDate: r.contract_date ? String(r.contract_date).slice(0, 10) : null,
      buyer: r.owner_org_title
        ? String(r.owner_org_title)
        : r.buyer_name
          ? String(r.buyer_name)
          : null,
      descriptionEn: r.description_en ? String(r.description_en).slice(0, 160) : null,
      referenceNumber: r.reference_number ? String(r.reference_number) : null,
    }));
    return { ok: true, total: json.result?.total ?? rows.length, rows, fetchedAt };
  } catch (e) {
    return {
      ok: false, total: 0, rows: [],
      note: e instanceof Error ? e.message.slice(0, 120) : "fetch failed",
      fetchedAt,
    };
  }
}
const DEFAULT_RESOURCE = "7f9b18ca-f627-4852-93d5-69adeb9437d6";
const TIMEOUT_MS = 25_000;
const MAX_RESULTS = 20;

export type AwardFinding = {
  source: "open_canada_contracts";
  vendorName: string;
  descriptionEn: string | null;
  contractValue: number | null;
  currency: "CAD";
  contractDate: string | null;
  buyerName: string | null;
  ownerOrg: string | null;
  referenceNumber: string | null;
  /** 可点开核验的来源 URL（CKAN 查询本身） */
  sourceUrl: string;
  raw: Record<string, unknown>;
};

export type AwardHistoryResult = {
  ok: boolean;
  total: number;
  findings: AwardFinding[];
  /** 失败/降级原因（不含 secret） */
  note: string | null;
};

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}
function toStr(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/* ------------------------- M1.1 自动提取 + 多线交叉验证 ------------------------- */

/**
 * 从分析产物中提取英文检索词（数据集为英文语料；中文解释里专名保留原文的规则
 * 保证了这里能拿到英文机构/产品名）。纯函数。
 */
export function deriveAwardQueries(input: {
  projectName: string | null;
  buyerText: string | null;
  productTexts: string[];
}): string[] {
  const latinPhrases = (s: string | null | undefined): string[] => {
    if (!s) return [];
    const matches = s.match(/[A-Za-z][A-Za-z&.'-]*(?:\s+[A-Za-z][A-Za-z&.'-]*){1,6}/g) ?? [];
    return matches
      .map((m) => m.replace(/\s+/g, " ").trim())
      .filter((m) => m.split(" ").length >= 2 && m.length >= 8);
  };
  const STOP = /^(the|and|for|with|of|in|to|by|or|a|an)$/i;
  const clean = (p: string) =>
    p
      .split(" ")
      .filter((w, i) => !(i === 0 && STOP.test(w)))
      .join(" ");

  const productLines = [
    ...latinPhrases(input.projectName),
    ...input.productTexts.flatMap((t) => latinPhrases(t)),
  ].map(clean);
  const buyerLines = latinPhrases(input.buyerText).map(clean);
  // 机构名变体：全名 + 去前缀（Ministry of the Solicitor General → Solicitor General）
  const buyerVariants = buyerLines.flatMap((b) => {
    const v = [b];
    const m = b.match(/(?:Ministry|Department|Office)\s+of\s+(?:the\s+)?(.+)/i);
    if (m?.[1]) v.push(m[1]);
    return v;
  });

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [...productLines, ...buyerVariants]) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= 5) break;
  }
  return out;
}

export type RankedAwardCandidate = {
  vendorName: string;
  /** 命中的检索线（交叉验证：命中线越多置信越高） */
  hitQueries: string[];
  score: number;
  bestFinding: AwardFinding;
  totalMatches: number;
};

/** 纯函数：多线结果 → 按跨线命中数交叉评分排序 */
export function rankAwardCandidates(
  lines: Array<{ query: string; findings: AwardFinding[] }>,
): RankedAwardCandidate[] {
  const byVendor = new Map<string, RankedAwardCandidate>();
  for (const line of lines) {
    for (const f of line.findings) {
      const key = f.vendorName.toUpperCase().replace(/\s+/g, " ").trim();
      const cur = byVendor.get(key);
      if (cur) {
        cur.totalMatches += 1;
        if (!cur.hitQueries.includes(line.query)) cur.hitQueries.push(line.query);
        if (f.contractValue != null && cur.bestFinding.contractValue == null) {
          cur.bestFinding = f;
        }
      } else {
        byVendor.set(key, {
          vendorName: f.vendorName,
          hitQueries: [line.query],
          score: 0,
          bestFinding: f,
          totalMatches: 1,
        });
      }
    }
  }
  const ranked = [...byVendor.values()].map((c) => ({
    ...c,
    // 跨线命中权重最高；有金额 +1；多条记录小幅加分
    score:
      c.hitQueries.length * 10 +
      (c.bestFinding.contractValue != null ? 1 : 0) +
      Math.min(c.totalMatches, 5) * 0.5,
  }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

export type AutoAwardSearchResult = {
  ok: boolean;
  queries: string[];
  candidates: RankedAwardCandidate[];
  note: string | null;
  fetchedAt: string;
};

/** 多线自动检索 + 交叉验证（flag OFF → 零出站） */
export async function autoSearchAwardHistory(input: {
  queries: string[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AutoAwardSearchResult> {
  const env = input.env ?? process.env;
  const fetchedAt = new Date().toISOString();
  if (!isExternalIntelEnabled(env)) {
    return { ok: false, queries: [], candidates: [], note: "外部情报开关未启用", fetchedAt };
  }
  const queries = input.queries.filter((q) => q.trim()).slice(0, 5);
  if (queries.length === 0) {
    return { ok: false, queries: [], candidates: [], note: "未提取到可用检索词", fetchedAt };
  }
  const lines: Array<{ query: string; findings: AwardFinding[] }> = [];
  for (const q of queries) {
    const res = await searchAwardHistory({ query: q, env, fetchImpl: input.fetchImpl });
    lines.push({ query: q, findings: res.ok ? res.findings : [] });
  }
  const candidates = rankAwardCandidates(lines).slice(0, 8);
  return {
    ok: true,
    queries,
    candidates,
    note: candidates.length === 0 ? "各检索线均未命中历史授标记录" : null,
    fetchedAt,
  };
}

/** 关键词检索历史授标（全文 q；调用方可传采购品类/买方名等） */
export async function searchAwardHistory(input: {
  query: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AwardHistoryResult> {
  const env = input.env ?? process.env;
  if (!isExternalIntelEnabled(env)) {
    return { ok: false, total: 0, findings: [], note: "外部情报开关未启用" };
  }
  const query = input.query.trim();
  if (!query) return { ok: false, total: 0, findings: [], note: "查询词为空" };

  const resource =
    (env.EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID ?? "").trim() || DEFAULT_RESOURCE;
  const url = `${CKAN_BASE}?resource_id=${encodeURIComponent(resource)}&q=${encodeURIComponent(query)}&limit=${MAX_RESULTS}`;

  const f = input.fetchImpl ?? fetch;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await f(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, total: 0, findings: [], note: `数据源返回 HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      success?: boolean;
      result?: { total?: number; records?: Array<Record<string, unknown>> };
    };
    if (!data.success || !data.result) {
      return { ok: false, total: 0, findings: [], note: "数据源响应异常" };
    }
    const findings: AwardFinding[] = (data.result.records ?? [])
      .filter((r) => toStr(r.vendor_name))
      .map((r) => ({
        source: "open_canada_contracts" as const,
        vendorName: toStr(r.vendor_name)!,
        descriptionEn: toStr(r.description_en),
        contractValue: toNum(r.contract_value),
        currency: "CAD" as const,
        contractDate: toStr(r.contract_date),
        buyerName: toStr(r.buyer_name),
        ownerOrg: toStr(r.owner_org_title),
        referenceNumber: toStr(r.reference_number),
        sourceUrl: url,
        raw: r,
      }));
    return { ok: true, total: data.result.total ?? findings.length, findings, note: null };
  } catch (e) {
    return {
      ok: false,
      total: 0,
      findings: [],
      note: `查询失败：${e instanceof Error ? e.name : "unknown"}`,
    };
  }
}
