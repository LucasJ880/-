"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  CircleAlert,
  Globe2,
  Loader2,
  MapPinned,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { cn } from "@/lib/utils";

interface FormState {
  legalName: string;
  brandName: string;
  website: string;
  phone: string;
  addressLine: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  timezone: string;
  industry: string;
  products: string;
  serviceAreas: string;
  targetAudiences: string;
  competitors: string;
  forbiddenContexts: string;
}

interface ValidationIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

const EMPTY: FormState = {
  legalName: "",
  brandName: "",
  website: "",
  phone: "",
  addressLine: "",
  city: "",
  region: "",
  country: "Canada",
  postalCode: "",
  timezone: "America/Toronto",
  industry: "",
  products: "",
  serviceAreas: "",
  targetAudiences: "",
  competitors: "",
  forbiddenContexts: "",
};

const STEPS = [
  { id: 0, title: "公司信息", subtitle: "标准名称与联系方式", icon: Building2 },
  { id: 1, title: "产品与地区", subtitle: "确认实际业务边界", icon: MapPinned },
  { id: 2, title: "客户与竞品", subtitle: "减少 AI 错误判断", icon: Target },
  { id: 3, title: "检查并提交", subtitle: "查看完整度和风险", icon: ShieldCheck },
] as const;

const REQUIRED_KEYS: Array<keyof FormState> = [
  "legalName",
  "brandName",
  "industry",
  "country",
  "city",
  "products",
  "serviceAreas",
];

function toForm(profile: Record<string, unknown>): FormState {
  const list = (key: string) => Array.isArray(profile[key]) ? (profile[key] as unknown[]).map(String).join("\n") : "";
  return {
    legalName: String(profile.legalName ?? ""),
    brandName: String(profile.brandName ?? ""),
    website: String(profile.website ?? ""),
    phone: String(profile.phone ?? ""),
    addressLine: String(profile.addressLine ?? ""),
    city: String(profile.city ?? ""),
    region: String(profile.region ?? ""),
    country: String(profile.country ?? ""),
    postalCode: String(profile.postalCode ?? ""),
    timezone: String(profile.timezone ?? "America/Toronto"),
    industry: String(profile.industry ?? ""),
    products: list("productsJson"),
    serviceAreas: list("serviceAreasJson"),
    targetAudiences: list("targetAudiencesJson"),
    competitors: list("competitorsJson"),
    forbiddenContexts: list("forbiddenContextsJson"),
  };
}

function countLines(value: string): number {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).length;
}

