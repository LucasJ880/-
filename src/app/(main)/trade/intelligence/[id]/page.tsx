"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { cn } from "@/lib/utils";
import type {
  IntelligenceCandidate,
  IntelligenceContactCandidate,
  IntelligenceEvidenceItem,
  ConvertIntelligenceBody,
} from "@/lib/trade/intelligence-types";
import { LABEL_VISION_FIELD_KEYS } from "@/lib/trade/intelligence-label-types";

type CampaignOpt = { id: string; name: string };

interface CaseRow {
  id: string;
  title: string;
  status: string;
  productName: string | null;
  brand: string | null;
  upc: string | null;
  gtin: string | null;
  sku: string | null;
  mpn: string | null;
  productUrl: string | null;
  retailerName: string | null;
  material: string | null;
  size: string | null;
  color: string | null;
  countryOfOrigin: string | null;
  notes: string | null;
  sourceType?: string | null;
  structuredProduct: unknown;
  searchQueries: unknown;
  evidence: unknown;
  buyerCandidates: unknown;
  retailerCandidates: unknown;
  importerCandidates: unknown;
  supplierCandidates: unknown;
  contactCandidates: unknown;
  analysisReport: string | null;
  confidenceScore: number | null;
  lastRunAt: string | null;
  lastError: string | null;
  convertedProspectId: string | null;
  createdAt: string;
  assets?: CaseAsset[];
}

interface CaseAsset {
  id: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  assetType: string;
  extractedFields: unknown;
  extractedText: unknown;
  confidence: number | null;
  warnings: unknown;
  createdAt: string;
}

function asEvidenceList(v: unknown): IntelligenceEvidenceItem[] {
  if (!Array.isArray(v)) return [];
  return v as IntelligenceEvidenceItem[];
}

function asCandidateList(v: unknown): IntelligenceCandidate[] {
  if (!Array.isArray(v)) return [];
  return v as IntelligenceCandidate[];
}

