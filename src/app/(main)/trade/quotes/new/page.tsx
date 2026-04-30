"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

export default function NewQuotePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}>
      <NewQuoteForm />
    </Suspense>
  );
}

function NewQuoteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();

  const [companyName, setCompanyName] = useState(params.get("companyName") ?? "");
  const [contactName, setContactName] = useState(params.get("contactName") ?? "");
  const [contactEmail, setContactEmail] = useState(params.get("contactEmail") ?? "");
  const [country, setCountry] = useState(params.get("country") ?? "");
  const [currency, setCurrency] = useState("USD");
  const [incoterm, setIncoterm] = useState("FOB");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [validDays, setValidDays] = useState(30);
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [moq, setMoq] = useState("");
  const [shippingPort, setShippingPort] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const prospectId = params.get("prospectId") ?? undefined;
  const campaignId = params.get("campaignId") ?? undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !orgId) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/trade/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          prospectId,
          campaignId,
          companyName: companyName.trim(),
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          country: country.trim() || undefined,
          currency,
          incoterm,
          paymentTerms: paymentTerms.trim() || undefined,
          validDays,
          leadTimeDays: leadTimeDays ? Number(leadTimeDays) : undefined,
          moq: moq.trim() || undefined,
          shippingPort: shippingPort.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (res.ok) {
        const quote = await res.json();
        router.push(`/trade/quotes/${quote.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织后再创建报价单。</p>
        <button
          type="button"
          onClick={() => router.push("/organizations")}
          className="text-sm text-accent underline-offset-2 hover:underline"
        >
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="rounded-lg p-1.5 text-muted transition hover:text-foreground">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-foreground">新建报价单</h1>
          <p className="text-xs text-muted">创建后可添加产品行项目</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mx-auto max-w-xl space-y-4 rounded-xl border border-border/60 bg-card-bg p-6">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">客户公司 *</label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">联系人</label>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">邮箱</label>
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">国家</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">币种</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CNY">CNY</option>
              <option value="CAD">CAD</option>
              <option value="AUD">AUD</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">贸易术语</label>
            <select value={incoterm} onChange={(e) => setIncoterm(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none">
              <option value="FOB">FOB</option>
              <option value="CIF">CIF</option>
              <option value="EXW">EXW</option>
              <option value="DDP">DDP</option>
              <option value="CFR">CFR</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">付款条件</label>
            <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="T/T 30% deposit, 70% before shipment" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">发货港口</label>
            <input value={shippingPort} onChange={(e) => setShippingPort(e.target.value)} placeholder="Ningbo / Shanghai" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">有效期（天）</label>
            <input type="number" value={validDays} onChange={(e) => setValidDays(Number(e.target.value))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">交期（天）</label>
            <input value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} type="number" placeholder="25" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">最低起订量</label>
            <input value={moq} onChange={(e) => setMoq(e.target.value)} placeholder="500 pcs" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">备注</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Sample policy, shipping terms, etc." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={() => router.back()} className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground">取消</button>
          <button type="submit" disabled={saving || !companyName.trim() || !orgId} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />}
            创建报价单
          </button>
        </div>
      </form>
    </div>
  );
}
