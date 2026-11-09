"use client";

/**
 * PROC-1 申请详情（/projects/intelligence/records/[id]）。
 * 顶部只放「下一步」：按申请状态告诉用户现在做什么（补齐 / 标记就绪 / 开始提交 + 逐步指引 / 登记 / 核对回执 / 等回复 / 复核）。
 * 其余收进页签：申请内容（范围、正文、中文说明）· 进度与文件（提交信息、时间线、附件）· 披露分析（分析、明细复核）·
 * 详细信息（就绪与重复检查、机关规则、待办）。
 * 青砚不登录政府账号、不付款、不代交、不发邮件；不保存政府密码 / 验证码 / 会话 / 银行卡数据。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import {
  AMOUNT_BASES,
  AMOUNT_BASIS_LABELS,
  ANALYSIS_STATUS_LABELS,
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  CASE_EVENT_TYPES,
  EVENT_LABELS,
  EVIDENCE_LEVEL_LABELS,
  FILES_STATUS_LABELS,
  GOVERNMENT_OUTCOMES,
  OUTCOME_LABELS,
  PARSE_STATUS_LABELS,
  PATH_TYPES,
  PATH_TYPE_LABELS,
  RECORD_CATEGORIES,
  RECORD_CATEGORY_LABELS,
  REQUEST_STATUS_LABELS,
  type AmountBasis,
  type AttachmentKind,
  type GovernmentOutcome,
  type PathType,
  type RecordCategory,
  type RequestStatus,
} from "@/lib/procurement-records/labels";
import { nextStepFor, SETUP_BLOCKER_CODES, type DetailTab } from "@/lib/procurement-records/next-step";
import { Btn, Chip, cents, Field, inputCls, KV, Note, NotEnabled, Section, toneForStatus, Unknown, useApiCall, when } from "./primitives";

type Json = Record<string, unknown>;
const arr = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : []);
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
/** 展示用：12.5000 → 12.50，800.0000 → 800 */
const trimZeros = (x: string) => (/\.\d+$/.test(x) ? x.replace(/(\.\d\d)0+$/, "$1").replace(/\.00$/, "") : x);

