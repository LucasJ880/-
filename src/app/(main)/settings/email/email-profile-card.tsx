"use client";

/**
 * 跟进邮件里的公司资料：Logo、主色、公司介绍、数字、工厂照片、页脚地址、视频看样。
 * 不填的项邮件里就不出现。落款 / 对外公司名 / MOQ 交期参考值在策略的商务事实（commercialFacts）里。
 * 数据：/api/trade/email-profile（组织级，按版本发布）
 */

import { useEffect, useState } from "react";
import { Eye, Loader2, Mail } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Label } from "@/components/ui/label";

interface ProfileForm {
  accent: string;
  logoUrl: string | null;
  companyLine: string | null;
  facts: string;
  factImageUrl: string | null;
  address: string | null;
  videoCall: boolean;
}

const EMPTY: ProfileForm = {
  accent: "#8E6657",
  logoUrl: null,
  companyLine: null,
  facts: "",
  factImageUrl: null,
  address: null,
  videoCall: false,
};

const inputCls = "w-full rounded-lg border border-border bg-card-bg/80 px-3 py-2 text-sm";

export function EmailProfileCard({ orgId }: { orgId: string | null }) {
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      try {
        const res = await apiFetch("/api/trade/email-profile");
        if (!res.ok) {
          setHidden(true);
          return;
        }
        const data = await res.json();
        setForm({ ...EMPTY, ...data.profile });
      } catch {
        setHidden(true);
      }
    })();
  }, [orgId]);

  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/trade/email-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: "error", text: (data.errors ?? [data.error ?? "保存失败"]).join("；") });
        return;
      }
      setForm({ ...EMPTY, ...data.profile });
      setMsg({ tone: "ok", text: `已保存（第 ${data.version} 版），之后起草的邮件按新资料写。` });
      if (preview !== null) void showPreview();
    } catch {
      setMsg({ tone: "error", text: "保存失败，请检查网络后重试" });
    } finally {
      setSaving(false);
    }
  };

  const showPreview = async () => {
    setLoadingPreview(true);
    try {
      const res = await apiFetch("/api/trade/email-profile?sample=1");
      const data = await res.json().catch(() => ({}));
      setPreview(typeof data.html === "string" ? data.html : "");
    } finally {
      setLoadingPreview(false);
    }
  };

  if (hidden) return null;
  if (!form) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border p-5">
        <Loader2 className="animate-spin text-muted-foreground" size={18} />
      </div>
    );
  }

  const text = (k: keyof ProfileForm) => (form[k] as string | null) ?? "";

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg bg-muted/40 p-2">
          <Mail size={20} className="text-accent" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">邮件里的公司资料</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              展会跟进邮件里给买家看的公司介绍、数字和工厂照片。都要公司确认过再填；没填的项邮件里不出现，邮件照常起草。保存后只影响之后起草的邮件。
              落款（职位 / WhatsApp / 网站）、对外英文公司名、起订量和大货周期参考值、不对外的款号在收入策略的「商务事实」里，不在这里改。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ep-line">公司一句话介绍（英文）</Label>
              <input id="ep-line" className={inputCls} value={text("companyLine")} onChange={(e) => set("companyLine", e.target.value)} placeholder="Mengxin is a home textile manufacturer in Jiande, Zhejiang, making …" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ep-facts">公司数字（一行一个「数值 | 说明」，最多 4 个）</Label>
              <textarea id="ep-facts" rows={4} className={inputCls} value={form.facts} onChange={(e) => set("facts", e.target.value)} placeholder={"2008 | established in Jiande, Zhejiang\n≈10,000 m² | factory floor area"} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ep-logo">Logo 图片链接</Label>
              <input id="ep-logo" className={inputCls} value={text("logoUrl")} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…/email/logo.png" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ep-img">工厂照片链接（放在公司数字旁边）</Label>
              <input id="ep-img" className={inputCls} value={text("factImageUrl")} onChange={(e) => set("factImageUrl", e.target.value)} placeholder="https://…/email/factory.jpg" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ep-addr">页脚地址</Label>
              <input id="ep-addr" className={inputCls} value={text("address")} onChange={(e) => set("address", e.target.value)} placeholder="Jiande, Zhejiang, China" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ep-accent">主色</Label>
              <input id="ep-accent" className={inputCls} value={form.accent} onChange={(e) => set("accent", e.target.value)} placeholder="#8E6657" />
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={form.videoCall} onChange={(e) => set("videoCall", e.target.checked)} />
              <span>
                首封里提供视频看样
                <span className="block text-xs text-muted-foreground">「想看实物？回复 video，我们从样品间和您视频看样」——确认样品间能安排再勾。</span>
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              保存公司资料
            </button>
            <button
              onClick={() => void showPreview()}
              disabled={loadingPreview}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm transition hover:bg-muted/40 disabled:opacity-50"
            >
              {loadingPreview ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              预览样例邮件（按已保存的资料）
            </button>
            {msg && <span className={`text-xs ${msg.tone === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
          </div>
          {preview !== null && (
            <iframe title="样例邮件" sandbox="" srcDoc={preview || "<p>预览失败</p>"} className="h-[720px] w-full rounded-lg border border-border bg-white" />
          )}
        </div>
      </div>
    </div>
  );
}
