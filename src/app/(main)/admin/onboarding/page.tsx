"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Factory, Loader2, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

interface OrgSummary {
  id: string;
  name: string;
  code: string;
  status: string;
  industryPackId: string | null;
  createdAt: string;
  ready: boolean;
  doneRequired: number;
  totalRequired: number;
  pendingStep: string | null;
}

interface PackOption {
  id: string;
  name: string;
  modules: string[];
  workspaces: string[];
  hasCatalog: boolean;
}

const COMMON_TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Ho_Chi_Minh",
  "America/Toronto",
  "America/Los_Angeles",
  "Europe/London",
  "UTC",
];

/** 名称 → code 建议（只取 ASCII；中文名需手填） */
function suggestCode(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export default function FactoryOnboardingListPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [packs, setPacks] = useState<PackOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [packId, setPackId] = useState("home_textile_trade_v1");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    apiJson<{ organizations: OrgSummary[]; packs: PackOption[]; defaultTimezone: string }>("/api/admin/onboarding")
      .then((d) => {
        setOrgs(d.organizations ?? []);
        setPacks(d.packs ?? []);
      })
      .catch(() => setError("读取企业列表失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedPack = packs.find((p) => p.id === packId);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const res = await apiFetch("/api/admin/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim(),
          industryPackId: packId,
          timezone: timezone.trim(),
          ...(ownerEmail.trim() ? { ownerEmail: ownerEmail.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "创建失败");
      router.push(`/admin/onboarding/${data.result.orgId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="厂家入驻"
        description="为新工厂开通青砚：建企业（行业包、模块、时区、工作空间）→ 勾选品类 → 网站渠道密钥 → 邀请业务员 → 微信绑定 → 测试询盘 → 就绪检查。"
      />

      <form onSubmit={handleCreate} className="space-y-4 rounded-xl border border-border bg-card-bg p-5">
        <h2 className="text-sm font-semibold">开通新工厂</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted">企业名称 *</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!codeTouched) setCode(suggestCode(e.target.value));
              }}
              placeholder="例如：Example Textiles"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">企业 code *（小写字母 / 数字 / 连字符，重复提交按 code 幂等）</label>
            <input
              value={code}
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value);
              }}
              placeholder="example-textiles"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">行业包 *</label>
            <select
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.id}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">时区 *（每日简报、跟进按当地时间执行）</label>
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              list="onboarding-timezones"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <datalist id="onboarding-timezones">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-muted">工厂老板登录邮箱（可选，须已注册；留空则暂由你担任企业 owner，之后可在详情页指定）</label>
            <input
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="boss@example.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
        {selectedPack && (
          <p className="text-xs text-muted">
            将启用模块：{selectedPack.modules.join("、")}
            {selectedPack.workspaces.length ? `；默认工作空间：${selectedPack.workspaces.join("、")}` : "；无默认工作空间"}
            {selectedPack.hasCatalog ? "；含产品品类目录" : ""}
          </p>
        )}
        {error && <p className="text-sm text-[#a63d3d]">{error}</p>}
        <button
          type="submit"
          disabled={creating || !name.trim() || !code.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          创建并进入入驻向导
        </button>
      </form>

      <section>
        <h2 className="mb-2 text-sm font-semibold">企业入驻进度</h2>
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          </div>
        ) : orgs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">还没有企业</p>
        ) : (
          <ul className="space-y-2">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/admin/onboarding/${o.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card-bg px-4 py-3 transition-colors hover:border-accent/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Factory size={20} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{o.name}</p>
                      <p className="text-xs text-muted">
                        {o.code} · {o.industryPackId ?? "未配置行业包"}
                        {o.pendingStep ? ` · 下一步：${o.pendingStep}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                        o.ready ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600",
                      )}
                    >
                      {o.ready && <CheckCircle2 size={12} />}
                      {o.ready ? "已就绪" : `${o.doneRequired}/${o.totalRequired}`}
                    </span>
                    <ChevronRight size={16} className="text-muted" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
