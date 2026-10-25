"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  MinusCircle,
  Send,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiJson } from "@/lib/api-fetch";
import { listIndustryPacks } from "@/lib/industry-packs/registry";
import { cn } from "@/lib/utils";

type StepStatus = "done" | "todo" | "warning" | "skipped" | "acknowledged";
type StepKey = "pack" | "categories" | "website_channel" | "members" | "wechat" | "test_inquiry" | "email_sender";

interface Step {
  key: StepKey;
  label: string;
  status: StepStatus;
  required: boolean;
  detail: string;
}

interface CatalogEntry {
  key: string;
  labelZh: string;
  labelEn: string;
}

interface ConfigIssue {
  code: string;
  severity: string;
  status: string;
  scope: string;
  title: string;
  message: string;
}

interface Status {
  org: {
    id: string;
    name: string;
    code: string;
    status: string;
    industryPackId: string | null;
    timezone: string | null;
    modules: string[];
    owner: { id: string; name: string; email: string };
  };
  pack: { status: string; id: string | null; name: string | null; message: string | null };
  catalog: CatalogEntry[];
  categories: { published: boolean; version: number | null; make: string[]; dontMake: string[]; excludedCategoryAction: string | null };
  websiteChannel: { exists: boolean; name: string | null; status: string | null; secretPreview: string | null };
  members: Array<{
    userId: string;
    name: string;
    email: string;
    platformRole: string;
    orgRole: string;
    isSalesRole: boolean;
    wechatBound: boolean;
    wechatChannels: string[];
  }>;
  invites: Array<{ id: string; code: string; role: string; orgRole: string | null; label: string | null; state: string; expiresAt: string | null }>;
  testInquiries: Array<{
    receiptId: string;
    eventId: string;
    status: string;
    firstSeenAt: string;
    opportunityStage: string | null;
    draftGenerated: boolean;
    openDrafts: number;
  }>;
  emailSender: { configured: boolean; fromName: string | null; fromEmail: string | null; replyTo: string | null };
  acknowledged: Partial<Record<"wechat" | "email_sender", { at: string }>>;
  configHealth: { overall: string; issues: ConfigIssue[] } | null;
  steps: Step[];
  ready: boolean;
  doneRequired: number;
  totalRequired: number;
}

interface TestStage {
  ok: boolean;
  detail: string;
}

interface TestResult {
  ok: boolean;
  eventId: string;
  error: string | null;
  stages: Record<"receipt" | "opportunity" | "draft" | "notification" | "closed", TestStage>;
}

const PACK_OPTIONS = listIndustryPacks().map((p) => ({ id: p.id, name: p.name }));

const STAGE_LABELS: Record<keyof TestResult["stages"], string> = {
  receipt: "收据（事件身份）",
  opportunity: "线索 / 客户 / 商机",
  draft: "回复草稿进审批",
  notification: "通知业务员",
  closed: "测试单关闭（不可发送）",
};

const ROLE_LABELS: Record<string, string> = {
  trade: "外贸",
  sales: "销售",
  admin: "平台管理员",
  super_admin: "平台管理员",
  boss: "老板",
  org_owner: "企业负责人",
  org_admin: "企业管理员",
  org_member: "成员",
  org_viewer: "只读",
};

const INVITE_STATE_LABELS: Record<string, string> = {
  unused: "未使用",
  used: "已使用",
  expired: "已过期",
  disabled: "已停用",
};

/** 入驻向导的步骤顺序（就绪检查是最后的汇总页） */
const STEPPER: Array<{ key: StepKey | "ready"; title: string }> = [
  { key: "pack", title: "行业包与时区" },
  { key: "categories", title: "产品品类（做 / 不做 / 不确定）" },
  { key: "website_channel", title: "网站渠道密钥" },
  { key: "members", title: "邀请业务员" },
  { key: "wechat", title: "微信绑定" },
  { key: "test_inquiry", title: "发送测试询盘" },
  { key: "ready", title: "就绪检查" },
];

function StatusIcon({ status }: { status: StepStatus | "ready" | "not_ready" }) {
  if (status === "done" || status === "ready") return <CheckCircle2 size={18} className="text-emerald-600" />;
  if (status === "acknowledged" || status === "skipped") return <MinusCircle size={18} className="text-muted" />;
  if (status === "warning" || status === "not_ready") return <AlertTriangle size={18} className="text-amber-600" />;
  return <Circle size={18} className="text-muted" />;
}

function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
    >
      <Copy size={12} />
      {copied ? "已复制" : label}
    </button>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";
const primaryBtn =
  "inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50";

export default function FactoryOnboardingDetailPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<StepKey | "ready" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // 步骤 1
  const [packId, setPackId] = useState("");
  const [timezone, setTimezone] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  // 步骤 2
  const [choice, setChoice] = useState<Record<string, "make" | "dont" | "unsure">>({});
  const [excludedAction, setExcludedAction] = useState<"review" | "decline">("review");
  // 步骤 3
  const [channel, setChannel] = useState<{ secret: string; endpointPath: string; header: string } | null>(null);
  // 步骤 4
  const [inviteRole, setInviteRole] = useState<"trade" | "sales">("trade");
  const [inviteOrgRole, setInviteOrgRole] = useState<"org_member" | "org_admin">("org_member");
  const [inviteCount, setInviteCount] = useState(1);
  const [inviteDays, setInviteDays] = useState(7);
  const [newInvites, setNewInvites] = useState<Array<{ code: string; expiresAt: string | null }>>([]);
  // 步骤 6
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const apply = useCallback((s: Status) => {
    setStatus(s);
    setPackId(s.org.industryPackId ?? "home_textile_trade_v1");
    setTimezone(s.org.timezone ?? "Asia/Shanghai");
    const next: Record<string, "make" | "dont" | "unsure"> = {};
    for (const c of s.catalog) {
      next[c.key] = s.categories.make.includes(c.key) ? "make" : s.categories.dontMake.includes(c.key) ? "dont" : "unsure";
    }
    setChoice(next);
    setExcludedAction(s.categories.excludedCategoryAction === "decline" ? "decline" : "review");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await apiJson<{ status: Status }>(`/api/admin/onboarding/${orgId}`);
      apply(d.status);
      setOpen((cur) => cur ?? (d.status.steps.find((st) => st.required && !["done", "skipped", "acknowledged"].includes(st.status))?.key ?? "ready"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, [orgId, apply]);

  useEffect(() => {
    load();
  }, [load]);

  const stepByKey = useMemo(() => new Map((status?.steps ?? []).map((s) => [s.key, s])), [status]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function run<T>(key: string, fn: () => Promise<T>, okMsg?: string): Promise<T | null> {
    setBusy(key);
    setNotice("");
    setError("");
    try {
      const out = await fn();
      if (okMsg) setNotice(okMsg);
      return out;
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      return null;
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: Record<string, unknown>, okMsg: string) =>
    run("patch", async () => {
      const d = await apiJson<{ status: Status }>(`/api/admin/onboarding/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      apply(d.status);
    }, okMsg);

  if (loading && !status) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }
  if (!status) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link href="/admin/onboarding" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft size={14} /> 返回厂家入驻
        </Link>
        <p className="text-sm text-[#a63d3d]">{error || "企业不存在"}</p>
      </div>
    );
  }

  const salesMembers = status.members.filter((m) => m.isSalesRole);
  const configIssues = (status.configHealth?.issues ?? []).filter((i) => i.severity !== "INFO");

  const body = (key: StepKey | "ready") => {
    switch (key) {
      case "pack":
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              当前：{status.pack.name ?? "未配置"}（{status.org.industryPackId ?? "—"}）· 模块：{status.org.modules.join("、") || "未显式配置"} · 时区：
              {status.org.timezone ?? "未设置"} · 企业 owner：{status.org.owner.name}（{status.org.owner.email}）
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-muted">行业包（修改会重写模块为该包默认模块）</label>
                <select value={packId} onChange={(e) => setPackId(e.target.value)} className={inputCls}>
                  {PACK_OPTIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">时区</label>
                <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">工厂老板邮箱（须已注册）</label>
                <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="不改则留空" className={inputCls} />
              </div>
            </div>
            <button
              type="button"
              className={primaryBtn}
              disabled={busy !== null}
              onClick={() => {
                const b: Record<string, unknown> = {};
                if (timezone.trim() && timezone.trim() !== status.org.timezone) b.timezone = timezone.trim();
                if (packId && packId !== status.org.industryPackId) {
                  if (!confirm("修改行业包会把企业模块重写为该行业包的默认模块，确定？")) return;
                  b.industryPackId = packId;
                }
                if (ownerEmail.trim()) b.ownerEmail = ownerEmail.trim();
                if (!Object.keys(b).length) {
                  setNotice("没有变化");
                  return;
                }
                patch(b, "已保存").then(() => setOwnerEmail(""));
              }}
            >
              {busy === "patch" && <Loader2 size={14} className="animate-spin" />}保存
            </button>
          </div>
        );
      case "categories":
        if (!status.catalog.length) return <p className="text-xs text-muted">该行业包没有品类目录，跳过本步。</p>;
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              「做」写入企业能力范围；「不做」的询盘不自动起草回复（按下方方式处理）；「不确定」按未配置处理（评分减半、提示需内部确认）。
              {status.categories.version ? ` 当前生效版本 v${status.categories.version}。` : ""}
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="bg-background/60 text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">品类</th>
                    <th className="px-3 py-2 font-medium">做</th>
                    <th className="px-3 py-2 font-medium">不做</th>
                    <th className="px-3 py-2 font-medium">不确定</th>
                  </tr>
                </thead>
                <tbody>
                  {status.catalog.map((c) => (
                    <tr key={c.key} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        {c.labelZh}
                        <span className="ml-2 text-xs text-muted">{c.labelEn}</span>
                      </td>
                      {(["make", "dont", "unsure"] as const).map((v) => (
                        <td key={v} className="px-3 py-2 text-center">
                          <input
                            type="radio"
                            name={`cat-${c.key}`}
                            checked={choice[c.key] === v}
                            onChange={() => setChoice((cur) => ({ ...cur, [c.key]: v }))}
                            aria-label={`${c.labelZh} ${v === "make" ? "做" : v === "dont" ? "不做" : "不确定"}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">「不做」品类的询盘</label>
                <select value={excludedAction} onChange={(e) => setExcludedAction(e.target.value as "review" | "decline")} className={inputCls}>
                  <option value="review">留给人工判断婉拒或转介（推荐）</option>
                  <option value="decline">直接判为不合格</option>
                </select>
              </div>
              <button
                type="button"
                className={primaryBtn}
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "categories",
                    async () => {
                      const make = status.catalog.filter((c) => choice[c.key] === "make").map((c) => c.key);
                      const dontMake = status.catalog.filter((c) => choice[c.key] === "dont").map((c) => c.key);
                      const d = await apiJson<{ status: Status }>(`/api/admin/onboarding/${orgId}/categories`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ make, dontMake, excludedCategoryAction: excludedAction }),
                      });
                      await load();
                      return d;
                    },
                    "品类已发布",
                  )
                }
              >
                {busy === "categories" && <Loader2 size={14} className="animate-spin" />}发布品类
              </button>
            </div>
          </div>
        );
      case "website_channel":
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              {status.websiteChannel.exists
                ? `通道「${status.websiteChannel.name}」${status.websiteChannel.status === "active" ? "已启用" : "已停用"}，密钥 ${status.websiteChannel.secretPreview ?? "未生成"}。重复点击沿用原密钥，已嵌入网页的代码不会失效。`
                : "生成后把接口地址和密钥交给工厂网站开发者（或在企业的「外贸 → 消息通道」页复制接入代码）。"}
            </p>
            <button
              type="button"
              className={primaryBtn}
              disabled={busy !== null}
              onClick={() =>
                run("channel", async () => {
                  const d = await apiJson<{ secret: string; endpointPath: string; header: string }>(
                    `/api/admin/onboarding/${orgId}/website-channel`,
                    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
                  );
                  setChannel(d);
                  await load();
                })
              }
            >
              {busy === "channel" && <Loader2 size={14} className="animate-spin" />}
              {status.websiteChannel.exists ? "查看密钥" : "生成网站渠道密钥"}
            </button>
            {channel && (
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-muted">接口地址</span>
                    <CopyButton text={`${origin}${channel.endpointPath}`} />
                  </div>
                  <code className="break-all">{`${origin}${channel.endpointPath}`}</code>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-muted">密钥（请求头 {channel.header}）</span>
                    <CopyButton text={channel.secret} />
                  </div>
                  <code className="break-all">{channel.secret}</code>
                </div>
              </div>
            )}
          </div>
        );
      case "members":
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              企业邀请码单次有效、到期作废；业务员在 {origin}/register 用邀请码注册后直接进入本企业（不建个人工作区），只能是外贸或销售角色。
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-muted">平台角色</label>
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "trade" | "sales")} className={inputCls}>
                  <option value="trade">外贸</option>
                  <option value="sales">销售</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">企业内角色</label>
                <select value={inviteOrgRole} onChange={(e) => setInviteOrgRole(e.target.value as "org_member" | "org_admin")} className={inputCls}>
                  <option value="org_member">成员</option>
                  <option value="org_admin">企业管理员</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">数量</label>
                <input type="number" min={1} max={20} value={inviteCount} onChange={(e) => setInviteCount(Number(e.target.value) || 1)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">有效天数</label>
                <input type="number" min={1} max={30} value={inviteDays} onChange={(e) => setInviteDays(Number(e.target.value) || 7)} className={inputCls} />
              </div>
            </div>
            <button
              type="button"
              className={primaryBtn}
              disabled={busy !== null}
              onClick={() =>
                run(
                  "invites",
                  async () => {
                    const d = await apiJson<{ invites: Array<{ code: string; expiresAt: string | null }> }>(
                      `/api/admin/onboarding/${orgId}/invites`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ role: inviteRole, orgRole: inviteOrgRole, count: inviteCount, expiresInDays: inviteDays }),
                      },
                    );
                    setNewInvites(d.invites);
                    await load();
                  },
                  "邀请码已生成",
                )
              }
            >
              {busy === "invites" && <Loader2 size={14} className="animate-spin" />}生成邀请码
            </button>
            {newInvites.length > 0 && (
              <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-muted">新邀请码（发给业务员）</span>
                  <CopyButton text={newInvites.map((i) => i.code).join("\n")} label="全部复制" />
                </div>
                <ul className="space-y-1 font-mono">
                  {newInvites.map((i) => (
                    <li key={i.code}>{i.code}</li>
                  ))}
                </ul>
              </div>
            )}
            {status.invites.length > 0 && (
              <ul className="divide-y divide-border/60 rounded-lg border border-border text-xs">
                {status.invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="font-mono">{i.code}</span>
                    <span className="text-muted">
                      {ROLE_LABELS[i.role] ?? i.role} · {ROLE_LABELS[i.orgRole ?? ""] ?? i.orgRole ?? "成员"} ·{" "}
                      {INVITE_STATE_LABELS[i.state] ?? i.state}
                      {i.expiresAt ? ` · 到期 ${new Date(i.expiresAt).toLocaleDateString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <MembersTable members={status.members} />
          </div>
        );
      case "wechat":
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              业务员登录后到「设置 → 微信」（/settings/wechat）扫码绑定，新询盘、审批待办才能推到微信。下表实时读取绑定记录。
            </p>
            {salesMembers.length === 0 ? (
              <p className="text-xs text-muted">还没有外贸 / 销售角色的成员。</p>
            ) : (
              <MembersTable members={salesMembers} />
            )}
            <label className="inline-flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={!!status.acknowledged.wechat}
                disabled={busy !== null}
                onChange={(e) => patch({ acknowledge: { wechat: e.target.checked } }, e.target.checked ? "已确认暂不绑定微信" : "已撤销确认")}
              />
              暂不绑定微信（询盘提醒只在站内），视为本步完成
            </label>
          </div>
        );
      case "test_inquiry":
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              用一条合成询盘（买家邮箱在保留域名 example.com，utm_source=qingyan_onboarding_test）走完整链路：收据 → 商机 → FDE 回复草稿 → 通知；
              跑完立即取消草稿、关闭商机、归档测试买家，任何情况下都不会发给买家，也不进收入指标。可能需要 1–3 分钟。
            </p>
            <button
              type="button"
              className={primaryBtn}
              disabled={busy !== null}
              onClick={() =>
                run("test", async () => {
                  const d = await apiJson<{ result: TestResult }>(`/api/admin/onboarding/${orgId}/test-inquiry`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                  });
                  setTestResult(d.result);
                  await load();
                })
              }
            >
              {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}发送测试询盘
            </button>
            {testResult && (
              <div className="rounded-lg border border-border p-3">
                <p className={cn("mb-2 text-sm font-medium", testResult.ok ? "text-emerald-600" : "text-amber-600")}>
                  {testResult.ok ? "全链路通过" : "有环节未通过"}（{testResult.eventId}）
                </p>
                <ul className="space-y-1.5 text-sm">
                  {(Object.keys(STAGE_LABELS) as Array<keyof TestResult["stages"]>).map((k) => (
                    <li key={k} className="flex items-start gap-2">
                      {testResult.stages[k].ok ? (
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle size={16} className="mt-0.5 shrink-0 text-[#a63d3d]" />
                      )}
                      <span>
                        <span className="font-medium">{STAGE_LABELS[k]}</span>
                        <span className="ml-2 text-xs text-muted">{testResult.stages[k].detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {testResult.error && <p className="mt-2 text-xs text-[#a63d3d]">{testResult.error}</p>}
              </div>
            )}
            {status.testInquiries.length > 0 && (
              <ul className="divide-y divide-border/60 rounded-lg border border-border text-xs">
                {status.testInquiries.map((t) => (
                  <li key={t.receiptId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="font-mono">#{t.eventId.slice(t.eventId.lastIndexOf("-") + 1)}</span>
                    <span className="text-muted">
                      {new Date(t.firstSeenAt).toLocaleString()} · 收据 {t.status} · 商机 {t.opportunityStage ?? "—"}
                      {t.draftGenerated ? "" : " · 未生成草稿"}
                      {t.openDrafts ? ` · ⚠ ${t.openDrafts} 份草稿未关闭` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      case "ready":
        return (
          <div className="space-y-4">
            <ul className="space-y-1.5 text-sm">
              {status.steps.map((s) => (
                <li key={s.key} className="flex items-start gap-2">
                  <span className="mt-0.5">
                    <StatusIcon status={s.status} />
                  </span>
                  <span>
                    <span className="font-medium">{s.label}</span>
                    {!s.required && <span className="ml-1 text-xs text-muted">（推荐）</span>}
                    <span className="ml-2 text-xs text-muted">{s.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="rounded-lg border border-border p-3 text-xs">
              <p className="mb-1 font-medium text-foreground">组织发件身份</p>
              <p className="text-muted">
                {status.emailSender.configured
                  ? `${status.emailSender.fromName ?? ""} <${status.emailSender.fromEmail ?? status.emailSender.replyTo ?? ""}>`
                  : "未配置：由企业管理员在「设置 → 邮箱」配置组织发件身份后，批准的回复以企业名义发出。"}
              </p>
              {!status.emailSender.configured && (
                <label className="mt-2 inline-flex items-center gap-2 text-muted">
                  <input
                    type="checkbox"
                    checked={!!status.acknowledged.email_sender}
                    disabled={busy !== null}
                    onChange={(e) =>
                      patch({ acknowledge: { email_sender: e.target.checked } }, e.target.checked ? "已确认暂用平台发件地址" : "已撤销确认")
                    }
                  />
                  暂用平台发件地址
                </label>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-foreground">配置健康（中台检查）</p>
              {configIssues.length === 0 ? (
                <p className="text-xs text-muted">无警告。</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {configIssues.map((i) => (
                    <li key={i.code} className="flex items-start gap-2">
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
                          i.severity === "CRITICAL" || i.severity === "ERROR" ? "bg-red-500/10 text-[#a63d3d]" : "bg-amber-500/10 text-amber-600",
                        )}
                      >
                        {i.scope === "PLATFORM" ? "平台" : "企业"} · {i.severity}
                      </span>
                      <span>
                        {i.title}：<span className="text-muted">{i.message}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/admin/onboarding" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={14} /> 返回厂家入驻
      </Link>
      <PageHeader
        title={`入驻向导：${status.org.name}`}
        description={`${status.org.code} · 必做步骤 ${status.doneRequired}/${status.totalRequired}`}
        meta={
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
              status.ready ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600",
            )}
          >
            {status.ready ? "已就绪，可交付给工厂使用" : "未就绪"}
          </span>
        }
      />
      {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-[#a63d3d]">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      <ol className="space-y-3">
        {STEPPER.map((s, idx) => {
          const st = s.key === "ready" ? null : stepByKey.get(s.key);
          const iconStatus = s.key === "ready" ? (status.ready ? "ready" : "not_ready") : st?.status ?? "todo";
          const expanded = open === s.key;
          return (
            <li key={s.key} className={cn("rounded-xl border bg-card-bg", expanded ? "border-accent/40" : "border-border")}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : s.key)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={expanded}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                    {idx + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {s.key === "ready" ? (status.ready ? "全部必做步骤已完成" : "查看还差哪些步骤") : st?.detail}
                    </span>
                  </span>
                </span>
                <StatusIcon status={iconStatus} />
              </button>
              {expanded && <div className="border-t border-border/60 px-4 py-4">{body(s.key)}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MembersTable({ members }: { members: Status["members"] }) {
  if (!members.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[520px] text-xs">
        <thead className="bg-background/60 text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">成员</th>
            <th className="px-3 py-2 text-left font-medium">平台角色</th>
            <th className="px-3 py-2 text-left font-medium">企业角色</th>
            <th className="px-3 py-2 text-left font-medium">微信</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId} className="border-t border-border/60">
              <td className="px-3 py-2">
                {m.name}
                <span className="ml-2 text-muted">{m.email}</span>
              </td>
              <td className="px-3 py-2">{ROLE_LABELS[m.platformRole] ?? m.platformRole}</td>
              <td className="px-3 py-2">{ROLE_LABELS[m.orgRole] ?? m.orgRole}</td>
              <td className="px-3 py-2">
                {m.wechatBound ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 size={12} /> 已绑定
                  </span>
                ) : (
                  <span className="text-muted">未绑定</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