export function RequestDetailView({ requestId }: { requestId: string }) {
  const [d, setD] = useState<Json | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [applicants, setApplicants] = useState<Json[]>([]);
  const [form, setForm] = useState<Json>({});
  const [body, setBody] = useState("");
  const [sub, setSub] = useState({ submittedAt: "", channel: "", fee: "", currency: "CAD", reference: "", textMode: "SAME_AS_VERSION", actualText: "" });
  const [unknownFacts, setUnknownFacts] = useState("");
  const [guideDone, setGuideDone] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<DetailTab | null>(null);
  const [receipt, setReceipt] = useState({ attachmentId: "", confirm: false, manual: false, reference: "" });
  const [resolveBasis, setResolveBasis] = useState("");
  const [ev, setEv] = useState<Json>({ type: "ACKNOWLEDGED", effectiveAt: "", noteZh: "", attachmentIds: [] as string[], confirmedMatch: false });
  const [upload, setUpload] = useState<{ kind: AttachmentKind; file: File | null }>({ kind: "DISCLOSURE_FILE", file: null });
  const [manual, setManual] = useState<Json>({ attachmentId: "", sourcePage: "", rawSnippet: "", amountBasis: "ORDERED", amount: "", currency: "CAD", quantity: "", unit: "", unitPrice: "", docRef: "", docDate: "", productDescription: "" });
  const api = useApiCall();

  const load = useCallback(async () => {
    const r = await api.call("load", `/api/procurement/requests/${requestId}`);
    if (r.body.available === false) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    if (!r.ok) return;
    const req = r.body.request as Json;
    setD(req);
    setCanEdit(Boolean(r.body.canEdit));
    const v = (req.currentVersion ?? {}) as Json;
    setBody(s(v.bodyEn));
    setForm({
      title: req.title,
      recipientInstitution: req.recipientInstitution ?? "",
      recordsHolderBasis: req.recordsHolderBasis ?? "",
      channel: req.channel,
      pathType: req.pathType,
      startDate: v.startDate ?? "",
      endDate: v.endDate ?? "",
      categories: (v.categories as string[]) ?? [],
      instrumentNumbers: arr(v.instrumentRefs).map((x) => s(x.number)).join(", "),
      applicantProfileId: (req.applicant as Json | null)?.id ?? "",
      overlapReason: req.overlapReason ?? "",
      purposeZh: req.purposeZh ?? "",
      gapsZh: req.gapsZh ?? "",
    });
    const orgId = s(req.orgId);
    const a = await api.call("apps", `/api/procurement/applicants?orgId=${encodeURIComponent(orgId)}`);
    if (a.ok) setApplicants((a.body.items as Json[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const after = (r: { ok: boolean; body: Json }, msg?: string) => {
    if (r.ok) {
      if (r.body.request) setD(r.body.request as Json);
      if (msg) api.setNote({ tone: "good", text: msg });
      void load();
    }
  };
  const action = async (key: string, payload: Json, msg?: string) => after(await api.call(key, `/api/procurement/requests/${requestId}/actions`, { method: "POST", json: payload }), msg);

  const saveDraft = async (regenerate = false) => {
    const v = (d?.currentVersion ?? {}) as Json;
    const patch: Json = {
      title: form.title,
      recipientInstitution: s(form.recipientInstitution) || null,
      recordsHolderBasis: s(form.recordsHolderBasis) || null,
      channel: form.channel,
      pathType: form.pathType,
      startDate: s(form.startDate) || null,
      endDate: s(form.endDate) || null,
      categories: form.categories,
      instrumentNumbers: s(form.instrumentNumbers).split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean),
      applicantProfileId: s(form.applicantProfileId) || null,
      overlapReason: s(form.overlapReason) || null,
      purposeZh: s(form.purposeZh) || null,
      gapsZh: s(form.gapsZh) || null,
      ...(regenerate ? { regenerateBody: true } : body !== s(v.bodyEn) ? { bodyEn: body } : {}),
    };
    after(await api.call("save", `/api/procurement/requests/${requestId}`, { method: "PATCH", json: patch }), "已保存为新版本（旧版本保留）。");
  };

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(s(((d?.currentVersion ?? {}) as Json).bodyEn));
    } catch {
      /* 剪贴板不可用时用户可手动选择复制 */
    }
    await action("copy", { action: "COPIED_BODY" }, "已复制正文（这不等于已提交）。");
  };
  const openPortal = async () => {
    const url = s((d?.rule as Json | null)?.officialPortalUrl);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    await action("open", { action: "OPENED_PORTAL" }, "已打开官方入口：请在官方门户自行登录、验证、付款与提交，然后回来登记结果。");
  };

  const uploadFile = async () => {
    if (!upload.file) return;
    const fd = new FormData();
    fd.set("file", upload.file);
    fd.set("kind", upload.kind);
    api.setNote(null);
    const res = await apiFetch(`/api/procurement/requests/${requestId}/attachments`, { method: "POST", body: fd });
    const j = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) api.setNote({ tone: "bad", text: s(j.error) || `上传失败（${res.status}）` });
    else api.setNote({ tone: "good", text: j.duplicate ? "同一文件已存在（按内容哈希去重）。" : "已上传，正在后台解析；稍后刷新查看解析结果。" });
    setUpload({ ...upload, file: null });
    setTimeout(() => void load(), 2500);
  };

  const addEvent = async () => {
    const payload: Json = {};
    for (const k of ["caseNumber", "registeredAt", "officialDueAt", "outcome", "outcomeNote", "toInstitution", "newCaseNumber", "suggestedInstitution", "followUpAt", "letterReference", "correctsEventId"]) if (s(ev[k])) payload[k] = ev[k];
    if (s(ev.expectedReleasePages)) payload.expectedReleasePages = Number(ev.expectedReleasePages);
    if (s(ev.amountCents)) payload.amountCents = Number(ev.amountCents);
    const r = await api.call("event", `/api/procurement/requests/${requestId}/events`, {
      method: "POST",
      json: { type: ev.type, effectiveAt: s(ev.effectiveAt) || null, noteZh: s(ev.noteZh) || null, attachmentIds: ev.attachmentIds, confirmedMatch: ev.confirmedMatch, payload },
    });
    after(r, r.body.duplicate ? "同一来信已登记过（不重复记录）。" : "已登记（只追加；更正请用「更正」事件指向原事件）。");
  };

  const review = async (lineId: string, act: string, patch?: Json) => {
    after(await api.call(`li-${lineId}`, `/api/procurement/requests/${requestId}/line-items/${lineId}`, { method: "PATCH", json: { action: act, patch } }));
  };
  const addManual = async () => {
    const patch: Json = {};
    for (const k of ["amountBasis", "amount", "currency", "quantity", "unit", "unitPrice", "docRef", "docDate", "productDescription"]) if (s(manual[k])) patch[k] = manual[k];
    const r = await api.call("manual", `/api/procurement/requests/${requestId}/line-items`, { method: "POST", json: { attachmentId: manual.attachmentId, sourcePage: s(manual.sourcePage) ? Number(manual.sourcePage) : null, rawSnippet: manual.rawSnippet, patch } });
    after(r, "已人工录入（记录录入人；指向附件与页码）。");
  };

  if (available === false) return <NotEnabled />;
  if (!d) return <p className="text-sm text-muted">{api.note ? api.note.text : "加载中…"}</p>;

  const v = (d.currentVersion ?? {}) as Json;
  const ready = (d.ready ?? {}) as { ready: boolean; blockers: Array<{ code: string; messageZh: string }> };
  const dup = (d.duplicate ?? {}) as { result: string; ledgerVerified: boolean; overlaps: Json[]; newSegments: Json[]; coveredSegments: Json[]; reasonsZh: string[] };
  const rule = (d.rule ?? null) as Json | null;
  const subm = (d.submission ?? {}) as Json;
  const dl = (d.deadlines ?? {}) as Json;
  const status = s(d.status) as RequestStatus;
  const attachments = arr(d.attachments);
  const analysis = arr(d.analyses)[0] as Json | undefined;
  const res = (analysis?.result ?? {}) as Json;
  const editable = canEdit && !["HANDOFF_PENDING", "SUBMISSION_UNKNOWN"].includes(status) && !d.archived;
  const guide = (d.submissionGuide ?? null) as { actName: string; bodyLanguage: string; steps: Array<{ key: string; titleZh: string; detailZh: string }>; cautionsZh: string[] } | null;
  const bodyLangZh = d.bodyLanguage === "fr" ? "法语" : "英文";

  const step = nextStepFor({ status, filesStatus: s(d.filesStatus), analysisStatus: s(d.analysisStatus), archived: Boolean(d.archived), blockers: d.readyApplicable ? ready.blockers.length : null });
  const activeTab: DetailTab = tab ?? step.tab;
  const TABS: Array<[DetailTab, string]> = [
    ["content", "申请内容"],
    ["progress", "进度与文件"],
    ["analysis", "披露分析"],
    ["details", "详细信息"],
  ];
  const STEP_TONES: Record<string, string> = {
    warn: "border-amber-200 bg-amber-50/60",
    good: "border-emerald-200 bg-emerald-50/60",
    info: "border-sky-200 bg-sky-50/60",
    neutral: "border-border bg-card-bg",
  };
  const showGuide = ["READY", "HANDOFF_PENDING"].includes(status) && !d.archived;

  return (
    <div className="space-y-4" data-testid="request-detail">
      <header className="space-y-1.5">
        <p className="text-xs text-muted">
          <Link href="/projects/intelligence/records" className="underline">← 资料申请</Link>
        </p>
        <h1 className="text-xl font-semibold">{s(d.title)}</h1>
        <p className="text-xs text-muted">
          {s(d.jurisdictionLabel)} · {s(d.recipientDisplay) || "接收机关未定"}
          {d.project ? (
            <>
              {" · "}
              <Link className="text-accent underline" href={`/projects/${s((d.project as Json).id)}?tab=intel`}>{s((d.project as Json).name)}</Link>
            </>
          ) : null}
          {subm.caseNumber ? ` · 案件 ${s(subm.caseNumber)}` : ""}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={toneForStatus(status)}>{REQUEST_STATUS_LABELS[status] ?? status}</Chip>
          {d.filesStatus && d.filesStatus !== "NONE" ? <Chip tone={toneForStatus(s(d.filesStatus))}>{FILES_STATUS_LABELS[s(d.filesStatus)] ?? s(d.filesStatus)}</Chip> : null}
          {d.governmentOutcome ? <Chip>{OUTCOME_LABELS[d.governmentOutcome as GovernmentOutcome]}</Chip> : null}
          {d.origin !== "NORMAL" ? <Chip tone="warn">{d.origin === "HISTORICAL_IMPORT" ? "历史导入（待核实）" : "测试数据（fixture）"}</Chip> : null}
          {d.archived ? <Chip tone="warn">已本地归档（未向政府提交）</Chip> : null}
        </div>
        {d.originNote ? <p className="text-xs text-muted">{s(d.originNote)}</p> : null}
        <Note note={api.note} />
      </header>

      <section className={`rounded-xl border p-4 sm:p-5 ${STEP_TONES[step.tone] ?? STEP_TONES.neutral}`} data-testid="next-step">
        <p className="text-[11px] text-muted">下一步</p>
        <h2 className="text-base font-semibold">{step.titleZh}</h2>
        <p className="mt-0.5 text-xs text-muted">{step.hintZh}</p>
        {step.key === "FIX_DRAFT" ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            {ready.blockers.map((b) => (
              <li key={b.code}>{b.messageZh}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {step.key === "FIX_DRAFT" ? <Btn onClick={() => setTab("content")}>去补齐申请卡</Btn> : null}
          {step.key === "FIX_DRAFT" && ready.blockers.some((b) => SETUP_BLOCKER_CODES.has(b.code)) ? (
            <Link className="self-center text-xs text-accent underline" href="/projects/intelligence/monitor/settings">规则 / 申请人 / 台账去「设置」</Link>
          ) : null}
          {["WAIT_REPLY", "VERIFY_RECEIPT", "RESOLVE_UNKNOWN"].includes(step.key) && canEdit ? <Btn onClick={() => setTab("progress")}>登记来信 / 上传文件</Btn> : null}
          {["REVIEW_FILES", "VIEW_ANALYSIS"].includes(step.key) ? <Btn variant="primary" onClick={() => setTab("analysis")}>{step.key === "REVIEW_FILES" ? "去复核" : "查看分析"}</Btn> : null}
          {status === "DRAFT" && canEdit && step.key === "MARK_READY" ? <Btn variant="primary" onClick={() => void action("ready", { action: "MARK_READY" }, "已就绪。")} busy={api.busy === "ready"} testId="mark-ready">标记就绪</Btn> : null}
          {status === "READY" && canEdit ? <Btn variant="primary" onClick={() => void action("handoff", { action: "START_HANDOFF" }, "已开始交接（服务端重新校验通过）。")} busy={api.busy === "handoff"} testId="start-handoff">开始提交</Btn> : null}
          {(status === "READY" || status === "HANDOFF_PENDING") && canEdit ? (
            <>
              <Btn onClick={() => void copyBody()} testId="copy-body">复制完整正文</Btn>
              <Btn onClick={() => void openPortal()} disabled={!rule?.officialPortalUrl} testId="open-portal">打开经核实的官方入口</Btn>
            </>
          ) : null}
          {status === "HANDOFF_PENDING" && canEdit ? <Btn onClick={() => void action("cancel", { action: "CANCEL_HANDOFF" })}>取消交接</Btn> : null}
          {["DRAFT", "READY"].includes(status) && canEdit && !d.archived ? <Btn variant="link" onClick={() => { const r = window.prompt("本地归档原因（未向政府提交；不同于向政府撤回）"); if (r) void action("archive", { action: "ARCHIVE", reason: r }); }}>归档草稿</Btn> : null}
        </div>
        {dl.officialDueAt || dl.estimatedDueAt ? (
          <p className="mt-2 text-xs text-muted">
            期限：{dl.officialDueAt ? `官方 ${s(dl.officialDueAt)}` : `估算 ${s(dl.estimatedDueAt)}（${s(dl.estimateBasis) || "按规则推算"}）`}
          </p>
        ) : null}
        {showGuide && guide ? (
          <details className="mt-3 rounded-lg border border-border p-3 text-xs" open={["READY", "HANDOFF_PENDING"].includes(status)} data-testid="submission-guide">
            <summary className="cursor-pointer font-medium">
              提交指引：{guide.actName}（{guide.steps.length} 步；勾选只在本页记录，不保存）
            </summary>
            <ol className="mt-2 space-y-1.5">
              {guide.steps.map((g, i) => (
                <li key={g.key}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ minHeight: 0 }} checked={Boolean(guideDone[g.key])} onChange={(e) => setGuideDone({ ...guideDone, [g.key]: e.target.checked })} />
                    <span className={guideDone[g.key] ? "text-muted line-through" : ""}>
                      <span className="font-medium">{i + 1}. {g.titleZh}</span>：{g.detailZh}
                    </span>
                  </label>
                </li>
              ))}
            </ol>
            {guide.cautionsZh.length ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted">
                {guide.cautionsZh.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-muted">金额与时限以规则为准（「详细信息」可看）；规则未核实时，先到「设置 → 机关申请规则」对照官方页面核实。</p>
          </details>
        ) : null}
        {status === "HANDOFF_PENDING" && rule && arr(rule.fieldGuide).length ? (
          <details className="mt-3 text-xs" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && status === "HANDOFF_PENDING") void action("guide", { action: "VIEWED_FIELD_GUIDE" }); }}>
            <summary className="cursor-pointer text-muted">字段对应与附件清单（门户字段名只显示实际观察到的）</summary>
            <table className="mt-1 w-full text-xs">
              <tbody>
                {arr(rule.fieldGuide).map((g) => (
                  <tr key={s(g.ourField)} className="border-t border-border">
                    <td className="py-1 pr-2">{s(g.ourField)}</td>
                    <td className="py-1 text-muted">{g.observed ? `门户字段：${s(g.portalLabel)}（观察于 ${when(s(g.observedAt))}）` : "门户字段名待首次提交时核对并记录"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-muted">附件清单：申请人资料（已确认）、{bodyLangZh}正文（复制）、申请费（如适用，由你在官方渠道支付）。青砚不声称存在通用申请 API。</p>
          </details>
        ) : null}


        {status === "HANDOFF_PENDING" && canEdit ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium">我已在官方渠道提交——登记结果</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="提交时间"><input type="datetime-local" className={inputCls} value={sub.submittedAt} onChange={(e) => setSub({ ...sub, submittedAt: e.target.value })} /></Field>
                <Field label="渠道"><input className={inputCls} value={sub.channel} onChange={(e) => setSub({ ...sub, channel: e.target.value })} placeholder="如 ATIP Online" /></Field>
                <Field label="实际费用（分；未知留空）"><input className={inputCls} value={sub.fee} onChange={(e) => setSub({ ...sub, fee: e.target.value })} /></Field>
                <Field label="submission reference"><input className={inputCls} value={sub.reference} onChange={(e) => setSub({ ...sub, reference: e.target.value })} /></Field>
              </div>
              <Field label="实际提交正文">
                <select className={inputCls} value={sub.textMode} onChange={(e) => setSub({ ...sub, textMode: e.target.value })}>
                  <option value="SAME_AS_VERSION">与交接版本完全一致（我已核对）</option>
                  <option value="ACTUAL_TEXT">有改动——粘贴实际提交正文</option>
                  <option value="UNVERIFIED">不确定——标记「最终提交正文未核实」</option>
                </select>
              </Field>
              {sub.textMode === "ACTUAL_TEXT" ? <textarea className={`${inputCls} h-24 font-mono`} value={sub.actualText} onChange={(e) => setSub({ ...sub, actualText: e.target.value })} /> : null}
              <Btn
                variant="primary"
                busy={api.busy === "report"}
                onClick={() =>
                  void action("report", {
                    action: "REPORT_SUBMISSION",
                    submittedAt: sub.submittedAt ? new Date(sub.submittedAt).toISOString() : "",
                    channel: sub.channel,
                    actualFeeCents: sub.fee.trim() === "" ? null : Number(sub.fee),
                    feeCurrency: sub.currency,
                    submissionReference: sub.reference || null,
                    text: sub.textMode === "SAME_AS_VERSION" ? { mode: "SAME_AS_VERSION", versionId: s(v.id) } : sub.textMode === "ACTUAL_TEXT" ? { mode: "ACTUAL_TEXT", bodyEn: sub.actualText } : { mode: "UNVERIFIED" },
                  }, "已登记为「用户报告已提交（待核实）」；上传回执并核对后才是 SUBMITTED。")
                }
              >
                登记提交（待核实）
              </Btn>
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium">付款 / 提交页面超时，不确定是否成功</p>
              <textarea className={`${inputCls} h-20`} value={unknownFacts} onChange={(e) => setUnknownFacts(e.target.value)} placeholder="已知事实（每行一条），如：点了提交后页面超时；信用卡显示待处理扣款 5 CAD" />
              <Btn variant="danger" busy={api.busy === "unknown"} onClick={() => void action("unknown", { action: "REPORT_UNKNOWN", knownFacts: unknownFacts.split("\n").filter(Boolean) }, "已记为提交结果不确定：不自动重试，也不要改用其他渠道重复申请；请核查官方账户、确认邮件或回执。")}>
                记为「提交结果不确定」
              </Btn>
            </div>
          </div>
        ) : null}


        {["USER_REPORTED_SUBMISSION", "SUBMISSION_UNKNOWN"].includes(status) && canEdit ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium">核对回执（先在「进度与文件」上传回执 / 受理确认）</p>
              <select className={inputCls} value={receipt.attachmentId} onChange={(e) => setReceipt({ ...receipt, attachmentId: e.target.value })}>
                <option value="">选择回执附件</option>
                {attachments.map((a) => <option key={s(a.id)} value={s(a.id)}>{s(a.originalFilename)} · {ATTACHMENT_KIND_LABELS[a.kind as AttachmentKind]}</option>)}
              </select>
              {!subm.submissionReference ? <input className={inputCls} placeholder="submission reference" value={receipt.reference} onChange={(e) => setReceipt({ ...receipt, reference: e.target.value })} /> : null}
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={receipt.manual} onChange={(e) => setReceipt({ ...receipt, manual: e.target.checked })} /> 回执无可读文本，我已目视核对编号与接收机关</label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={receipt.confirm} onChange={(e) => setReceipt({ ...receipt, confirm: e.target.checked })} /> 我确认此回执属于本申请与该接收机关</label>
              <Btn variant="primary" busy={api.busy === "verify"} disabled={!receipt.attachmentId || !receipt.confirm} onClick={() => void action("verify", { action: "VERIFY_RECEIPT", attachmentId: receipt.attachmentId, confirm: receipt.confirm, manualVisualCheck: receipt.manual, submissionReference: receipt.reference || undefined }, "回执核对通过：SUBMITTED（document_verified）。")}>
                核对并确认
              </Btn>
              <p className="text-[11px] text-muted">仅付款凭证或未显示接收确认的截图不能证明提交成功。系统比对编号与机关名只是辅助，最终由你确认。</p>
            </div>
            {status === "SUBMISSION_UNKNOWN" ? (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs font-medium">核查后确认没有提交</p>
                <textarea className={`${inputCls} h-20`} value={resolveBasis} onChange={(e) => setResolveBasis(e.target.value)} placeholder="依据：如官方账户无该申请记录、无扣款" />
                <Btn busy={api.busy === "resolve"} onClick={() => void action("resolve", { action: "RESOLVE_NOT_SUBMITTED", basisZh: resolveBasis })}>确认未提交（回到就绪）</Btn>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <nav className="flex flex-wrap gap-1 border-b border-border text-xs" role="tablist" data-testid="detail-tabs">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={activeTab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 ${activeTab === k ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "content" ? (
        <>
          <Section title="范围、机关与申请人" hint="接收机关按所需记录核实（发布平台不是接收机关）。" testId="scope-form">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="标题"><input className={inputCls} value={s(form.title)} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={!editable} /></Field>
              <Field label="接收机关（资料持有机关）"><input className={inputCls} value={s(form.recipientInstitution)} onChange={(e) => setForm({ ...form, recipientInstitution: e.target.value })} disabled={!editable} /></Field>
              <Field label="持有依据"><input className={inputCls} value={s(form.recordsHolderBasis)} onChange={(e) => setForm({ ...form, recordsHolderBasis: e.target.value })} disabled={!editable} /></Field>
              <Field label="资料取得路径">
                <select className={inputCls} value={s(form.pathType)} onChange={(e) => setForm({ ...form, pathType: e.target.value })} disabled={!editable}>
                  {PATH_TYPES.map((p) => <option key={p} value={p}>{PATH_TYPE_LABELS[p as PathType]}</option>)}
                </select>
              </Field>
              <Field label="渠道">
                <select className={inputCls} value={s(form.channel)} onChange={(e) => setForm({ ...form, channel: e.target.value })} disabled={!editable}>
                  <option value="FORMAL">正式</option>
                  <option value="INFORMAL">非正式（既有披露副本）</option>
                </select>
              </Field>
              <Field label="申请人">
                <select className={inputCls} value={s(form.applicantProfileId)} onChange={(e) => setForm({ ...form, applicantProfileId: e.target.value })} disabled={!editable}>
                  <option value="">（未选择）</option>
                  {applicants.map((a) => <option key={s(a.id)} value={s(a.id)}>{s(a.label)} v{s(a.version)}{a.verificationStatus === "CONFIRMED" ? "" : "（未确认）"}</option>)}
                </select>
              </Field>
              <Field label="起始日（含）"><input type="date" className={inputCls} value={s(form.startDate)} onChange={(e) => setForm({ ...form, startDate: e.target.value })} disabled={!editable} /></Field>
              <Field label="结束日（含）"><input type="date" className={inputCls} value={s(form.endDate)} onChange={(e) => setForm({ ...form, endDate: e.target.value })} disabled={!editable} /></Field>
              <Field label="合同 / SO / 招标编号（逗号分隔）"><input className={inputCls} value={s(form.instrumentNumbers)} onChange={(e) => setForm({ ...form, instrumentNumbers: e.target.value })} disabled={!editable} /></Field>
            </div>
            <fieldset className="mt-2 space-y-1">
              <legend className="text-[11px] font-medium text-muted">记录类别</legend>
              {RECORD_CATEGORIES.map((c) => (
                <label key={c} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ minHeight: 0 }} disabled={!editable} checked={((form.categories as string[]) ?? []).includes(c)} onChange={(e) => setForm({ ...form, categories: e.target.checked ? [...((form.categories as string[]) ?? []), c] : ((form.categories as string[]) ?? []).filter((x) => x !== c) })} />
                  {RECORD_CATEGORY_LABELS[c as RecordCategory]}
                </label>
              ))}
            </fieldset>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="用途（中文）"><textarea className={`${inputCls} h-14`} value={s(form.purposeZh)} onChange={(e) => setForm({ ...form, purposeZh: e.target.value })} disabled={!editable} /></Field>
              <Field label="还缺什么"><textarea className={`${inputCls} h-14`} value={s(form.gapsZh)} onChange={(e) => setForm({ ...form, gapsZh: e.target.value })} disabled={!editable} /></Field>
              <Field label="与历史 / 草稿重叠时的新增范围或理由"><input className={inputCls} value={s(form.overlapReason)} onChange={(e) => setForm({ ...form, overlapReason: e.target.value })} disabled={!editable} /></Field>
            </div>
          </Section>

          <Section
            title={`${bodyLangZh}正文（v${s(v.versionNo)} · text hash ${s(v.textHash).slice(0, 12)}）`}
            hint="方括号是待补的数据；每次修改都存新版本，已提交版本不会被覆盖。"
            testId="body"
            actions={editable ? (
              <>
                <Btn onClick={() => void saveDraft(true)} busy={api.busy === "save"}>按模板重新生成</Btn>
                <Btn variant="primary" onClick={() => void saveDraft(false)} busy={api.busy === "save"} testId="save-draft">保存为新版本</Btn>
              </>
            ) : null}
          >
            <textarea className={`${inputCls} h-72 font-mono leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} data-testid="body-en" />
            {d.submittedVersion ? (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-muted">已提交版本 v{s((d.submittedVersion as Json).versionNo)}（hash {s((d.submittedVersion as Json).textHash).slice(0, 12)}，不可覆盖）</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-border p-2">{s((d.submittedVersion as Json).bodyEn)}</pre>
              </details>
            ) : null}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted">版本历史（{arr(d.versions).length}）</summary>
              <ul className="mt-1 space-y-0.5">
                {arr(d.versions).map((x) => (
                  <li key={s(x.id)}>
                    v{s(x.versionNo)} · {s(x.kind)} · {when(s(x.createdAt))} · {s(x.createdBy)} · text {s(x.textHash).slice(0, 10)} · scope {s(x.scopeFingerprint).slice(0, 10)}
                    {x.isCurrent ? " · 当前" : ""}
                    {x.isHandoff ? " · 交接版本" : ""}
                    {x.isSubmitted ? " · 已提交" : ""}
                  </li>
                ))}
              </ul>
            </details>
          </Section>

          <Section title="中文说明与资料检查" hint="与正文同源生成；不承诺何时取得。" testId="explanation">
            <div className="whitespace-pre-wrap text-xs leading-relaxed">{s(v.explanationZh) || "—"}</div>
            <div className="mt-3 space-y-1">
              <KV k="关联 Tender" v={d.project ? <Link className="text-accent underline" href={`/projects/${s((d.project as Json).id)}?tab=intel`}>{s((d.project as Json).name)}</Link> : "未关联"} />
              <KV k="关联合同 / SO" v={arr(d.instruments).map((i) => `${s(i.officialNumber)}${i.lastVerifiedAt ? `（核实于 ${when(s(i.lastVerifiedAt))}）` : "（未核实）"}`).join("、") || "—"} />
              <KV k="公开资料检查" v={(d.pathChecks as Json | null)?.publicRecords ? `${s(((d.pathChecks as Json).publicRecords as Json).summaryZh)}（${when(s(((d.pathChecks as Json).publicRecords as Json).checkedAt))}）` : "未记录"} />
              <KV k="既有披露检查" v={(d.pathChecks as Json | null)?.completedAti ? `${s(((d.pathChecks as Json).completedAti as Json).summaryZh)}（${when(s(((d.pathChecks as Json).completedAti as Json).checkedAt))}）` : "未记录"} />
            </div>
            {canEdit ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn onClick={() => { const t = window.prompt("写明检查了哪些公开公告 / 合同 / 修订 / 公开合同数据与结论"); if (t) void action("pc1", { action: "PATH_CHECK", kind: "publicRecords", summaryZh: t }); }}>记录公开资料检查</Btn>
                <Btn onClick={() => { const t = window.prompt("写明检索了哪些 Completed ATI 摘要与结论（有既有披露时优先索取副本）"); if (t) void action("pc2", { action: "PATH_CHECK", kind: "completedAti", summaryZh: t }); }}>记录既有披露检查</Btn>
                {arr(d.manualSearchLinks).map((l) => (
                  <a key={s(l.url)} href={s(l.url)} target="_blank" rel="noreferrer noopener" className="text-xs text-accent underline">
                    {s(l.label)}
                  </a>
                ))}
              </div>
            ) : null}
          </Section>
        </>
      ) : null}

      {activeTab === "progress" ? (
        <>
          <Section title="提交信息" testId="submission">
            <div className="space-y-1 text-xs">
                  <KV k="提交时间" v={when(subm.submittedAt as string | null)} />
                  <KV k="submission reference" v={s(subm.submissionReference) || "—"} />
                  <KV k="正式案件编号" v={s(subm.caseNumber) || "—"} />
                  <KV k="提交正文" v={subm.submittedTextVerified === false ? "最终提交正文未核实" : subm.submittedVersionId ? "已对应到版本" : "—"} />
                  <KV k="核实" v={subm.verifiedAt ? `${s(subm.verifiedBy)} · ${when(s(subm.verifiedAt))} · ${s(subm.verificationMethod)}` : "—"} />
                  {d.transfer ? <KV k="转交" v={`${s((d.transfer as Json).toInstitution)} · 新编号 ${s((d.transfer as Json).newCaseNumber) || "—"} · ${(d.transfer as Json).status === "PENDING_CONFIRMATION" ? "待确认" : s((d.transfer as Json).status)}`} /> : null}
            </div>
          </Section>
          <Section title="时间线与来信登记" hint={`${s((d.mailIntake as Json)?.note)}。记录只追加，更正用「更正」。`} testId="timeline">
            <ol className="space-y-1 text-xs">
              {arr(d.events).map((e) => (
                <li key={s(e.id)} className="flex flex-wrap gap-1">
                  <span className="text-muted">{when(s(e.recordedAt))}</span>
                  <span className="font-medium">{s(e.label)}</span>
                  {e.evidenceLevel ? <Chip tone={toneForStatus(s(e.evidenceLevel))}>{EVIDENCE_LEVEL_LABELS[s(e.evidenceLevel)] ?? s(e.evidenceLevel)}</Chip> : null}
                  {e.actor ? <span className="text-muted">· {s(e.actor)}</span> : null}
                  {e.effectiveAt ? <span className="text-muted">· 生效 {when(s(e.effectiveAt))}</span> : null}
                  {e.noteZh ? <span>— {s(e.noteZh)}</span> : null}
                </li>
              ))}
            </ol>
            {canEdit ? (
              <div className="mt-3 grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
                <Field label="事件类型">
                  <select className={inputCls} value={s(ev.type)} onChange={(e) => setEv({ ...ev, type: e.target.value })}>
                    {CASE_EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABELS[t] ?? t}</option>)}
                  </select>
                </Field>
                <Field label="来信日期 / 生效时间"><input type="date" className={inputCls} value={s(ev.effectiveAt)} onChange={(e) => setEv({ ...ev, effectiveAt: e.target.value })} /></Field>
                <Field label="说明"><input className={inputCls} value={s(ev.noteZh)} onChange={(e) => setEv({ ...ev, noteZh: e.target.value })} /></Field>
                {ev.type === "ACKNOWLEDGED" ? (
                  <>
                    <Field label="正式案件编号"><input className={inputCls} value={s(ev.caseNumber)} onChange={(e) => setEv({ ...ev, caseNumber: e.target.value })} /></Field>
                    <Field label="机关登记日"><input type="date" className={inputCls} value={s(ev.registeredAt)} onChange={(e) => setEv({ ...ev, registeredAt: e.target.value })} /></Field>
                  </>
                ) : null}
                {["EXTENSION", "CLARIFICATION_REQUEST"].includes(s(ev.type)) ? <Field label="来信写明的日期（官方期限）"><input type="date" className={inputCls} value={s(ev.officialDueAt)} onChange={(e) => setEv({ ...ev, officialDueAt: e.target.value })} /></Field> : null}
                {["RESPONSE_LETTER", "PARTIAL_RELEASE", "FINAL_RESPONSE"].includes(s(ev.type)) ? <Field label="来信称附件页数"><input className={inputCls} value={s(ev.expectedReleasePages)} onChange={(e) => setEv({ ...ev, expectedReleasePages: e.target.value })} /></Field> : null}
                {ev.type === "FINAL_RESPONSE" ? (
                  <>
                    <Field label="政府处理结果">
                      <select className={inputCls} value={s(ev.outcome)} onChange={(e) => setEv({ ...ev, outcome: e.target.value })}>
                        <option value="">选择</option>
                        {GOVERNMENT_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
                      </select>
                    </Field>
                    <Field label="处理说明（豁免条款等）"><input className={inputCls} value={s(ev.outcomeNote)} onChange={(e) => setEv({ ...ev, outcomeNote: e.target.value })} /></Field>
                  </>
                ) : null}
                {ev.type === "TRANSFERRED" ? (
                  <>
                    <Field label="接收转交的机关"><input className={inputCls} value={s(ev.toInstitution)} onChange={(e) => setEv({ ...ev, toInstitution: e.target.value })} /></Field>
                    <Field label="新案件编号"><input className={inputCls} value={s(ev.newCaseNumber)} onChange={(e) => setEv({ ...ev, newCaseNumber: e.target.value })} /></Field>
                  </>
                ) : null}
                {ev.type === "TRANSFER_ADVISED" ? <Field label="建议联系的机关"><input className={inputCls} value={s(ev.suggestedInstitution)} onChange={(e) => setEv({ ...ev, suggestedInstitution: e.target.value })} /></Field> : null}
                {ev.type === "INTERNAL_FOLLOW_UP" ? <Field label="提醒时间"><input type="datetime-local" className={inputCls} value={s(ev.followUpAt)} onChange={(e) => setEv({ ...ev, followUpAt: e.target.value ? new Date(e.target.value).toISOString() : "" })} /></Field> : null}
                {ev.type === "CORRECTION" ? (
                  <Field label="被更正的事件">
                    <select className={inputCls} value={s(ev.correctsEventId)} onChange={(e) => setEv({ ...ev, correctsEventId: e.target.value })}>
                      <option value="">选择</option>
                      {arr(d.events).map((x) => <option key={s(x.id)} value={s(x.id)}>{when(s(x.recordedAt))} {s(x.label)}</option>)}
                    </select>
                  </Field>
                ) : null}
                <Field label="附件（来信 / 回执）">
                  <select multiple className={`${inputCls} h-16`} value={(ev.attachmentIds as string[]) ?? []} onChange={(e) => setEv({ ...ev, attachmentIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
                    {attachments.map((a) => <option key={s(a.id)} value={s(a.id)}>{s(a.originalFilename)}</option>)}
                  </select>
                </Field>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(ev.confirmedMatch)} onChange={(e) => setEv({ ...ev, confirmedMatch: e.target.checked })} /> 我已核对所附来信属于本申请</label>
                <div className="flex items-end"><Btn variant="primary" onClick={() => void addEvent()} busy={api.busy === "event"}>登记</Btn></div>
              </div>
            ) : null}
          </Section>

          <Section title="附件" hint="回执、来信、披露文件都传在这里（私有存储，同一文件不重复）。只有披露文件参与分析。" testId="attachments">
            {canEdit ? (
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <Field label="类别">
                  <select className={inputCls} value={upload.kind} onChange={(e) => setUpload({ ...upload, kind: e.target.value as AttachmentKind })}>
                    {ATTACHMENT_KINDS.map((k) => <option key={k} value={k}>{ATTACHMENT_KIND_LABELS[k]}</option>)}
                  </select>
                </Field>
                <input type="file" accept=".pdf,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.txt" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} className="text-xs" />
                <Btn variant="primary" onClick={() => void uploadFile()} disabled={!upload.file}>上传</Btn>
              </div>
            ) : null}
            <ul className="space-y-1 text-xs">
              {attachments.map((a) => (
                <li key={s(a.id)} className="flex flex-wrap items-center gap-1.5">
                  <a className="text-accent underline" href={s(a.downloadUrl)}>{s(a.originalFilename)}</a>
                  <Chip>{ATTACHMENT_KIND_LABELS[a.kind as AttachmentKind] ?? s(a.kind)}</Chip>
                  <Chip tone={toneForStatus(s(a.parseStatus))}>{PARSE_STATUS_LABELS[s(a.parseStatus)] ?? s(a.parseStatus)}</Chip>
                  <span className="text-muted">{Math.round(Number(a.sizeBytes) / 1024)} KB · sha256 {s(a.contentHash).slice(0, 12)}{a.pageCount ? ` · ${s(a.pageCount)} 页` : ""} · {when(s(a.uploadedAt))}</span>
                  {a.parseError ? <span className="text-muted">· {s(a.parseError)}</span> : null}
                </li>
              ))}
              {attachments.length === 0 ? <li className="text-muted">暂无附件。</li> : null}
            </ul>
          </Section>
        </>
      ) : null}

      {activeTab === "analysis" ? (
        <>
          <Section
            title={s(res.headlineZh) || "分析"}
            hint="各金额口径分列，不相加成总采购；公开合同值 ≠ 实际支出；无记录 ≠ 0；只合计已确认明细。"
            testId="analysis"
            actions={
              <>
                {canEdit ? <Btn onClick={() => void action("analyze", { action: "RUN_ANALYSIS" }, "已生成新分析版本。")} busy={api.busy === "analyze"}>重新分析</Btn> : null}
                <a className="text-xs text-accent underline" href={`/api/procurement/requests/${requestId}/export?format=md`}>导出申请卡（Markdown）</a>
                <a className="text-xs text-accent underline" href={`/api/procurement/requests/${requestId}/export?format=csv`}>导出明细（CSV）</a>
              </>
            }
          >
            {analysis ? (
              <div className="space-y-3 text-xs">
                <p className="text-muted">分析 v{s(analysis.versionNo)} · {ANALYSIS_STATUS_LABELS[s(analysis.status)] ?? s(analysis.status)} · {when(s(analysis.createdAt))} · 明细 {s(analysis.lineItemCount)}（已确认 {s(analysis.confirmedCount)}）</p>
                <table className="w-full text-xs">
                  <thead className="text-left text-muted"><tr><th className="py-1 pr-2">金额口径</th><th className="py-1 pr-2">币种</th><th className="py-1 pr-2">已取得记录的合计</th><th className="py-1 pr-2">其中贷项 / 取消</th><th className="py-1">条数（去重）</th></tr></thead>
                  <tbody>
                    {arr(res.totals).map((t) => (
                      <tr key={`${s(t.basis)}-${s(t.currency)}`} className="border-t border-border">
                        <td className="py-1 pr-2">{AMOUNT_BASIS_LABELS[t.basis as AmountBasis] ?? s(t.basis)}</td>
                        <td className="py-1 pr-2">{s(t.currency)}</td>
                        <td className="py-1 pr-2 font-medium">{s(t.total)}</td>
                        <td className="py-1 pr-2">{s(t.credits)}</td>
                        <td className="py-1">{s(t.lineCount)}{Number(t.duplicatesExcluded) ? `（排除重复 ${s(t.duplicatesExcluded)}）` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {arr(res.quantities).length ? <p>数量：{arr(res.quantities).map((x) => `${s(x.product)} ${trimZeros(s(x.quantity))} ${s(x.unit)}（${AMOUNT_BASIS_LABELS[x.basis as AmountBasis] ?? s(x.basis)}）`).join("；")}</p> : null}
                {arr(res.unitPrices).length ? <p>已知单价：{arr(res.unitPrices).map((x) => `${s(x.product)} ${trimZeros(s(x.min))}–${trimZeros(s(x.max))} ${s(x.currency)}/${s(x.unit)}（最新 ${trimZeros(s(x.latest))}${x.latestDate ? ` @ ${s(x.latestDate)}` : ""}）`).join("；")}</p> : null}
                {arr((res.orderFrequency as Json | undefined)?.byMonth).length ? <p>订单频率：{arr((res.orderFrequency as Json).byMonth).map((x) => `${s(x.month)}×${s(x.orders)}`).join("、")}；目的地：{arr((res.orderFrequency as Json).byDestination).map((x) => `${s(x.destination)}×${s(x.orders)}`).join("、")}</p> : null}
                {arr(res.publicValueNotes).length ? <ul className="list-disc pl-5">{(res.publicValueNotes as string[]).map((n) => <li key={n}>{n}</li>)}</ul> : null}
                <div>
                  <p className="font-medium">覆盖</p>
                  <p className="text-muted">
                    机关 {s((analysis.coverage as Json).institution) || "—"} · 合同 {((analysis.coverage as Json).instruments as string[] | undefined)?.join("、") || "—"} · 申请期间 {s(((analysis.coverage as Json).requestedRange as Json)?.start)}–{s(((analysis.coverage as Json).requestedRange as Json)?.end)} · 记录期间 {s(((analysis.coverage as Json).documentedRange as Json)?.start) || "—"}–{s(((analysis.coverage as Json).documentedRange as Json)?.end) || "—"} · 已分析 {s((analysis.coverage as Json).analyzedPages)} 页{(analysis.coverage as Json).expectedReleasePages ? ` / 来信称 ${s((analysis.coverage as Json).expectedReleasePages)} 页` : ""}
                  </p>
                </div>
                <div>
                  <p className="font-medium">缺口</p>
                  <ul className="list-disc pl-5">{((analysis.gaps as string[]) ?? []).map((g) => <li key={g}>{g}</li>)}</ul>
                </div>
                <details>
                  <summary className="cursor-pointer text-muted">推算假设</summary>
                  <ul className="list-disc pl-5">{((analysis.assumptions as string[]) ?? []).map((g) => <li key={g}>{g}</li>)}</ul>
                </details>
              </div>
            ) : (
              <p className="text-xs text-muted">尚未分析。上传披露文件后自动生成；只有来信时不会分析附件。</p>
            )}
          </Section>

          <Section title="明细复核" hint="自动抽取的明细默认待复核；缺失值留空（不是 0），每条可追溯到页码或表格行。" testId="line-items">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1 pr-2">来源</th>
                    <th className="py-1 pr-2">单号 / 日期</th>
                    <th className="py-1 pr-2">品名</th>
                    <th className="py-1 pr-2">数量 / 单价</th>
                    <th className="py-1 pr-2">金额</th>
                    <th className="py-1 pr-2">口径</th>
                    <th className="py-1">复核</th>
                  </tr>
                </thead>
                <tbody>
                  {arr(d.lineItems).map((l) => (
                    <tr key={s(l.id)} className="border-t border-border align-top">
                      <td className="py-1 pr-2 text-muted" title={s(l.rawSnippet)}>
                        {l.sourcePage ? `第 ${s(l.sourcePage)} 页` : ""}{l.sourceSheet ? `「${s(l.sourceSheet)}」` : ""}{l.sourceRow ? ` 行 ${s(l.sourceRow)}` : ""} · {s(l.extractionMethod)}
                      </td>
                      <td className="py-1 pr-2">{s(l.docRef) || "—"}<br /><span className="text-muted"><Unknown value={l.docDate as string | null} /></span></td>
                      <td className="py-1 pr-2">{s(l.productDescription) || "—"}</td>
                      <td className="py-1 pr-2"><Unknown value={l.quantity as string | null} /> {s(l.unit)} · <Unknown value={l.unitPrice as string | null} /></td>
                      <td className="py-1 pr-2"><Unknown value={l.amount as string | null} /> {l.currency ? s(l.currency) : <span className="text-muted">币种？</span>}{l.isCancellationOrCredit ? " · 贷项 / 取消" : ""}</td>
                      <td className="py-1 pr-2">
                        <select className={`${inputCls} w-36`} disabled={!canEdit} value={s(l.amountBasis)} onChange={(e) => void review(s(l.id), "EDIT_AND_CONFIRM", { amountBasis: e.target.value })}>
                          {AMOUNT_BASES.map((b) => <option key={b} value={b}>{AMOUNT_BASIS_LABELS[b as AmountBasis]}</option>)}
                        </select>
                      </td>
                      <td className="py-1">
                        <Chip tone={toneForStatus(s(l.reviewStatus))}>{l.reviewStatus === "CONFIRMED" ? "已确认" : l.reviewStatus === "REJECTED" ? "已否决" : "待复核"}</Chip>
                        {canEdit && l.reviewStatus !== "CONFIRMED" ? <Btn variant="link" onClick={() => void review(s(l.id), "CONFIRM")}>确认</Btn> : null}
                        {canEdit && l.reviewStatus !== "REJECTED" ? <Btn variant="link" onClick={() => void review(s(l.id), "REJECT")}>否决</Btn> : null}
                        {canEdit && !l.currency ? <Btn variant="link" onClick={() => { const c = window.prompt("币种（如 CAD）"); if (c) void review(s(l.id), "EDIT_AND_CONFIRM", { currency: c }); }}>补币种</Btn> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {arr(d.lineItems).length === 0 ? <p className="text-xs text-muted">暂无明细。</p> : null}
            {canEdit ? (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted">人工录入（扫描件 / 无 OCR 时）</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <select className={inputCls} value={s(manual.attachmentId)} onChange={(e) => setManual({ ...manual, attachmentId: e.target.value })}>
                    <option value="">选择附件</option>
                    {attachments.filter((a) => a.kind === "DISCLOSURE_FILE").map((a) => <option key={s(a.id)} value={s(a.id)}>{s(a.originalFilename)}</option>)}
                  </select>
                  <input className={inputCls} placeholder="页码" value={s(manual.sourcePage)} onChange={(e) => setManual({ ...manual, sourcePage: e.target.value })} />
                  <select className={inputCls} value={s(manual.amountBasis)} onChange={(e) => setManual({ ...manual, amountBasis: e.target.value })}>
                    {AMOUNT_BASES.map((b) => <option key={b} value={b}>{AMOUNT_BASIS_LABELS[b as AmountBasis]}</option>)}
                  </select>
                  <input className={inputCls} placeholder="单号" value={s(manual.docRef)} onChange={(e) => setManual({ ...manual, docRef: e.target.value })} />
                  <input className={inputCls} placeholder="日期 YYYY-MM-DD" value={s(manual.docDate)} onChange={(e) => setManual({ ...manual, docDate: e.target.value })} />
                  <input className={inputCls} placeholder="品名" value={s(manual.productDescription)} onChange={(e) => setManual({ ...manual, productDescription: e.target.value })} />
                  <input className={inputCls} placeholder="数量" value={s(manual.quantity)} onChange={(e) => setManual({ ...manual, quantity: e.target.value })} />
                  <input className={inputCls} placeholder="单位" value={s(manual.unit)} onChange={(e) => setManual({ ...manual, unit: e.target.value })} />
                  <input className={inputCls} placeholder="单价" value={s(manual.unitPrice)} onChange={(e) => setManual({ ...manual, unitPrice: e.target.value })} />
                  <input className={inputCls} placeholder="金额" value={s(manual.amount)} onChange={(e) => setManual({ ...manual, amount: e.target.value })} />
                  <input className={inputCls} placeholder="币种" value={s(manual.currency)} onChange={(e) => setManual({ ...manual, currency: e.target.value })} />
                  <input className={inputCls} placeholder="原文片段（必填，用于追溯）" value={s(manual.rawSnippet)} onChange={(e) => setManual({ ...manual, rawSnippet: e.target.value })} />
                </div>
                <Btn onClick={() => void addManual()} busy={api.busy === "manual"} disabled={!manual.attachmentId || !s(manual.rawSnippet)}>录入</Btn>
              </details>
            ) : null}
          </Section>
        </>
      ) : null}

      {activeTab === "details" ? (
        <>
          <Section title="就绪与重复检查" hint="READY 由确定性规则判断；台账未确认时显示 UNVERIFIED，不视为没有重复。" testId="ready-check">
            {d.readyApplicable ? (
              <p className="text-xs">
                {ready.ready ? <Chip tone="good">满足 READY 条件</Chip> : <Chip tone="warn">未满足 READY（{ready.blockers.length} 项）</Chip>}{" "}
                <Chip tone={toneForStatus(dup.result)}>重复检查：{dup.result}</Chip> {dup.ledgerVerified ? null : <Chip tone="warn">台账未核实</Chip>}
              </p>
            ) : (
              <p className="text-xs text-muted">已进入交接 / 提交流程（或已归档）：就绪检查不再适用。下列重叠仅供参考——其他申请若与本案重叠，会在它们自己的检查里被拦截。</p>
            )}
            {d.readyApplicable && ready.blockers.length ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
                {ready.blockers.map((b) => (
                  <li key={b.code}>
                    {b.messageZh} <span className="text-muted">［{b.code}］</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {dup.overlaps?.length ? (
              <div className="mt-2 space-y-1 text-xs">
                <p className="font-medium">已有覆盖</p>
                {dup.overlaps.map((o) => (
                  <p key={s(o.requestId)}>
                    <Link className="text-accent underline" href={`/projects/intelligence/records/${s(o.requestId)}`}>{s(o.title)}</Link>（{REQUEST_STATUS_LABELS[o.status as RequestStatus] ?? s(o.status)} · {s(o.channel)}）重叠 {s((o.overlap as Json | null)?.start)} 至 {s((o.overlap as Json | null)?.end)}（{s((o.overlap as Json | null)?.days)} 天）
                    {o.institutionUncertain ? " · 机关别名未确定（人工复核）" : ""}
                    {o.applicantUncertain ? " · 申请主体未确定" : ""}
                  </p>
                ))}
                {d.readyApplicable && dup.coveredSegments?.length && dup.newSegments?.length ? (
                  <p className="text-foreground">
                    新增部分：{dup.newSegments.map((x) => `${s(x.start)} 至 ${s(x.end)}（${s(x.days)} 天）`).join("、")} —— 请把范围缩到新增部分，不要整段重复申请。
                  </p>
                ) : null}
              </div>
            ) : null}
          </Section>
          <Section title="机关规则与证据" testId="rule-info">
            <div className="space-y-2 text-xs">
                  <KV k="法律 / 渠道" v={`${s(rule?.lawLabel ?? d.lawLabel) || "未核实"} · ${s(rule?.channel ?? d.channel)}`} />
                  <KV k="官方入口" v={rule?.officialPortalUrl ? s(rule.officialPortalUrl) : <span className="text-muted">未核实（在「设置 → 机关申请规则」核实）</span>} />
                  <KV k="费用" v={`${cents(rule?.applicationFeeCents as number | null | undefined, rule?.currency as string | null)}${rule?.otherFeesRule ? `；${s(rule.otherFeesRule)}` : ""}`} />
                  <KV k="规则核实" v={rule ? (rule.verificationStatus === "VERIFIED" ? `已核实（${when(s(rule.verifiedAt))}；${s(rule.verificationMethod)}）` : "未核实") : "缺失"} />
                  <KV k="期限" v={<>官方：<Unknown value={dl.officialDueAt as string | null} /> · 估算：<Unknown value={dl.estimatedDueAt as string | null} />{dl.estimateBasis ? `（${s(dl.estimateBasis)}）` : ""} · 内部提醒：{when(dl.internalFollowUpAt as string | null)}</>} />
              <KV k="提交证据等级" v={subm.evidenceLevel ? (EVIDENCE_LEVEL_LABELS[s(subm.evidenceLevel)] ?? s(subm.evidenceLevel)) : "—"} />
              <KV k="分析状态" v={ANALYSIS_STATUS_LABELS[s(d.analysisStatus)] ?? s(d.analysisStatus)} />
            </div>
          </Section>
          <Section title="站内待办" testId="tasks">
            <ul className="space-y-1 text-xs">
              {arr(d.tasks).map((t) => (
                <li key={s(t.id)}>
                  <Chip tone={t.status === "done" ? "good" : "warn"}>{s(t.status)}</Chip> {s(t.title)}{t.dueDate ? ` · 截止 ${when(s(t.dueDate))}` : ""}
                </li>
              ))}
              {arr(d.tasks).length === 0 ? <li className="text-muted">暂无待办。</li> : null}
            </ul>
          </Section>
        </>
      ) : null}
    </div>
  );
}
