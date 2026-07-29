"use client";

/**
 * 账号运营方案（Playbook）编辑与审批 — Phase B
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { PageHeader } from "@/components/page-header";

type Playbook = {
  id: string;
  version: number;
  basedOnVersion: number | null;
  status: string;
  isEffective: boolean;
  completenessScore: number;
  validationResult: string;
  validationIssues: unknown;
  accountRole: string | null;
  businessObjective: string | null;
  positioning: string | null;
  personaBackground: string | null;
  personality: string | null;
  toneOfVoice: string | null;
  operatingLanguage: string | null;
  operatingRegion: string | null;
  primaryProducts: string | null;
  targetAudienceJson: unknown;
  contentPillarsJson: unknown;
  contentMixJson: unknown;
  visualStyleJson: unknown;
  postingRulesJson: unknown;
  ctaStrategyJson: unknown;
  conversionPathJson: unknown;
  kpiTargetsJson: unknown;
  forbiddenTopicsJson: unknown;
  exampleContentJson: unknown;
  changeSummary: string | null;
  rejectedReason: string | null;
  aiDraftMetaJson: unknown;
};

function jsonToText(v: unknown): string {
  if (v == null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

function textToJson(raw: string): unknown {
  const t = raw.trim();
  if (!t) return null;
  return JSON.parse(t);
}

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  submitted: "待审批",
  approved: "已批准",
  rejected: "已驳回",
  archived: "已归档",
};

export default function MatrixPlaybookPage() {
  const params = useParams();
  const accountId = String(params.accountId ?? "");
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [current, setCurrent] = useState<Playbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [contextPreview, setContextPreview] = useState<unknown>(null);

  // form fields
  const [accountRole, setAccountRole] = useState("");
  const [businessObjective, setBusinessObjective] = useState("");
  const [positioning, setPositioning] = useState("");
  const [personaBackground, setPersonaBackground] = useState("");
  const [personality, setPersonality] = useState("");
  const [toneOfVoice, setToneOfVoice] = useState("");
  const [operatingLanguage, setOperatingLanguage] = useState("");
  const [operatingRegion, setOperatingRegion] = useState("");
  const [primaryProducts, setPrimaryProducts] = useState("");
  const [targetAudience, setTargetAudience] = useState("[]");
  const [contentPillars, setContentPillars] = useState("[]");
  const [ctaStrategy, setCtaStrategy] = useState("{}");
  const [kpiTargets, setKpiTargets] = useState("{}");
  const [forbiddenTopics, setForbiddenTopics] = useState("[]");
  const [changeSummary, setChangeSummary] = useState("");

  const editable = current?.status === "draft" || current?.status === "rejected";

  const fillForm = useCallback((pb: Playbook) => {
    setCurrent(pb);
    setAccountRole(pb.accountRole ?? "");
    setBusinessObjective(pb.businessObjective ?? "");
    setPositioning(pb.positioning ?? "");
    setPersonaBackground(pb.personaBackground ?? "");
    setPersonality(pb.personality ?? "");
    setToneOfVoice(pb.toneOfVoice ?? "");
    setOperatingLanguage(pb.operatingLanguage ?? "");
    setOperatingRegion(pb.operatingRegion ?? "");
    setPrimaryProducts(pb.primaryProducts ?? "");
    setTargetAudience(jsonToText(pb.targetAudienceJson) || "[]");
    setContentPillars(jsonToText(pb.contentPillarsJson) || "[]");
    setCtaStrategy(jsonToText(pb.ctaStrategyJson) || "{}");
    setKpiTargets(jsonToText(pb.kpiTargetsJson) || "{}");
    setForbiddenTopics(jsonToText(pb.forbiddenTopicsJson) || "[]");
    setChangeSummary(pb.changeSummary ?? "");
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch(
        `/api/operations/matrix-accounts/${accountId}/playbooks`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      const list = (data.playbooks ?? []) as Playbook[];
      setPlaybooks(list);
      const pick =
        list.find((p) => p.status === "draft" || p.status === "rejected") ||
        list.find((p) => p.isEffective) ||
        list[0];
      if (pick) fillForm(pick);
      else setCurrent(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [accountId, fillForm]);

  useEffect(() => {
    if (!orgLoading && orgId && accountId) void load();
  }, [orgLoading, orgId, accountId, load]);

  const buildContent = () => {
    try {
      return {
        accountRole,
        businessObjective,
        positioning,
        personaBackground,
        personality,
        toneOfVoice,
        operatingLanguage,
        operatingRegion,
        primaryProducts,
        targetAudienceJson: textToJson(targetAudience),
        contentPillarsJson: textToJson(contentPillars),
        ctaStrategyJson: textToJson(ctaStrategy),
        kpiTargetsJson: textToJson(kpiTargets),
        forbiddenTopicsJson: textToJson(forbiddenTopics),
      };
    } catch {
      throw new Error("JSON 字段格式不正确");
    }
  };

  const issues = useMemo(() => {
    const raw = current?.validationIssues;
    return Array.isArray(raw) ? raw : [];
  }, [current]);

  async function ensureDraft(): Promise<Playbook> {
    if (current && (current.status === "draft" || current.status === "rejected")) {
      return current;
    }
    const res = await apiFetch(
      `/api/operations/matrix-accounts/${accountId}/playbooks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basedOnPlaybookId: current?.id,
          changeSummary: "基于已批准版本创建新草稿",
        }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "创建草稿失败");
    fillForm(data.playbook);
    await load();
    return data.playbook as Playbook;
  }

  async function save(): Promise<Playbook | null> {
    setBusy(true);
    setError(null);
    try {
      const draft = await ensureDraft();
      const content = buildContent();
      const res = await apiFetch(
        `/api/operations/matrix-accounts/${accountId}/playbooks/${draft.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, changeSummary }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      fillForm(data.playbook);
      await load();
      return data.playbook as Playbook;
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const draft = await ensureDraft();
      const content = buildContent();
      const saveRes = await apiFetch(
        `/api/operations/matrix-accounts/${accountId}/playbooks/${draft.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, changeSummary }),
        },
      );
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || "保存失败");
      const playbookId = (saveData.playbook as Playbook).id;
      fillForm(saveData.playbook);
      const res = await apiFetch(
        `/api/operations/matrix-accounts/${accountId}/playbooks/${playbookId}/submit`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "提交失败");
      fillForm(data.playbook);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/operations/matrix-accounts/${accountId}/playbooks/${current.id}/approve`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "批准失败");
      fillForm(data.playbook);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "批准失败");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/operations/matrix-accounts/${accountId}/playbooks/${current.id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: rejectReason }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "驳回失败");
      fillForm(data.playbook);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "驳回失败");
    } finally {
      setBusy(false);
    }
  }

  async function aiDraft() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/operations/matrix-accounts/${accountId}/playbooks/ai-draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 生成失败");
      fillForm(data.draft);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadContext() {
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/operations/matrix-accounts/${accountId}/effective-context?preview=1`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "解析失败");
      setContextPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败");
    } finally {
      setBusy(false);
    }
  }

  if (orgLoading) {
    return <div className="p-6 text-sm text-[var(--muted)]">加载组织…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-6">
      <PageHeader
        title="账号运营方案"
        description="结构化 Playbook：草稿 → 提交 → 批准。已批准版本不可覆盖，修改请开新版本。"
      />
      {ambiguous ? <OrgSelectBanner /> : null}
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/operations/matrix" className="text-[var(--accent)]">
          ← 返回矩阵账号
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="rounded-xl border border-[var(--border)] p-4">
        <h2 className="mb-2 text-sm font-semibold">版本历史</h2>
        <ul className="space-y-1 text-sm">
          {playbooks.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => fillForm(p)}
              >
                v{p.version} · {STATUS_LABEL[p.status] ?? p.status}
                {p.isEffective ? " · 生效" : ""} · 完整度 {p.completenessScore}%
              </button>
            </li>
          ))}
          {playbooks.length === 0 ? (
            <li className="text-[var(--muted)]">尚无 Playbook，可创建草稿或 AI 生成</li>
          ) : null}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void ensureDraft().then(() => load())}
            className="rounded-lg border px-3 py-1.5 text-xs"
          >
            新建/打开草稿
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void aiDraft()}
            className="rounded-lg border px-3 py-1.5 text-xs"
          >
            AI 生成草稿
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void loadContext()}
            className="rounded-lg border px-3 py-1.5 text-xs"
          >
            预览有效上下文
          </button>
        </div>
      </section>

      {current ? (
        <section className="space-y-4 rounded-xl border border-[var(--border)] p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              当前：v{current.version} · {STATUS_LABEL[current.status]}
            </span>
            <span>完整度 {current.completenessScore}%</span>
            <span>校验 {current.validationResult}</span>
            {current.rejectedReason ? (
              <span className="text-red-700">驳回：{current.rejectedReason}</span>
            ) : null}
          </div>

          {issues.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-amber-800">
              {issues.map((it: { message?: string; field?: string }, i: number) => (
                <li key={i}>
                  {it.field}: {it.message}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                ["账号角色", accountRole, setAccountRole],
                ["运营语言", operatingLanguage, setOperatingLanguage],
                ["运营地区", operatingRegion, setOperatingRegion],
              ] as const
            ).map(([label, val, set]) => (
              <label key={label} className="block text-xs">
                <span className="text-[var(--muted)]">{label}</span>
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={val}
                  disabled={!editable}
                  onChange={(e) => set(e.target.value)}
                />
              </label>
            ))}
          </div>

          {(
            [
              ["商业目标", businessObjective, setBusinessObjective],
              ["定位", positioning, setPositioning],
              ["人物背景", personaBackground, setPersonaBackground],
              ["性格", personality, setPersonality],
              ["语气", toneOfVoice, setToneOfVoice],
              ["主要产品", primaryProducts, setPrimaryProducts],
              ["变更摘要", changeSummary, setChangeSummary],
            ] as const
          ).map(([label, val, set]) => (
            <label key={label} className="block text-xs">
              <span className="text-[var(--muted)]">{label}</span>
              <textarea
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                rows={2}
                value={val}
                disabled={!editable}
                onChange={(e) => set(e.target.value)}
              />
            </label>
          ))}

          {(
            [
              ["目标客户 JSON", targetAudience, setTargetAudience],
              ["内容支柱 JSON", contentPillars, setContentPillars],
              ["CTA 策略 JSON", ctaStrategy, setCtaStrategy],
              ["KPI JSON", kpiTargets, setKpiTargets],
              ["禁止话题 JSON", forbiddenTopics, setForbiddenTopics],
            ] as const
          ).map(([label, val, set]) => (
            <label key={label} className="block text-xs">
              <span className="text-[var(--muted)]">{label}</span>
              <textarea
                className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs"
                rows={4}
                value={val}
                disabled={!editable}
                onChange={(e) => set(e.target.value)}
              />
            </label>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !editable}
              onClick={() => void save()}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-[var(--on-accent)] disabled:opacity-50"
            >
              保存草稿
            </button>
            <button
              type="button"
              disabled={busy || !editable}
              onClick={() => void submit()}
              className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              提交审批
            </button>
            <button
              type="button"
              disabled={busy || current.status !== "submitted"}
              onClick={() => void approve()}
              className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              批准（Boss/Admin）
            </button>
            <input
              className="rounded border px-2 py-1 text-xs"
              placeholder="驳回原因"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || current.status !== "submitted"}
              onClick={() => void reject()}
              className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              驳回
            </button>
          </div>
        </section>
      ) : null}

      {contextPreview ? (
        <pre className="max-h-96 overflow-auto rounded-xl border bg-[var(--bg-elevated)] p-3 text-xs">
          {JSON.stringify(contextPreview, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
