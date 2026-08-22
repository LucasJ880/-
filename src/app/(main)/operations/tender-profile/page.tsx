"use client";

/**
 * 投标业务档案（与窗饰品牌档案分离）：投标起草/备忘录只读本档案。
 * 存 Organization.settingsJson.tenderProfile，零 schema。
 */

import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { TENDER_PROFILE_FIELDS, type TenderProfile } from "@/lib/tender-profile/contract";

type Form = Record<string, string>;

export default function TenderProfilePage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [form, setForm] = useState<Form>({});
  // Quote Operations Phase 2：客户报价 PDF 抬头（我方身份）+ 默认条款（零 schema，存同一档案）
  const [quoteHeader, setQuoteHeader] = useState<Form>({});
  const [quoteTerms, setQuoteTerms] = useState<Form>({});
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await apiFetch(`/api/operations/tender-profile?orgId=${encodeURIComponent(orgId)}`);
      const json = (await res.json()) as { profile: TenderProfile | null };
      const next: Form = {};
      for (const f of TENDER_PROFILE_FIELDS) next[f.key] = json.profile?.[f.key] ?? "";
      setForm(next);
      const qh = json.profile?.quoteHeader;
      setQuoteHeader({ companyName: qh?.companyName ?? "", addressLines: (qh?.addressLines ?? []).join("\n"), phone: qh?.phone ?? "", email: qh?.email ?? "", website: qh?.website ?? "", taxNumber: qh?.taxNumber ?? "", preparedByDefault: qh?.preparedByDefault ?? "" });
      const qt = json.profile?.quoteTerms;
      setQuoteTerms({ paymentTerms: qt?.paymentTerms ?? "", delivery: qt?.delivery ?? "", leadTime: qt?.leadTime ?? "", warranty: qt?.warranty ?? "", validity: qt?.validity ?? "", exclusions: (qt?.exclusions ?? []).join("\n"), assumptions: (qt?.assumptions ?? []).join("\n"), notes: qt?.notes ?? "" });
      setUpdatedAt(json.profile?.updatedAt || null);
    } catch {
      setMsg("读取失败");
    }
  }, [orgId]);
  useEffect(() => {
    if (!orgLoading && !ambiguous && orgId) void load();
  }, [orgLoading, ambiguous, orgId, load]);

  const save = async () => {
    if (!orgId) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/operations/tender-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          ...form,
          quoteHeader: { ...quoteHeader, addressLines: (quoteHeader.addressLines ?? "").split("\n").map((x) => x.trim()).filter(Boolean) },
          quoteTerms: { ...quoteTerms, exclusions: (quoteTerms.exclusions ?? "").split("\n").map((x) => x.trim()).filter(Boolean), assumptions: (quoteTerms.assumptions ?? "").split("\n").map((x) => x.trim()).filter(Boolean) },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; profile?: TenderProfile };
      if (!res.ok) setMsg(json.error ?? "保存失败");
      else {
        setMsg("已保存");
        setUpdatedAt(json.profile?.updatedAt ?? null);
      }
    } catch {
      setMsg("保存失败");
    } finally {
      setSaving(false);
    }
  };

  // swc 守卫：`??` 与 `||` 不同行
  const termRows = (k: string) => (k === "exclusions" || k === "assumptions" ? 3 : 2);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <OrgSelectBanner />
      <div>
        <h1 className="text-lg font-semibold text-foreground">投标业务档案</h1>
        <p className="mt-1 text-xs text-muted">
          与品牌档案（窗饰业务）分离。投标文件起草、策略备忘录、合规响应只读这份档案——没填的项在草稿里会是
          [TO CONFIRM] 占位，绝不回退到其他业务线的资料。只写能举证的内容。
        </p>
        {updatedAt ? <p className="mt-1 text-[11px] text-muted">上次更新：{updatedAt.slice(0, 16).replace("T", " ")}</p> : null}
      </div>
      <div className="space-y-3" data-testid="tender-profile-form">
        {TENDER_PROFILE_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-sm font-medium text-foreground">{f.labelZh}</span>
            <span className="ml-2 text-[11px] text-muted">{f.hintZh}</span>
            <textarea
              value={form[f.key] ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              rows={f.key === "entityName" ? 1 : 4}
              className="mt-1 w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        ))}
      </div>
      <div className="space-y-3 rounded-lg border border-border/60 p-3" data-testid="quote-header-form">
        <div>
          <h2 className="text-sm font-semibold text-foreground">客户报价 PDF 抬头（我方身份）</h2>
          <p className="text-[11px] text-muted">用于 Quote &amp; Cost Engine 生成的客户报价单（英文）。公司名缺省取「投标主体名称」。</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {([["companyName", "Company name"], ["phone", "Phone"], ["email", "Email"], ["website", "Website"], ["taxNumber", "GST/HST / Business No."], ["preparedByDefault", "Default Prepared by"]] as const).map(([k, label]) => (
            <label key={k} className="block text-xs text-muted">{label}
              <input value={quoteHeader[k] ?? ""} onChange={(e) => setQuoteHeader((prev) => ({ ...prev, [k]: e.target.value }))} className="mt-1 w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm text-foreground" />
            </label>
          ))}
          <label className="block text-xs text-muted sm:col-span-2">Address（每行一段）
            <textarea value={quoteHeader.addressLines ?? ""} onChange={(e) => setQuoteHeader((prev) => ({ ...prev, addressLines: e.target.value }))} rows={2} className="mt-1 w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm text-foreground" />
          </label>
        </div>
      </div>
      <div className="space-y-3 rounded-lg border border-border/60 p-3" data-testid="quote-terms-form">
        <div>
          <h2 className="text-sm font-semibold text-foreground">客户报价默认条款（可复用模板）</h2>
          <p className="text-[11px] text-muted">每份报价可在报价页「套用组织默认条款」后再改；自由文本，不建合同引擎。</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {([["paymentTerms", "Payment terms"], ["delivery", "Delivery"], ["leadTime", "Lead time"], ["warranty", "Warranty"], ["validity", "Validity"], ["notes", "Notes"], ["exclusions", "Exclusions（每行一条）"], ["assumptions", "Assumptions（每行一条）"]] as const).map(([k, label]) => (
            <label key={k} className="block text-xs text-muted">{label}
              <textarea value={quoteTerms[k] ?? ""} onChange={(e) => setQuoteTerms((prev) => ({ ...prev, [k]: e.target.value }))} rows={termRows(k)} className="mt-1 w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm text-foreground" />
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving || !orgId}
          onClick={() => void save()}
          className="flex items-center gap-1 rounded border border-border bg-accent/10 px-3 py-1.5 text-sm text-foreground hover:bg-accent/20"
        >
          <Save size={14} /> {saving ? "保存中…" : "保存"}
        </button>
        {msg ? <span className="text-xs text-muted">{msg}</span> : null}
      </div>
    </div>
  );
}
