"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

function NewSampleForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [productName, setProductName] = useState(params.get("productName") ?? "");
  const [sku, setSku] = useState(params.get("sku") ?? "");
  const [productId, setProductId] = useState(params.get("productId") ?? "");
  const [quantity, setQuantity] = useState(params.get("quantity") ?? "1");
  const [destination, setDestination] = useState(params.get("destination") ?? "");
  const [recipientName, setRecipientName] = useState(params.get("recipientName") ?? "");
  const [recipientEmail, setRecipientEmail] = useState(params.get("recipientEmail") ?? "");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Array<{ id: string; sku: string; name: string; nameEn: string | null }>>([]);

  useEffect(() => {
    const q = (sku || productName).trim();
    if (!orgId || q.length < 2) {
      setCatalog([]);
      return;
    }
    const t = setTimeout(() => {
      void apiFetch(`/api/trade/products?orgId=${encodeURIComponent(orgId)}&q=${encodeURIComponent(q)}`).then(
        async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as { items?: Array<{ id: string; sku: string; name: string; nameEn: string | null }> };
          setCatalog(data.items ?? []);
        },
      );
    }, 250);
    return () => clearTimeout(t);
  }, [orgId, sku, productName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !productName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/trade/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          prospectId: params.get("prospectId") || undefined,
          quoteId: params.get("quoteId") || undefined,
          productId: productId || undefined,
          sku: sku || undefined,
          productName: productName.trim(),
          quantity: Number(quantity) || 1,
          destination: destination.trim() || undefined,
          recipientName: recipientName.trim() || undefined,
          recipientEmail: recipientEmail.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      router.push(`/trade/samples/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
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
    return <p className="py-16 text-center text-sm text-muted">请先选择当前组织。</p>;
  }

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1 text-xs text-muted">
        <ArrowLeft size={14} /> 返回
      </button>
      <PageHeader title="新建寄样" description="只记底账，不会自动给客户发邮件。" />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <form onSubmit={handleSubmit} className="max-w-xl space-y-3">
        {catalog.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {catalog.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setProductId(p.id);
                  setSku(p.sku);
                  setProductName(p.nameEn || p.name);
                  setCatalog([]);
                }}
                className="rounded-md border border-border px-2 py-1 text-[10px]"
              >
                {p.sku} · {p.nameEn || p.name}
              </button>
            ))}
          </div>
        )}
        <input value={productName} onChange={(e) => { setProductName(e.target.value); setProductId(""); }} placeholder="产品名称 *" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="货号" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" placeholder="数量" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="目的地国家/城市" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="收件人" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="收件邮箱" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="地址" rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="备注" rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">
          {saving ? "保存中…" : "创建寄样单"}
        </button>
      </form>
    </div>
  );
}

export default function NewSamplePage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}>
      <NewSampleForm />
    </Suspense>
  );
}
