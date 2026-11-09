#!/usr/bin/env tsx
/**
 * PROC-1 首次真实只读核对（不连数据库、不写任何数据、不需要登录任何站点）
 *
 *   npx tsx scripts/procurement-records-live-check.ts [--out docs/acceptance/proc-1/live-check.json]
 *
 * 做三件事，全部只读官方公开数据：
 *   1. 用生产同一套适配器跑一轮四个来源（配置 = 缺省词表；已知合同 = 三条研究种子），输出每来源状态 / 获取 / 命中 / 说明；
 *   2. 核对 CanadaBuys 招标公告 CSV 的实际表头，列出适配器需要的列是否都找到（找不到即 PARSE_FAILED 的原因）；
 *   3. 用 CKAN package_search 找 Completed ATI 摘要数据集，列出启用 datastore 的资源 ID 与字段，供设置 PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID。
 *
 * 结果是「真实只读结果」，与 fixture 区分；不会改变任何监控、候选或申请。
 */
import { writeFileSync } from "node:fs";

const CKAN = "https://open.canada.ca/data/en/api/3/action";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function getJson(url: string): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  try {
    const res = await fetch(url, { headers: { "user-agent": "qingyan-procurement-live-check/1.0 (read-only)" }, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  process.env.TENDER_EXTERNAL_INTEL_ENABLED = "1";
  const { ADAPTERS, DEFAULT_CANADABUYS_NOTICE_URLS, USER_AGENT } = await import("@/lib/procurement-records/source-fetch");
  const { defaultWatchConfig } = await import("@/lib/procurement-records/watch-config");
  const { RESEARCH_SEEDS } = await import("@/lib/procurement-records/seed");
  const { normalizeInstrumentNumber } = await import("@/lib/procurement-records/identity");
  const { findColumn, parseCsv } = await import("@/lib/procurement-records/sources-pure");

  const startedAt = new Date();
  const config = defaultWatchConfig();
  const known = RESEARCH_SEEDS.map((s) => ({
    id: `seed-${s.key}`,
    officialNumber: s.contractNumber,
    normalizedNumber: normalizeInstrumentNumber(s.contractNumber).normalized,
    instrumentClass: "AWARD_INSTRUMENT",
    contractHistoryUrls: [s.sourceUrl],
  }));
  const report: Record<string, unknown> = { kind: "REAL_READ_ONLY_CHECK", startedAt: startedAt.toISOString(), note: "真实只读结果（官方公开数据）；未写数据库" };

  // 1) 四个来源各跑一轮
  const sources: Record<string, unknown> = {};
  for (const [key, adapter] of Object.entries(ADAPTERS)) {
    const out = await adapter({ config, known, now: new Date(), deadline: new Date(Date.now() + 120_000), env: process.env, fetchImpl: fetch });
    sources[key] = {
      result: out.result,
      sampleRecords: out.records.slice(0, 5).map((r) => ({ number: r.officialNumber, class: r.instrumentClass, title: r.title, contracting: r.contractingInstitution, buying: r.buyingInstitution, value: r.contractValue, parent: r.parentNumber, url: r.sourceUrl })),
      atiSummaries: out.atiSummaries.slice(0, 5).map((a) => ({ requestNumber: a.requestNumber, owner: a.ownerOrg, pages: a.pages, disposition: a.disposition })),
      pageSnapshots: out.pageSnapshots.map((p) => ({ url: p.url, httpStatus: p.httpStatus, digest: p.digest?.slice(0, 16) ?? null, error: p.error })),
    };
    console.log(`${key}: ${out.result.status} fetched=${out.result.fetched} matched=${out.result.matched}${out.result.note ? ` note=${out.result.note}` : ""}`);
  }
  report.sources = sources;

  // 2) CanadaBuys CSV 表头核对
  const headerCheck: unknown[] = [];
  for (const url of DEFAULT_CANADABUYS_NOTICE_URLS) {
    try {
      // 与正式抓取同一个 User-Agent：CanadaBuys 对不带 UA 的请求返回 403（2026-11-09 真实核对发现）
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "*/*" }, signal: AbortSignal.timeout(60_000) });
      const text = res.ok ? await res.text() : "";
      const headers = text ? (parseCsv(text.slice(0, 20_000))[0] ?? []) : [];
      const need = {
        title: findColumn(headers, { prefix: ["title-titre-eng", "title-eng"], exact: ["title"] }),
        referenceNumber: findColumn(headers, { prefix: ["referencenumber-numeroreference", "referencenumber"] }),
        solicitationNumber: findColumn(headers, { prefix: ["solicitationnumber-numerosollicitation", "solicitationnumber"] }),
        amendmentNumber: findColumn(headers, { prefix: ["amendmentnumber-numeromodification", "amendmentnumber"] }),
        publicationDate: findColumn(headers, { prefix: ["publicationdate-datepublication", "publicationdate"] }),
        contractingEntity: findColumn(headers, { prefix: ["contractingentityname-nomentitcontractante-eng", "contractingentityname"] }),
        description: findColumn(headers, { prefix: ["tenderdescription-descriptionappeloffres-eng", "tenderdescription"] }),
      };
      headerCheck.push({ url, httpStatus: res.status, headerCount: headers.length, missing: Object.entries(need).filter(([, i]) => i < 0).map(([k]) => k), headers: headers.slice(0, 60) });
    } catch (e) {
      headerCheck.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }
  report.canadaBuysHeaderCheck = headerCheck;

  // 3) Completed ATI 摘要资源 ID
  const search = await getJson(`${CKAN}/package_search?q=${encodeURIComponent('title:"completed access to information"')}&rows=10`);
  const pkgs = ((search.json as { result?: { results?: Array<Record<string, unknown>> } } | null)?.result?.results ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    resources: ((p.resources as Array<Record<string, unknown>>) ?? []).map((r) => ({ id: r.id, name: r.name, format: r.format, datastore_active: r.datastore_active, url: r.url })),
  }));
  const candidates = pkgs.flatMap((p) => p.resources.filter((r) => r.datastore_active).map((r) => ({ dataset: p.title, resourceId: r.id, name: r.name })));
  const fieldInfo: unknown[] = [];
  for (const c of candidates.slice(0, 4)) {
    const f = await getJson(`${CKAN}/datastore_search?resource_id=${c.resourceId}&limit=1`);
    const fields = ((f.json as { result?: { fields?: Array<{ id: string }> } } | null)?.result?.fields ?? []).map((x) => x.id);
    fieldInfo.push({ ...c, fields, hasExpectedFields: ["request_number", "summary_en", "disposition", "pages", "owner_org"].every((x) => fields.includes(x)) });
  }
  report.atiSummaries = { searchStatus: search.status, searchError: search.error ?? null, datasets: pkgs, datastoreResources: fieldInfo };

  report.finishedAt = new Date().toISOString();
  const out = arg("--out");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ canadaBuysHeaderCheck: headerCheck.map((h) => ({ ...(h as Record<string, unknown>), headers: undefined })), atiResources: fieldInfo }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
