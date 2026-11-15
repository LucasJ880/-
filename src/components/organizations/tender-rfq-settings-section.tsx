"use client";

/**
 * W-2 组织详情页「询价与落地价设置」一节（只对组织管理员 / 平台管理员渲染；接口 tender-rfq-settings 只认 org_admin）
 *
 * 读：GET /api/organizations/[orgId]/tender-rfq-settings；项目下拉：GET /api/organizations/[orgId]/projects（只列招投标项目）。
 * 存：PUT 同一个接口，只发改过的项（规则在 src/lib/tender-rfq/settings-form.ts）。
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import {
  ESTIMATE_MODE_LABELS,
  FX_SOURCE_LABELS,
  MAILBOX_NOTE_ZH,
  SETTINGS_PURPOSE_ZH,
  bodyFromForm,
  formFromView,
  type EstimateForm,
  type TenderRfqSettingsForm,
  type TenderRfqSettingsView,
} from "@/lib/tender-rfq/settings-form";

export type TenderProjectOption = { id: string; name: string };

const input = "w-full rounded border border-border bg-transparent px-2 py-1 text-xs text-foreground";
const labelCls = "block text-[11px] text-muted";

export function TenderRfqSettingsSection({ orgId }: { orgId: string }) {
  const [form, setForm] = useState<TenderRfqSettingsForm | null>(null);
  const [initial, setInitial] = useState<TenderRfqSettingsForm | null>(null);
  const [projects, setProjects] = useState<TenderProjectOption[]>([]);
  const [hidden, setHidden] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiJson<TenderRfqSettingsView>(`/api/organizations/${orgId}/tender-rfq-settings`)
      .then((v) => {
        const f = formFromView(v);
        setForm(f);
        setInitial(f);
      })
      .catch(() => setHidden(true));
    apiJson<{ projects?: Array<{ id: string; name: string; workDomain?: string | null }> }>(`/api/organizations/${orgId}/projects`)
      .then((r) => setProjects((r.projects ?? []).filter((p) => p.workDomain === "tender").map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));
  }, [orgId]);
  useEffect(() => {
    load();
  }, [load]);

  if (hidden || !form || !initial) return null;

  const save = async () => {
    setMsg(null);
    const r = bodyFromForm(form, initial);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors([]);
    if (r.empty) {
      setMsg("没有改动");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/organizations/${orgId}/tender-rfq-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r.body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
      if (!res.ok) {
        setErrors([json.error ?? "保存失败", ...(json.issues ?? [])]);
      } else {
        setMsg("已保存");
        load();
      }
    } catch {
      setErrors(["保存失败"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TenderRfqSettingsFields
      form={form}
      onChange={setForm}
      projects={projects}
      errors={errors}
      msg={msg}
      busy={busy}
      onSave={() => void save()}
      onReset={() => {
        setForm(initial);
        setErrors([]);
        setMsg(null);
      }}
    />
  );
}

/** 纯呈现：输入框与按钮；状态在上面的 TenderRfqSettingsSection */
export function TenderRfqSettingsFields({
  form,
  onChange,
  projects,
  errors,
  msg,
  busy,
  onSave,
  onReset,
}: {
  form: TenderRfqSettingsForm;
  onChange: (f: TenderRfqSettingsForm) => void;
  projects: TenderProjectOption[];
  errors: string[];
  msg: string | null;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  const set = <K extends keyof TenderRfqSettingsForm>(k: K, v: TenderRfqSettingsForm[K]) => onChange({ ...form, [k]: v });
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? null;

  const estimate = (key: "freight" | "inland", title: string) => {
    const e: EstimateForm = form[key];
    return (
      <div>
        <span className={labelCls}>{title}</span>
        <div className="mt-0.5 flex gap-2">
          <select
            aria-label={`${title}方式`}
            value={e.mode}
            onChange={(ev) => set(key, { ...e, mode: ev.target.value as EstimateForm["mode"] })}
            className={input}
          >
            <option value="">不填</option>
            {(Object.keys(ESTIMATE_MODE_LABELS) as Array<keyof typeof ESTIMATE_MODE_LABELS>).map((m) => (
              <option key={m} value={m}>
                {ESTIMATE_MODE_LABELS[m]}
              </option>
            ))}
          </select>
          <input
            aria-label={`${title}数值`}
            type="number"
            min={0}
            disabled={e.mode === ""}
            value={e.value}
            onChange={(ev) => set(key, { ...e, value: ev.target.value })}
            className={`${input} max-w-[8rem]`}
          />
        </div>
      </div>
    );
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="tender-rfq-settings">
      <h2 className="text-sm font-semibold text-foreground">询价与落地价设置</h2>
      <p className="mt-1 text-[11px] text-muted" data-testid="tender-rfq-settings-purpose">
        {SETTINGS_PURPOSE_ZH}
      </p>

      {/* 发件 */}
      <h3 className="mt-4 text-xs font-medium text-foreground">询价发件</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className={labelCls}>
          发件显示名
          <input value={form.fromName} onChange={(e) => set("fromName", e.target.value)} className={input} />
        </label>
        <label className={labelCls}>
          显示地址（供应商看到的发件人）
          <input type="email" value={form.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} className={input} />
        </label>
        <label className={labelCls}>
          授权邮箱（实际发信、读回信的账号）
          <input type="email" value={form.mailboxEmail} onChange={(e) => set("mailboxEmail", e.target.value)} className={input} />
        </label>
      </div>
      <p className="mt-1 text-[10px] text-muted" data-testid="tender-rfq-settings-mailbox-note">
        {MAILBOX_NOTE_ZH}
      </p>

      {/* 汇率 */}
      <h3 className="mt-5 text-xs font-medium text-foreground">汇率（1 单位外币 = ? CAD）</h3>
      <div className="mt-2 space-y-1.5">
        {form.fxRows.map((r, i) => (
          <div key={i} className="flex items-center gap-2" data-testid="tender-rfq-fx-row">
            <input
              aria-label={`币种 ${i + 1}`}
              placeholder="USD"
              value={r.currency}
              onChange={(e) => set("fxRows", form.fxRows.map((x, j) => (j === i ? { ...x, currency: e.target.value.toUpperCase() } : x)))}
              className={`${input} max-w-[5rem]`}
            />
            <input
              aria-label={`汇率 ${i + 1}`}
              type="number"
              min={0}
              step="any"
              value={r.rate}
              onChange={(e) => set("fxRows", form.fxRows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))}
              className={`${input} max-w-[8rem]`}
            />
            <button
              type="button"
              aria-label={`删除第 ${i + 1} 行汇率`}
              onClick={() => set("fxRows", form.fxRows.filter((_, j) => j !== i))}
              className="rounded p-1 text-muted hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => set("fxRows", [...form.fxRows, { currency: "", rate: "" }])}
          className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-foreground/80 hover:bg-accent/5"
        >
          <Plus size={12} /> 加一种币种
        </button>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className={labelCls}>
          汇率日期
          <input type="date" value={form.fxAsOf} onChange={(e) => set("fxAsOf", e.target.value)} className={input} />
        </label>
        <label className={labelCls}>
          汇率来源
          <select value={form.fxSource} onChange={(e) => set("fxSource", e.target.value as TenderRfqSettingsForm["fxSource"])} className={input}>
            <option value="">未填</option>
            {(Object.keys(FX_SOURCE_LABELS) as Array<keyof typeof FX_SOURCE_LABELS>).map((s) => (
              <option key={s} value={s}>
                {FX_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1 text-[10px] text-muted">有汇率就必须写明日期与来源；落地价会注明用的是哪天、哪个来源的汇率。</p>

      {/* 估算参数 */}
      <h3 className="mt-5 text-xs font-medium text-foreground">运费、保险、清关（估算参数）</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {estimate("freight", "国际运费（海运）")}
        {estimate("inland", "出口国内陆运费（EXW 用）")}
        <label className={labelCls}>
          保险费率 %
          <input type="number" min={0} max={100} step="any" value={form.insurancePct} onChange={(e) => set("insurancePct", e.target.value)} className={input} />
        </label>
        <label className={labelCls}>
          进口清关杂费（CAD / 票）
          <input type="number" min={0} step="any" value={form.clearanceFlatCad} onChange={(e) => set("clearanceFlatCad", e.target.value)} className={input} />
        </label>
      </div>
      <p className="mt-1 text-[10px] text-muted">GST/HST 不在这里填：进口 GST/HST 可抵扣，不计入落地成本。</p>

      {/* 项目 */}
      <h3 className="mt-5 text-xs font-medium text-foreground">按项目：关税率与交付截止</h3>
      <div className="mt-2 space-y-1.5">
        {form.projects.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2" data-testid="tender-rfq-project-row">
            <select
              aria-label={`项目 ${i + 1}`}
              value={p.projectId}
              onChange={(e) => set("projects", form.projects.map((x, j) => (j === i ? { ...x, projectId: e.target.value } : x)))}
              className={`${input} max-w-[16rem]`}
            >
              <option value="">选择招投标项目</option>
              {p.projectId && !nameOf(p.projectId) ? <option value={p.projectId}>{p.projectId}（不在列表里）</option> : null}
              {projects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <input
              aria-label={`关税率 ${i + 1}`}
              placeholder="关税率 %"
              type="number"
              min={0}
              max={100}
              step="any"
              value={p.dutyRatePct}
              onChange={(e) => set("projects", form.projects.map((x, j) => (j === i ? { ...x, dutyRatePct: e.target.value } : x)))}
              className={`${input} max-w-[7rem]`}
            />
            <input
              aria-label={`交付截止 ${i + 1}`}
              type="date"
              value={p.deliveryDeadline}
              onChange={(e) => set("projects", form.projects.map((x, j) => (j === i ? { ...x, deliveryDeadline: e.target.value } : x)))}
              className={`${input} max-w-[10rem]`}
            />
            <button
              type="button"
              aria-label={`删除第 ${i + 1} 行项目设置`}
              onClick={() => set("projects", form.projects.filter((_, j) => j !== i))}
              className="rounded p-1 text-muted hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => set("projects", [...form.projects, { projectId: "", dutyRatePct: "", deliveryDeadline: "" }])}
          className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-foreground/80 hover:bg-accent/5"
        >
          <Plus size={12} /> 加一个项目
        </button>
      </div>
      <p className="mt-1 text-[10px] text-muted">没有交付截止时，按截标日 +30 天判断交期。</p>

      {errors.length > 0 ? (
        <ul className="mt-3 list-disc rounded border border-danger/40 bg-danger/5 py-1.5 pl-6 pr-2 text-[11px] text-danger" data-testid="tender-rfq-settings-errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          data-testid="tender-rfq-settings-save"
          disabled={busy}
          onClick={onSave}
          className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null}
          保存
        </button>
        <button type="button" disabled={busy} onClick={onReset} className="rounded border border-border px-3 py-1 text-xs text-foreground/80">
          撤销未保存的修改
        </button>
        {msg ? <span className="text-[11px] text-muted">{msg}</span> : null}
      </div>
    </section>
  );
}
