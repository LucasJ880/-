"use client";

/**
 * W-2 组织详情页「询价与落地价设置」一节（只对组织管理员 / 平台管理员、且组织在用时渲染；接口 tender-rfq-settings 只认 org_admin）
 *
 * 读：GET /api/organizations/[orgId]/tender-rfq-settings；项目下拉：GET /api/organizations/[orgId]/projects（只列招投标项目）。
 * 存：PUT 同一个接口，只发改过的项（规则在 src/lib/tender-rfq/settings-form.ts）；状态变化全在 settings-section-state.ts 的 reducer 里。
 */

import { useCallback, useEffect, useReducer, type Dispatch } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  ESTIMATE_MODE_LABELS,
  FX_SOURCE_LABELS,
  MAILBOX_NOTE_ZH,
  PIN_MAILBOX_NOTE_ZH,
  SETTINGS_PURPOSE_ZH,
  type EstimateForm,
  type TenderRfqSettingsView,
} from "@/lib/tender-rfq/settings-form";
import {
  initialSectionState,
  prepareSave,
  sectionReducer,
  type SectionAction,
  type SectionState,
} from "@/lib/tender-rfq/settings-section-state";

const input = "w-full rounded border border-border bg-transparent px-2 py-1 text-xs text-foreground disabled:opacity-60";
const labelCls = "block text-[11px] text-muted";

export function TenderRfqSettingsSection({ orgId }: { orgId: string }) {
  const [state, dispatch] = useReducer(sectionReducer, undefined, initialSectionState);

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/organizations/${orgId}/tender-rfq-settings`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) dispatch({ type: "loadFailed", status: res.status });
        else dispatch({ type: "loaded", view: (await res.json()) as TenderRfqSettingsView });
      })
      .catch(() => alive && dispatch({ type: "loadFailed", status: null }));
    apiFetch(`/api/organizations/${orgId}/projects`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) return dispatch({ type: "projectsFailed" });
        const r = (await res.json()) as { projects?: Array<{ id: string; name: string; workDomain?: string | null }> };
        dispatch({ type: "projectsLoaded", projects: (r.projects ?? []).filter((p) => p.workDomain === "tender").map((p) => ({ id: p.id, name: p.name })) });
      })
      .catch(() => alive && dispatch({ type: "projectsFailed" }));
    return () => {
      alive = false;
    };
  }, [orgId]);

  const save = useCallback(async () => {
    const p = prepareSave(state);
    if (p.kind === "noop") return;
    if (p.kind === "errors") return dispatch({ type: "validationFailed", errors: p.errors });
    if (p.kind === "empty") return dispatch({ type: "nothingToSave" });
    dispatch({ type: "saveStarted" });
    try {
      const res = await apiFetch(`/api/organizations/${orgId}/tender-rfq-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p.body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) dispatch({ type: "saveFailed", error: typeof json.error === "string" ? json.error : null, issues: Array.isArray(json.issues) ? (json.issues as string[]) : null });
      else dispatch({ type: "saveSucceeded", view: json as unknown as TenderRfqSettingsView });
    } catch {
      dispatch({ type: "saveFailed" });
    }
  }, [orgId, state]);

  return <TenderRfqSettingsFields state={state} dispatch={dispatch} onSave={() => void save()} />;
}