function asContactList(v: unknown): IntelligenceContactCandidate[] {
  if (!Array.isArray(v)) return [];
  return v as IntelligenceContactCandidate[];
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function distributorFiltered(importers: IntelligenceCandidate[]): IntelligenceCandidate[] {
  return importers.filter(
    (c) => c.role === "distributor" || /distribut/i.test(`${c.name} ${c.reason}`),
  );
}

const ROLE_LABEL: Record<string, string> = {
  retailer: "零售商",
  buyer: "买家",
  importer: "进口商",
  distributor: "分销商",
  brand_owner: "品牌方",
  supplier: "供应商",
  marketplace: "平台",
  unknown: "未知",
};

export default function TradeIntelligenceDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [row, setRow] = useState<CaseRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [runBusy, setRunBusy] = useState(false);
  const [convertBusy, setConvertBusy] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOpt[]>([]);
  const [createCampaignId, setCreateCampaignId] = useState("");

  const load = useCallback(async () => {
    if (!orgId || ambiguous || !id) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/trade/intelligence/${id}?orgId=${encodeURIComponent(orgId)}`,
      );
      if (res.ok) {
        setRow((await res.json()) as CaseRow);
      } else {
        setRow(null);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, ambiguous, id]);

  const loadCampaigns = useCallback(async () => {
    if (!orgId || ambiguous) return;
    const res = await apiFetch(`/api/trade/campaigns?orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) {
      const data = (await res.json()) as { id: string; name: string }[];
      setCampaigns(data.map((c) => ({ id: c.id, name: c.name })));
    }
  }, [orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  useEffect(() => {
    if (orgLoading) return;
    void loadCampaigns();
  }, [loadCampaigns, orgLoading]);

  const evidence = useMemo(() => asEvidenceList(row?.evidence), [row?.evidence]);
  const buyers = useMemo(() => asCandidateList(row?.buyerCandidates), [row?.buyerCandidates]);
  const retailers = useMemo(() => asCandidateList(row?.retailerCandidates), [row?.retailerCandidates]);
  const importers = useMemo(() => asCandidateList(row?.importerCandidates), [row?.importerCandidates]);
  const suppliers = useMemo(() => asCandidateList(row?.supplierCandidates), [row?.supplierCandidates]);
  const contacts = useMemo(() => asContactList(row?.contactCandidates), [row?.contactCandidates]);
  const queries = useMemo(() => asStringList(row?.searchQueries), [row?.searchQueries]);
  const distributors = useMemo(() => distributorFiltered(importers), [importers]);

  const lowConfidence =
    (row?.confidenceScore != null && row.confidenceScore < 0.55) ||
    row?.status === "needs_review" ||
    buyers.some((b) => b.confidence < 0.5 || (b.riskFlags ?? []).includes("insufficient_evidence"));

  const runCase = async () => {
    if (!orgId || !id) return;
    setRunBusy(true);
    try {
      const res = await apiFetch(`/api/trade/intelligence/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; case?: CaseRow };
      if (!res.ok) {
        window.alert(j.error ?? `运行失败（${res.status}）`);
        return;
      }
      if (j.case) setRow(j.case);
      else await load();
    } finally {
      setRunBusy(false);
    }
  };

  const convert = async (payload: ConvertIntelligenceBody) => {
    if (!orgId || !id) return;
    const key = `${payload.candidateRole}-${payload.candidateIndex}`;
    setConvertBusy(key);
    try {
      const body: ConvertIntelligenceBody & { orgId: string; createCampaignId?: string } = {
        orgId,
        candidateRole: payload.candidateRole,
        candidateIndex: payload.candidateIndex,
      };
      if (createCampaignId.trim()) body.createCampaignId = createCampaignId.trim();
      const res = await apiFetch(`/api/trade/intelligence/${id}/convert-to-prospect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; prospectId?: string };
      if (!res.ok) {
        window.alert(j.error ?? `转换失败（${res.status}）`);
        return;
      }
      if (j.prospectId) {
        router.push(`/trade/prospects/${j.prospectId}`);
      }
    } finally {
      setConvertBusy(null);
    }
  };

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center text-sm text-muted">
        <p>请先选择当前组织。</p>
        <button type="button" onClick={() => router.push("/organizations")} className="text-accent underline">
          前往组织
        </button>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">案例不存在或无权访问。</p>
        <Link href="/trade/intelligence" className="text-xs text-blue-400 hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  const converted = !!row.convertedProspectId;

  return (
    <div className="space-y-6">
      <Link
        href="/trade/intelligence"
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
      >
        <ChevronLeft size={14} />
        返回列表
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title={row.title} description={`状态：${row.status} · 置信度 ${row.confidenceScore?.toFixed(2) ?? "—"}`} />
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={runBusy || converted}
            onClick={() => void runCase()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:border-amber-500/40 disabled:opacity-40"
          >
            <RefreshCw size={12} className={cn(runBusy && "animate-spin")} />
            {runBusy ? "运行中…" : "运行搜索与分析"}
          </button>
        </div>
      </div>

      {row.lastError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-200">
          上次错误：{row.lastError}
        </div>
      )}

      {lowConfidence && !converted && (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          证据不足或置信度偏低，请人工核对网页证据后再转为线索；勿将平台列表页等同于最终买家。
        </div>
      )}

      {converted && row.convertedProspectId && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-100">
          已转为线索：
          <Link className="ml-1 text-blue-400 hover:underline" href={`/trade/prospects/${row.convertedProspectId}`}>
            打开线索详情
          </Link>
        </div>
      )}

      <div className="rounded-xl border border-border/60 bg-card-bg p-4">
        <h3 className="mb-3 text-sm font-medium text-foreground">转入线索时的活动（可选）</h3>
        <p className="mb-2 text-[10px] text-muted">留空则使用本组织最近一个未结束活动。</p>
        <select
          value={createCampaignId}
          onChange={(e) => setCreateCampaignId(e.target.value)}
          disabled={converted}
          className="max-w-md w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground focus:outline-none disabled:opacity-50"
        >
          <option value="">（自动选择活动）</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <section className="rounded-xl border border-border/60 bg-card-bg p-4">
        <h3 className="mb-3 text-sm font-medium text-foreground">产品线索</h3>
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <Field label="产品名" value={row.productName} />
          <Field label="品牌" value={row.brand} />
          <Field label="UPC" value={row.upc} />
          <Field label="GTIN" value={row.gtin} />
          <Field label="MPN" value={row.mpn} />
          <Field label="SKU" value={row.sku} />
          <Field label="产品 URL" value={row.productUrl} link />
          <Field label="零售商" value={row.retailerName} />
          <Field label="材质" value={row.material} />
          <Field label="尺寸" value={row.size} />
          <Field label="颜色" value={row.color} />
          <Field label="产地" value={row.countryOfOrigin} />
        </dl>
        {row.notes && (
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-background/50 p-3 text-xs text-muted">{row.notes}</p>
        )}
      </section>

      {row.assets && row.assets.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card-bg p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">吊牌 / 图片资产与提取线索</h3>
          <div className="space-y-6">
            {row.assets.map((a) => (
              <div key={a.id} className="rounded-lg border border-border/40 p-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <a
                    href={a.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block shrink-0 overflow-hidden rounded-md border border-border/50 bg-background"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.fileUrl} alt={a.fileName} className="max-h-48 max-w-[200px] object-contain" />
                  </a>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-medium text-foreground">{a.fileName}</p>
                    <p className="mt-1 text-muted">
                      类型 {a.assetType} · MIME {a.fileType} · 模型置信{" "}
                      {a.confidence != null ? a.confidence.toFixed(2) : "—"} ·{" "}
                      {new Date(a.createdAt).toLocaleString("zh-CN")}
                    </p>
                    {Array.isArray(a.warnings) && a.warnings.length > 0 && (
                      <ul className="mt-2 list-inside list-disc text-amber-200">
                        {(a.warnings as string[]).map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}
                    <ExtractedFieldsTable fields={a.extractedFields} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {queries.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card-bg p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">搜索查询</h3>
          <ul className="list-inside list-disc space-y-1 text-xs text-muted">
            {queries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      {evidence.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card-bg p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">网页证据（{evidence.length}）</h3>
          <ul className="space-y-2 text-xs">
            {evidence.slice(0, 40).map((ev, i) => (
              <li key={`${ev.url}-${i}`} className="rounded-lg border border-border/40 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-border/30 px-1.5 py-0.5 text-[10px] text-muted">{ev.type}</span>
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 font-medium text-blue-400 hover:underline"
                  >
                    <span className="truncate">{ev.title || ev.url}</span>
                    <ExternalLink size={10} className="shrink-0" />
                  </a>
                </div>
                {ev.snippet && <p className="mt-1 line-clamp-3 text-muted">{ev.snippet}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <CandidateSection
        title="最终买家候选"
        list={buyers}
        role="buyer"
        converted={converted}
        convertBusy={convertBusy}
        onConvert={convert}
      />
      <CandidateSection
        title="零售商候选"
        list={retailers}
        role="retailer"
        converted={converted}
        convertBusy={convertBusy}
        onConvert={convert}
      />
      <CandidateSection
        title="进口商候选"
        list={importers}
        role="importer"
        converted={converted}
        convertBusy={convertBusy}
        onConvert={convert}
      />
      <CandidateSection
        title="分销商候选（自进口商列表筛选）"
        list={distributors}
        role="distributor"
        converted={converted}
        convertBusy={convertBusy}
        onConvert={convert}
      />
      <CandidateSection
        title="供应商候选（弱化）"
        list={suppliers}
        role="buyer"
        showConvert={false}
        converted={converted}
        convertBusy={convertBusy}
        onConvert={convert}
      />

      {contacts.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-card-bg p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">联系方式线索</h3>
          <ul className="space-y-2 text-xs">
            {contacts.map((c, i) => (
              <li key={`${c.url}-${i}`} className="flex flex-col gap-1 rounded-lg border border-border/40 p-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="font-medium text-foreground">{c.companyName}</span>
                  <span className="ml-2 text-[10px] text-muted">{c.contactType}</span>
                  <p className="text-muted">{c.label}</p>
                </div>
                <a href={c.url} target="_blank" rel="noreferrer" className="shrink-0 text-blue-400 hover:underline">
                  打开
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {row.analysisReport && (
        <section className="rounded-xl border border-border/60 bg-card-bg p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">分析报告与下一步</h3>
          <pre className="whitespace-pre-wrap break-words text-xs text-muted">{row.analysisReport}</pre>
        </section>
      )}
    </div>
  );
}

function ExtractedFieldsTable({ fields }: { fields: unknown }) {
  if (!fields || typeof fields !== "object") return null;
  const obj = fields as Record<string, { value?: string | null; confidence?: number; source?: string; evidence?: string }>;
  const rows = LABEL_VISION_FIELD_KEYS.map((key) => ({ key, slot: obj[key] })).filter(({ slot }) => slot && (slot.value ?? "") !== "");
  if (rows.length === 0) {
    return <p className="mt-2 text-muted">无非空提取字段。</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[10px]">
        <thead>
          <tr className="border-b border-border/50 text-muted">
            <th className="py-1.5 pr-2 text-left font-medium">字段</th>
            <th className="py-1.5 pr-2 text-left font-medium">值</th>
            <th className="py-1.5 pr-2 font-medium">置信度</th>
            <th className="py-1.5 pr-2 font-medium">来源</th>
            <th className="py-1.5 text-left font-medium">证据摘录</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, slot }) => (
            <tr key={key} className="border-b border-border/30 align-top">
              <td className="py-1.5 pr-2 font-mono text-muted">{key}</td>
              <td className="max-w-[180px] py-1.5 pr-2 break-words text-foreground">{slot.value ?? "—"}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap text-muted">
                {typeof slot.confidence === "number" ? slot.confidence.toFixed(2) : "—"}
              </td>
              <td className="py-1.5 pr-2 whitespace-nowrap text-muted">{slot.source ?? "—"}</td>
              <td className="max-w-[220px] py-1.5 break-words text-muted">{slot.evidence ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, value, link }: { label: string; value: string | null; link?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-foreground">
        {link ? (
          <a href={value.startsWith("http") ? value : `https://${value}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline break-all">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function CandidateSection({
  title,
  list,
  role,
  converted,
  convertBusy,
  onConvert,
  showConvert = true,
}: {
  title: string;
  list: IntelligenceCandidate[];
  role: ConvertIntelligenceBody["candidateRole"];
  converted: boolean;
  convertBusy: string | null;
  onConvert: (b: ConvertIntelligenceBody) => void;
  showConvert?: boolean;
}) {
  if (list.length === 0) return null;
  return (
    <section className="rounded-xl border border-border/60 bg-card-bg p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">
        {title}（{list.length}）
      </h3>
      <div className="space-y-3">
        {list.map((c, idx) => (
          <div key={`${c.name}-${idx}`} className="rounded-lg border border-border/50 p-3 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="font-medium text-foreground">{c.name}</span>
                <span className="ml-2 rounded bg-border/30 px-1.5 py-0.5 text-[10px] text-muted">
                  {ROLE_LABEL[c.role] ?? c.role}
                </span>
                {c.website && (
                  <a
                    href={c.website.startsWith("http") ? c.website : `https://${c.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-blue-400 hover:underline"
                  >
                    网站
                  </a>
                )}
              </div>
              <span className="shrink-0 text-muted">置信 {c.confidence.toFixed(2)}</span>
            </div>
            <p className="mt-2 text-muted">{c.reason}</p>
            {(c.riskFlags?.length ?? 0) > 0 && (
              <p className="mt-1 text-[10px] text-amber-300">风险：{(c.riskFlags ?? []).join(" · ")}</p>
            )}
            <p className="mt-1 text-[10px] text-muted">验证建议：{c.nextVerificationStep}</p>
            {(c.evidence?.length ?? 0) > 0 && (
              <ul className="mt-2 space-y-1 border-t border-border/30 pt-2">
                {(c.evidence ?? []).slice(0, 6).map((ev, j) => (
                  <li key={`${ev.url}-${j}`}>
                    <a href={ev.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                      {ev.title || ev.url}
                    </a>
                    <span className="ml-1 text-[10px] text-muted">({ev.type})</span>
                  </li>
                ))}
              </ul>
            )}
            {showConvert && !converted && (
              <button
                type="button"
                disabled={convertBusy === `${role}-${idx}`}
                onClick={() => onConvert({ candidateRole: role, candidateIndex: idx })}
                className="mt-3 rounded-lg bg-blue-600 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {convertBusy === `${role}-${idx}` ? "创建中…" : "转为 TradeProspect"}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