function MarketingBrandEditor({
  orgId = null,
  ambiguous = false,
  orgLoading = false,
}: {
  orgId?: string | null;
  ambiguous?: boolean;
  orgLoading?: boolean;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [step, setStep] = useState(0);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [status, setStatus] = useState("draft");
  const [canEdit, setCanEdit] = useState(false);
  const [membershipRole, setMembershipRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/marketing/brand-profile");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "企业事实加载失败");
      setCanEdit(Boolean(body.permissions?.canEdit));
      setMembershipRole(body.permissions?.membershipRole ?? null);
      if (body.profile) {
        setForm(toForm(body.profile));
        setIssues(Array.isArray(body.profile.validationIssues) ? body.profile.validationIssues : []);
        setScore(body.profile.validationScore);
        setStatus(body.profile.validationStatus);
        setSavedAt(body.profile.updatedAt ?? null);
      } else {
        setForm(EMPTY);
        setIssues([]);
        setScore(null);
        setStatus("draft");
      }
      setDirty(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "企业事实加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (orgLoading || ambiguous) return;
    load();
  }, [orgId, orgLoading, ambiguous, load]);

  const completion = useMemo(() => {
    const filled = REQUIRED_KEYS.filter((key) => form[key].trim()).length;
    return Math.round((filled / REQUIRED_KEYS.length) * 100);
  }, [form]);

  function update(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setSavedAt(null);
  }

  async function save(finalSubmit = false) {
    if (!canEdit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch("/api/marketing/brand-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...form }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败");
      setIssues(body.validation.issues);
      setScore(body.validation.score);
      setStatus(body.validation.status);
      setDirty(false);
      setSavedAt(new Date().toISOString());
      if (finalSubmit) setStep(3);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading || orgLoading) {
    return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/operations/growth" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            <ArrowLeft size={14} /> 返回增长中心
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">企业事实中心</h1>
            <span className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium",
              status === "valid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
            )}>
              {status === "valid" ? "已通过校验" : "待完善"}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            营销团队在这里维护公司真实信息。青砚会以此限制检测地域、行业、产品和竞争对手，避免生成无效报告。
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:bg-card-bg">
          <RefreshCw size={15} /> 重新加载
        </button>
      </div>

      <OrgSelectBanner />

      {!canEdit && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div><div className="font-medium">当前为只读模式</div><p className="mt-1 text-sm">观察者可以查看企业事实，但不能修改。请让组织管理员将账号设为“成员”。</p></div>
        </div>
      )}
      {canEdit && membershipRole === "org_member" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <Users size={16} /> 营销成员可以直接填写和更新，所有保存都会进入审计日志。
        </div>
      )}
      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-border bg-card-bg shadow-sm">
        <div className="border-b border-border bg-background/60 px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">资料完整度</div>
              <div className="mt-1 text-xs text-muted">先完成带 * 的必填信息，再提交系统校验。</div>
            </div>
            <div className="text-right"><div className="text-2xl font-bold text-accent">{completion}%</div><div className="text-xs text-muted">{score == null ? "尚未校验" : `可信度 ${score}/100`}</div></div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-border/70"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${completion}%` }} /></div>
        </div>

        <div className="grid lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav className="border-b border-border p-3 lg:border-b-0 lg:border-r lg:p-4" aria-label="企业事实填写步骤">
            <div className="grid grid-cols-4 gap-2 lg:grid-cols-1">
              {STEPS.map(({ id, title, subtitle, icon: Icon }) => {
                const active = step === id;
                const done = step > id || (id === 3 && status === "valid");
                return (
                  <button key={id} type="button" onClick={() => setStep(id)} aria-current={active ? "step" : undefined} className={cn(
                    "flex min-w-0 flex-col items-center gap-2 rounded-xl px-2 py-3 text-center transition-colors lg:flex-row lg:text-left",
                    active ? "bg-accent/10 text-accent" : "text-muted hover:bg-background",
                  )}>
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", active ? "border-accent bg-card-bg" : done ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-border bg-card-bg")}>
                      {done ? <Check size={15} /> : <Icon size={15} />}
                    </span>
                    <span className="min-w-0"><span className="block truncate text-xs font-medium sm:text-sm">{title}</span><span className="mt-0.5 hidden text-xs text-muted lg:block">{subtitle}</span></span>
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="min-w-0 p-4 sm:p-6 lg:p-8">
            {step === 0 && <CompanyStep form={form} update={update} disabled={!canEdit} />}
            {step === 1 && <BusinessBoundaryStep form={form} update={update} disabled={!canEdit} />}
            {step === 2 && <AudienceStep form={form} update={update} disabled={!canEdit} />}
            {step === 3 && <ReviewStep form={form} issues={issues} score={score} status={status} />}

            <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted">
                {dirty ? "有尚未保存的修改" : savedAt ? `最近保存：${new Date(savedAt).toLocaleString()}` : "尚未保存"}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background">上一步</button>}
                {canEdit && dirty && <button type="button" onClick={() => save(false)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-background disabled:opacity-50"><Save size={15} />保存草稿</button>}
                {step < 3 ? (
                  <button type="button" onClick={() => setStep((current) => current + 1)} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">下一步 <ArrowRight size={15} /></button>
                ) : canEdit ? (
                  <button type="button" onClick={() => save(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} 提交并重新校验
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketingBrandPage() {
  const { orgId, ambiguous, loading } = useCurrentOrgId();
  return <MarketingBrandEditor orgId={orgId} ambiguous={ambiguous} orgLoading={loading} />;
}

function CompanyStep({ form, update, disabled }: StepProps) {
  return <StepShell eyebrow="第 1 步，共 4 步" title="先确认公司的标准身份" description="这些信息会成为网站、地图、目录和 AI 搜索检测的统一标准。">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="公司正式名称" required><input disabled={disabled} value={form.legalName} onChange={(event) => update("legalName", event.target.value)} placeholder="Sunny Shutter Inc." className={inputClass} /></Field>
      <Field label="对外品牌名称" required><input disabled={disabled} value={form.brandName} onChange={(event) => update("brandName", event.target.value)} placeholder="Sunny Shutter" className={inputClass} /></Field>
      <Field label="公司网站" hint="请填写完整网址"><input disabled={disabled} type="url" value={form.website} onChange={(event) => update("website", event.target.value)} placeholder="https://example.com" className={inputClass} /></Field>
      <Field label="标准联系电话"><input disabled={disabled} value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="+1 416 000 0000" className={inputClass} /></Field>
      <Field label="街道地址" wide><input disabled={disabled} value={form.addressLine} onChange={(event) => update("addressLine", event.target.value)} placeholder="690 Progress Avenue, Unit 7" className={inputClass} /></Field>
      <Field label="城市" required><input disabled={disabled} value={form.city} onChange={(event) => update("city", event.target.value)} placeholder="Toronto" className={inputClass} /></Field>
      <Field label="省 / 州"><input disabled={disabled} value={form.region} onChange={(event) => update("region", event.target.value)} placeholder="Ontario" className={inputClass} /></Field>
      <Field label="国家" required><input disabled={disabled} value={form.country} onChange={(event) => update("country", event.target.value)} placeholder="Canada" className={inputClass} /></Field>
      <Field label="邮政编码"><input disabled={disabled} value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)} placeholder="M1H 3A4" className={inputClass} /></Field>
    </div>
    <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"><div className="flex gap-2"><Globe2 className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>为什么要统一？</strong> 名称、地址、电话不一致会让 Google、地图目录和 AI 搜索误判为不同公司。</p></div></div>
  </StepShell>;
}

function BusinessBoundaryStep({ form, update, disabled }: StepProps) {
  return <StepShell eyebrow="第 2 步，共 4 步" title="告诉青砚真正卖什么、服务哪里" description="每行填写一项。后续体检和内容计划只会使用这里确认过的产品与地区。">
    <div className="grid gap-5 lg:grid-cols-2">
      <ListField label="产品与服务" required count={countLines(form.products)} value={form.products} onChange={(value) => update("products", value)} disabled={disabled} placeholder={"Plantation shutters\nZebra blinds\nMotorized blinds"} />
      <ListField label="服务地区" required count={countLines(form.serviceAreas)} value={form.serviceAreas} onChange={(value) => update("serviceAreas", value)} disabled={disabled} placeholder={"Toronto\nScarborough\nMarkham\nGTA"} />
    </div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <Field label="所属行业" required><input disabled={disabled} value={form.industry} onChange={(event) => update("industry", event.target.value)} placeholder="Custom window coverings" className={inputClass} /></Field>
      <Field label="业务时区"><input disabled={disabled} value={form.timezone} onChange={(event) => update("timezone", event.target.value)} placeholder="America/Toronto" className={inputClass} /></Field>
    </div>
  </StepShell>;
}

function AudienceStep({ form, update, disabled }: StepProps) {
  return <StepShell eyebrow="第 3 步，共 4 步" title="确认客户、竞品和禁止场景" description="竞争对手必须由团队确认，AI 不会把自动猜测的公司直接写进报告。">
    <div className="space-y-5">
      <ListField label="目标客户" count={countLines(form.targetAudiences)} value={form.targetAudiences} onChange={(value) => update("targetAudiences", value)} disabled={disabled} placeholder={"Toronto homeowner\nInterior designer\nGeneral contractor\nProperty manager"} />
      <div className="grid gap-5 lg:grid-cols-2">
        <ListField label="已确认竞争对手" count={countLines(form.competitors)} value={form.competitors} onChange={(value) => update("competitors", value)} disabled={disabled} placeholder={"Budget Blinds\nBlinds To Go\nSelectBlinds"} tone="safe" />
        <ListField label="禁止错误场景" count={countLines(form.forbiddenContexts)} value={form.forbiddenContexts} onChange={(value) => update("forbiddenContexts", value)} disabled={disabled} placeholder={"Photography equipment\nNew York\nBoston\n未提供的产品"} tone="warning" />
      </div>
    </div>
  </StepShell>;
}

function ReviewStep({ form, issues, score, status }: { form: FormState; issues: ValidationIssue[]; score: number | null; status: string }) {
  const rows = [
    ["标准身份", form.legalName || "未填写", [form.addressLine, form.city, form.region, form.country].filter(Boolean).join(", ") || "地址未填写"],
    ["业务范围", `${countLines(form.products)} 项产品 / 服务`, `${countLines(form.serviceAreas)} 个服务地区`],
    ["营销边界", `${countLines(form.targetAudiences)} 类目标客户`, `${countLines(form.competitors)} 个已确认竞品`],
  ];
  return <StepShell eyebrow="第 4 步，共 4 步" title="提交前最后检查" description="提交后青砚会重新计算可信度；未通过时仍会保存资料，并清楚指出需要补充的内容。">
    <div className={cn("rounded-xl border p-5", status === "valid" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
      <div className="flex items-center gap-3">
        {status === "valid" ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <Sparkles className="h-7 w-7 text-amber-600" />}
        <div><div className="font-semibold">{status === "valid" ? "企业事实已可用于营销检测" : "提交后将进行可信度校验"}</div><p className="mt-0.5 text-sm text-muted">{score == null ? "当前尚无校验分数" : `当前可信度 ${score}/100`}</p></div>
      </div>
    </div>
    <div className="mt-5 divide-y divide-border rounded-xl border border-border">
      {rows.map(([label, value, detail]) => <div key={label} className="grid gap-1 p-4 sm:grid-cols-[120px_1fr_1fr]"><div className="text-xs font-medium text-muted">{label}</div><div className="text-sm font-medium">{value}</div><div className="text-sm text-muted">{detail}</div></div>)}
    </div>
    {issues.length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold">仍需关注</h3><div className="mt-2 space-y-2">{issues.map((issue, index) => <div key={`${issue.field}-${index}`} className={cn("flex gap-2 rounded-lg border px-3 py-2 text-sm", issue.severity === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{issue.message}</div>)}</div></div>}
  </StepShell>;
}

interface StepProps {
  form: FormState;
  update: (key: keyof FormState, value: string) => void;
  disabled: boolean;
}

function StepShell({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <section><div className="text-xs font-medium uppercase tracking-[0.16em] text-accent">{eyebrow}</div><h2 className="mt-2 text-xl font-semibold">{title}</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{description}</p><div className="mt-6">{children}</div></section>;
}

function Field({ label, hint, required, wide, children }: { label: string; hint?: string; required?: boolean; wide?: boolean; children: React.ReactNode }) {
  return <label className={cn("block text-sm", wide && "sm:col-span-2")}><span className="mb-1.5 flex items-center gap-1 font-medium">{label}{required && <span className="text-red-500">*</span>}</span>{children}{hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}</label>;
}

function ListField({ label, value, onChange, disabled, placeholder, count, required, tone }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; placeholder: string; count: number; required?: boolean; tone?: "safe" | "warning" }) {
  return <label className="block"><span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-medium"><span>{label}{required && <span className="ml-1 text-red-500">*</span>}</span><span className={cn("rounded-full px-2 py-0.5 text-xs", tone === "safe" ? "bg-emerald-100 text-emerald-700" : tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-background text-muted")}>{count} 项</span></span><textarea disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={6} className={cn(inputClass, "resize-y leading-relaxed")} /><span className="mt-1 block text-xs text-muted">每行一项，也可以用逗号分隔</span></label>;
}

const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-60";