/** 纯呈现：按状态画输入框与按钮；每个改动都 dispatch 给 reducer */
export function TenderRfqSettingsFields({ state, dispatch, onSave }: { state: SectionState; dispatch: Dispatch<SectionAction>; onSave: () => void }) {
  if (state.phase === "hidden" || state.phase === "loading") return null;
  if (state.phase === "error" || !state.form) {
    return (
      <section className="mt-6 rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="tender-rfq-settings">
        <h2 className="text-sm font-semibold text-foreground">询价与落地价设置</h2>
        <p className="mt-1 text-[11px] text-danger" data-testid="tender-rfq-settings-load-error">
          {state.loadError}
        </p>
      </section>
    );
  }
  const form = state.form;
  const busy = state.busy;
  const nameOf = (id: string) => state.projects.find((p) => p.id === id)?.name ?? null;
  const notSet = (v: string) => `未单独设置，当前用：${v || "（无）"}`;

  const estimate = (key: "freight" | "inland", title: string) => {
    const e: EstimateForm = form[key];
    return (
      <div>
        <span className={labelCls}>{title}</span>
        <div className="mt-0.5 flex gap-2">
          <select aria-label={`${title}方式`} disabled={busy} value={e.mode} onChange={(ev) => dispatch({ type: "estimate", key, patch: { mode: ev.target.value as EstimateForm["mode"] } })} className={input}>
            <option value="">不填</option>
            {(Object.keys(ESTIMATE_MODE_LABELS) as Array<keyof typeof ESTIMATE_MODE_LABELS>).map((m) => (
              <option key={m} value={m}>
                {ESTIMATE_MODE_LABELS[m]}
              </option>
            ))}
          </select>
          <input aria-label={`${title}数值`} inputMode="decimal" disabled={busy || e.mode === ""} value={e.value} onChange={(ev) => dispatch({ type: "estimate", key, patch: { value: ev.target.value } })} className={`${input} max-w-[8rem]`} />
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
          <input disabled={busy} value={form.fromName} placeholder={notSet(form.effective.fromName)} onChange={(e) => dispatch({ type: "set", key: "fromName", value: e.target.value })} className={input} />
        </label>
        <label className={labelCls}>
          显示地址（供应商看到的发件人）
          <input type="email" disabled={busy} value={form.fromEmail} placeholder={notSet(form.effective.fromEmail)} onChange={(e) => dispatch({ type: "set", key: "fromEmail", value: e.target.value })} className={input} />
        </label>
        <label className={labelCls}>
          授权邮箱（实际发信、读回信的账号）
          <input type="email" disabled={busy} value={form.mailboxEmail} placeholder={notSet(form.effective.mailboxEmail)} onChange={(e) => dispatch({ type: "set", key: "mailboxEmail", value: e.target.value })} className={input} />
        </label>
      </div>
      <p className="mt-1 text-[10px] text-muted" data-testid="tender-rfq-settings-mailbox-note">
        {MAILBOX_NOTE_ZH}
        {state.initial && state.initial.mailboxEmail.trim() === "" ? ` ${PIN_MAILBOX_NOTE_ZH}` : ""}
      </p>

      {/* 汇率 */}
      <h3 className="mt-5 text-xs font-medium text-foreground">汇率（1 单位外币 = ? CAD）</h3>
      <div className="mt-2 space-y-1.5">
        {form.fxRows.map((r, i) => (
          <div key={i} className="flex items-center gap-2" data-testid="tender-rfq-fx-row">
            <input aria-label={`币种 ${i + 1}`} placeholder="USD" disabled={busy} value={r.currency} onChange={(e) => dispatch({ type: "fxUpdate", index: i, patch: { currency: e.target.value } })} className={`${input} max-w-[5rem]`} />
            <input aria-label={`汇率 ${i + 1}`} inputMode="decimal" disabled={busy} value={r.rate} onChange={(e) => dispatch({ type: "fxUpdate", index: i, patch: { rate: e.target.value } })} className={`${input} max-w-[8rem]`} />
            <button type="button" aria-label={`删除第 ${i + 1} 行汇率`} disabled={busy} onClick={() => dispatch({ type: "fxRemove", index: i })} className="rounded p-1 text-muted hover:text-danger">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button type="button" disabled={busy} onClick={() => dispatch({ type: "fxAdd" })} className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-foreground/80 hover:bg-accent/5">
          <Plus size={12} /> 加一种币种
        </button>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className={labelCls}>
          汇率日期
          <input type="date" disabled={busy} value={form.fxAsOf} onChange={(e) => dispatch({ type: "set", key: "fxAsOf", value: e.target.value })} className={input} />
        </label>
        <label className={labelCls}>
          汇率来源
          <select disabled={busy} value={form.fxSource} onChange={(e) => dispatch({ type: "set", key: "fxSource", value: e.target.value })} className={input}>
            <option value="">未填</option>
            {(Object.keys(FX_SOURCE_LABELS) as Array<keyof typeof FX_SOURCE_LABELS>).map((s) => (
              <option key={s} value={s}>
                {FX_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1 text-[10px] text-muted">有汇率就必须写明日期与来源；改了汇率，请同时确认日期与来源（三项一起保存）。落地价会注明用的是哪天、哪个来源的汇率。</p>

      {/* 估算参数 */}
      <h3 className="mt-5 text-xs font-medium text-foreground">运费、保险、清关（估算参数）</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {estimate("freight", "国际运费（海运）")}
        {estimate("inland", "出口国内陆运费（EXW 用）")}
        <label className={labelCls}>
          保险费率 %
          <input inputMode="decimal" disabled={busy} value={form.insurancePct} onChange={(e) => dispatch({ type: "set", key: "insurancePct", value: e.target.value })} className={input} />
        </label>
        <label className={labelCls}>
          进口清关杂费（CAD / 票）
          <input inputMode="decimal" disabled={busy} value={form.clearanceFlatCad} onChange={(e) => dispatch({ type: "set", key: "clearanceFlatCad", value: e.target.value })} className={input} />
        </label>
      </div>
      <p className="mt-1 text-[10px] text-muted">GST/HST 不在这里填：进口 GST/HST 可抵扣，不计入落地成本。</p>

      {/* 项目 */}
      <h3 className="mt-5 text-xs font-medium text-foreground">按项目：关税率与交付截止</h3>
      {state.projectsError ? (
        <p className="mt-1 text-[10px] text-amber-700" data-testid="tender-rfq-settings-projects-error">
          {state.projectsError}
        </p>
      ) : null}
      <div className="mt-2 space-y-1.5">
        {form.projects.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2" data-testid="tender-rfq-project-row">
            <select aria-label={`项目 ${i + 1}`} disabled={busy} value={p.projectId} onChange={(e) => dispatch({ type: "projectUpdate", index: i, patch: { projectId: e.target.value } })} className={`${input} max-w-[16rem]`}>
              <option value="">选择招投标项目</option>
              {p.projectId && !nameOf(p.projectId) ? <option value={p.projectId}>{p.projectId}（不在列表里）</option> : null}
              {state.projects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <input aria-label={`关税率 ${i + 1}`} placeholder="关税率 %" inputMode="decimal" disabled={busy} value={p.dutyRatePct} onChange={(e) => dispatch({ type: "projectUpdate", index: i, patch: { dutyRatePct: e.target.value } })} className={`${input} max-w-[7rem]`} />
            <input aria-label={`交付截止 ${i + 1}`} type="date" disabled={busy} value={p.deliveryDeadline} onChange={(e) => dispatch({ type: "projectUpdate", index: i, patch: { deliveryDeadline: e.target.value } })} className={`${input} max-w-[10rem]`} />
            <button type="button" aria-label={`删除第 ${i + 1} 行项目设置`} disabled={busy} onClick={() => dispatch({ type: "projectRemove", index: i })} className="rounded p-1 text-muted hover:text-danger">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button type="button" disabled={busy || !!state.projectsError} onClick={() => dispatch({ type: "projectAdd" })} className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-foreground/80 hover:bg-accent/5 disabled:opacity-50">
          <Plus size={12} /> 加一个项目
        </button>
      </div>
      <p className="mt-1 text-[10px] text-muted">没有交付截止时，按截标日 +30 天判断交期。</p>

      {state.errors.length > 0 ? (
        <ul className="mt-3 list-disc rounded border border-danger/40 bg-danger/5 py-1.5 pl-6 pr-2 text-[11px] text-danger" data-testid="tender-rfq-settings-errors">
          {state.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <button type="button" data-testid="tender-rfq-settings-save" disabled={busy} onClick={onSave} className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-60">
          {busy ? <Loader2 size={12} className="animate-spin" /> : null}
          保存
        </button>
        <button type="button" data-testid="tender-rfq-settings-reset" disabled={busy} onClick={() => dispatch({ type: "reset" })} className="rounded border border-border px-3 py-1 text-xs text-foreground/80">
          撤销未保存的修改
        </button>
        {state.msg ? <span className="text-[11px] text-muted" data-testid="tender-rfq-settings-msg">{state.msg}</span> : null}
      </div>
    </section>
  );
}
