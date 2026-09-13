"use client";

/**
 * S3-B Slice 2：证据工作台的三个可写区块——可供产品 / 认证与资质 / 能力证据。
 *
 * 信任边界（全部由服务端强制，这里只是不给用户错误的暗示）：
 *   - 资质登记**永远**得到「厂家声称 / 待核验」；没有任何按钮能一键变成「已核验」。
 *   - 核验必须提交独立依据（项目档案，或官方登记库链接）；没有依据就是 422。
 *   - 能力声明必须选一条已关联的线索作出处；evidenceStatus 里没有「已核验」可选。
 *   - 产品来源固定「人工登记」，不给来源下拉让用户自称「系统发现」。
 *   - 编辑产品带版本号；被同事改过就 409，提示刷新，绝不静默覆盖。
 *   - 厂家文本一律纯文本渲染；外链 rel="noopener noreferrer nofollow"。
 */

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import {
  CAPABILITY_TYPES,
  CERTIFICATION_SCOPES,
  CERTIFICATION_SOURCE_KINDS,
  CERTIFICATION_TRANSITIONS,
  CERTIFICATION_TYPES,
  OFFERING_PRICE_STATUSES,
  SOCIAL_WRITE_EVIDENCE_STATUSES,
  type CertificationStatus,
} from "@/lib/supplier-intel/constants";
import {
  capabilityTypeLabel,
  certificationScopeLabel,
  certificationSourceKindLabel,
  certificationStatusDisplay,
  certificationTypeLabel,
  evidenceStatusDisplay,
  extractedByLabel,
  offeringSourceKindLabel,
  priceDisplay,
  priceStatusLabel,
} from "@/lib/supplier-intel/evidence-display";
import { platformDisplay } from "@/lib/supplier-intel/workspace-labels";
import {
  WorkspaceApiError,
  workspaceFetch,
  type ArchiveEvidenceOption,
  type CertificationView,
  type OfferingView,
  type SupplierCapabilityPayload,
} from "./types";

export const TONE_CLASS: Record<string, string> = {
  neutral: "bg-[var(--background)] text-[var(--muted)] border-[var(--border)]",
  info: "bg-[var(--info-bg)] text-[var(--info)] border-transparent",
  success: "bg-[var(--success-bg)] text-[var(--success)] border-transparent",
  warning: "bg-[var(--warning-bg)] text-[var(--warning)] border-transparent",
  danger: "bg-[var(--danger-bg)] text-[var(--danger)] border-transparent",
};

const INPUT = "w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm";
const BTN_PRIMARY =
  "inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1 text-xs text-[color:var(--on-accent)] disabled:opacity-50";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--background)] disabled:opacity-50";

type Msg = { tone: "ok" | "err"; text: string; stale?: boolean } | null;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="mb-0.5 block text-[var(--muted)]">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-[10px] text-[var(--muted)]">{hint}</span> : null}
    </label>
  );
}

function Badge({ tone, children, testId }: { tone: string; children: React.ReactNode; testId?: string }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[11px] ${TONE_CLASS[tone] ?? TONE_CLASS.neutral}`} data-testid={testId}>
      {children}
    </span>
  );
}

function MsgLine({ msg, onRefresh, testId }: { msg: Msg; onRefresh?: () => void; testId: string }) {
  if (!msg) return null;
  return (
    <p
      data-testid={testId}
      role="status"
      className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
        msg.tone === "ok" ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"
      }`}
    >
      <span>{msg.text}</span>
      {msg.stale && onRefresh ? (
        <button type="button" onClick={onRefresh} className="underline" data-testid={`${testId}-refresh`}>
          刷新
        </button>
      ) : null}
    </p>
  );
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : "请求失败";
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-0.5 text-[var(--accent)] underline"
    >
      {children}
      <ExternalLink size={10} />
    </a>
  );
}

/* ═══════════════════════ 可供产品 ═══════════════════════ */

interface OfferingFormValues {
  name: string;
  sku: string;
  category: string;
  description: string;
  attributesText: string;
  moq: string;
  leadTimeDays: string;
  unitPrice: string;
  currency: string;
  priceStatus: string;
  incoterm: string;
  sourceUrl: string;
  sourceSignalId: string;
}

function attributesToText(a: Record<string, string>): string {
  return Object.entries(a)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function textToAttributes(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of t.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.search(/[:：]/);
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function toIntOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function emptyOffering(): OfferingFormValues {
  return {
    name: "", sku: "", category: "", description: "", attributesText: "", moq: "", leadTimeDays: "",
    unitPrice: "", currency: "", priceStatus: "UNKNOWN", incoterm: "", sourceUrl: "", sourceSignalId: "",
  };
}

function fromOffering(o: OfferingView): OfferingFormValues {
  return {
    name: o.name, sku: o.sku ?? "", category: o.category ?? "", description: o.description ?? "",
    attributesText: attributesToText(o.attributes), moq: o.moq === null ? "" : String(o.moq),
    leadTimeDays: o.leadTimeDays === null ? "" : String(o.leadTimeDays),
    unitPrice: o.unitPrice ?? "", currency: o.currency ?? "", priceStatus: o.priceStatus,
    incoterm: o.incoterm ?? "", sourceUrl: o.sourceUrl ?? "", sourceSignalId: o.sourceSignal?.id ?? "",
  };
}

function OfferingForm({
  initial,
  mode,
  busy,
  linkedSignals,
  onSubmit,
  onCancel,
}: {
  initial: OfferingFormValues;
  mode: "create" | "edit";
  busy: boolean;
  linkedSignals: SupplierCapabilityPayload["linkedSignals"];
  onSubmit: (v: OfferingFormValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<OfferingFormValues>(initial);
  const set = (k: keyof OfferingFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const nameOk = v.name.trim().length > 0;
  return (
    <form
      className="space-y-2 rounded-xl border border-[var(--border)] p-3"
      data-testid={`offering-form-${mode}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (nameOk) onSubmit(v);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="产品名称 *">
          <input className={INPUT} value={v.name} onChange={set("name")} data-testid="offering-name" required />
        </Field>
        <Field label="型号 / SKU">
          <input className={INPUT} value={v.sku} onChange={set("sku")} data-testid="offering-sku" />
        </Field>
        <Field label="类别">
          <input className={INPUT} value={v.category} onChange={set("category")} />
        </Field>
        <Field label="最小起订量（MOQ）">
          <input className={INPUT} inputMode="numeric" value={v.moq} onChange={set("moq")} data-testid="offering-moq" />
        </Field>
        <Field label="交期（天）">
          <input className={INPUT} inputMode="numeric" value={v.leadTimeDays} onChange={set("leadTimeDays")} />
        </Field>
        <Field label="价格状态" hint="没有报价是正常的：选「待确认」即可保存，之后再询价。">
          <select className={INPUT} value={v.priceStatus} onChange={set("priceStatus")} data-testid="offering-price-status">
            {OFFERING_PRICE_STATUSES.map((s) => (
              <option key={s} value={s}>{priceStatusLabel(s)}</option>
            ))}
          </select>
        </Field>
        <Field label="单价">
          <input className={INPUT} inputMode="decimal" value={v.unitPrice} onChange={set("unitPrice")} data-testid="offering-unit-price" placeholder="可留空" />
        </Field>
        <Field label="币种">
          <input className={INPUT} value={v.currency} onChange={set("currency")} placeholder="CNY / USD" />
        </Field>
        <Field label="贸易术语（Incoterm）">
          <input className={INPUT} value={v.incoterm} onChange={set("incoterm")} placeholder="FOB / EXW" />
        </Field>
        <Field label="资料链接">
          <input className={INPUT} value={v.sourceUrl} onChange={set("sourceUrl")} placeholder="https://" />
        </Field>
      </div>
      <Field label="说明">
        <textarea className={INPUT} rows={2} value={v.description} onChange={set("description")} data-testid="offering-description" />
      </Field>
      <Field label="规格 / 属性" hint="每行一项，格式「键: 值」，例如「材质: 钢」">
        <textarea className={INPUT} rows={3} value={v.attributesText} onChange={set("attributesText")} data-testid="offering-attributes" />
      </Field>
      {mode === "create" ? (
        <Field label="从哪条线索登记（可选）" hint="登记来源固定为「人工登记」；这里只记录你是看哪条线索填的。">
          <select className={INPUT} value={v.sourceSignalId} onChange={set("sourceSignalId")} data-testid="offering-source-signal">
            <option value="">不指定</option>
            {linkedSignals.map((s) => (
              <option key={s.id} value={s.id}>{s.title ?? s.id}</option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" disabled={busy || !nameOk} className={BTN_PRIMARY} data-testid="offering-submit">
          {busy ? <Loader2 size={12} className="animate-spin" /> : null}
          {mode === "create" ? "保存产品" : "保存修改"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>取消</button>
      </div>
    </form>
  );
}

function offeringPayload(v: OfferingFormValues): Record<string, unknown> {
  return {
    name: v.name.trim(),
    sku: v.sku.trim(),
    category: v.category.trim(),
    description: v.description.trim(),
    attributes: textToAttributes(v.attributesText),
    moq: toIntOrNull(v.moq),
    leadTimeDays: toIntOrNull(v.leadTimeDays),
    // 价格以字符串提交：不经过 JS number，避免小数精度被悄悄改掉
    unitPrice: v.unitPrice.trim() ? v.unitPrice.trim() : null,
    currency: v.currency.trim(),
    priceStatus: v.priceStatus,
    incoterm: v.incoterm.trim(),
    sourceUrl: v.sourceUrl.trim(),
  };
}

export function OfferingsSection({
  orgId,
  supplierId,
  view,
  onChanged,
}: {
  orgId: string;
  supplierId: string;
  view: SupplierCapabilityPayload;
  onChanged: () => Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const q = `?orgId=${encodeURIComponent(orgId)}`;

  const create = useCallback(
    async (v: OfferingFormValues) => {
      setBusy(true);
      setMsg(null);
      try {
        await workspaceFetch(`/api/supplier-intel/suppliers/${supplierId}/offerings${q}`, {
          method: "POST",
          body: JSON.stringify({
            ...offeringPayload(v),
            ...(v.sourceSignalId ? { sourceSignalId: v.sourceSignalId } : {}),
          }),
        });
        setShowCreate(false);
        setMsg({ tone: "ok", text: "已保存。价格未知时会显示「价格待确认」，这不影响保存。" });
        await onChanged();
      } catch (e) {
        setMsg({ tone: "err", text: errText(e) });
      } finally {
        setBusy(false);
      }
    },
    [onChanged, q, supplierId],
  );

  const update = useCallback(
    async (o: OfferingView, v: OfferingFormValues) => {
      setBusy(true);
      setMsg(null);
      try {
        await workspaceFetch(`/api/supplier-intel/suppliers/${supplierId}/offerings/${o.id}${q}`, {
          method: "PATCH",
          // 带上我读到的版本号：服务端据此拒绝覆盖同事在此期间的修改
          body: JSON.stringify({ ...offeringPayload(v), expectedUpdatedAt: o.updatedAt }),
        });
        setEditingId(null);
        setMsg({ tone: "ok", text: "已保存修改。" });
        await onChanged();
      } catch (e) {
        if (e instanceof WorkspaceApiError && e.code === "STALE_WRITE") {
          setMsg({ tone: "err", stale: true, text: "这条产品已被其他同事更新，本次未覆盖对方的改动。请刷新后基于最新内容再改。" });
        } else {
          setMsg({ tone: "err", text: errText(e) });
        }
      } finally {
        setBusy(false);
      }
    },
    [onChanged, q, supplierId],
  );

  return (
    <div className="space-y-3" data-testid="offerings-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          供应商 ≠ 产品。这里记录这家具体能供哪些产品/型号；同一家可以有多个。
        </p>
        {view.canWrite && !showCreate ? (
          <button type="button" onClick={() => { setShowCreate(true); setEditingId(null); setMsg(null); }} className={BTN_PRIMARY} data-testid="offering-add">
            <Plus size={12} /> 新增产品
          </button>
        ) : null}
      </div>
      <MsgLine msg={msg} testId="offering-message" onRefresh={() => { setEditingId(null); setMsg(null); void onChanged(); }} />
      {showCreate ? (
        <OfferingForm initial={emptyOffering()} mode="create" busy={busy} linkedSignals={view.linkedSignals} onSubmit={create} onCancel={() => setShowCreate(false)} />
      ) : null}
      {view.offerings.length === 0 && !showCreate ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]" data-testid="offerings-empty">
          还没有登记任何产品。
        </p>
      ) : null}
      <ul className="space-y-2">
        {view.offerings.map((o) => {
          const price = priceDisplay(o);
          const editing = editingId === o.id;
          return (
            <li key={o.id} className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3 text-sm" data-testid="offering-card" data-offering-id={o.id}>
              {editing ? (
                <OfferingForm initial={fromOffering(o)} mode="edit" busy={busy} linkedSignals={view.linkedSignals} onSubmit={(v) => void update(o, v)} onCancel={() => setEditingId(null)} />
              ) : (
                <>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium" data-testid="offering-card-name">{o.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {o.sku ? `型号 ${o.sku}` : "型号未记录"}
                        {o.category ? ` · ${o.category}` : ""}
                      </p>
                    </div>
                    <Badge tone={price.pending ? "warning" : "neutral"} testId="offering-price">{price.text}</Badge>
                    {view.canWrite ? (
                      <button type="button" onClick={() => { setEditingId(o.id); setShowCreate(false); setMsg(null); }} className={BTN_GHOST} data-testid="offering-edit">编辑</button>
                    ) : null}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                    <div><dt className="text-[var(--muted)]">MOQ</dt><dd>{o.moq === null ? "待确认" : o.moq}</dd></div>
                    <div><dt className="text-[var(--muted)]">交期</dt><dd>{o.leadTimeDays === null ? "待确认" : `${o.leadTimeDays} 天`}</dd></div>
                    <div><dt className="text-[var(--muted)]">贸易术语</dt><dd>{o.incoterm ?? "—"}</dd></div>
                    <div><dt className="text-[var(--muted)]">来源</dt><dd data-testid="offering-source">{offeringSourceKindLabel(o.sourceKind)}</dd></div>
                  </dl>
                  {o.description ? <p className="mt-2 whitespace-pre-wrap text-xs">{o.description}</p> : null}
                  {Object.keys(o.attributes).length ? (
                    <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs" data-testid="offering-attributes-view">
                      {Object.entries(o.attributes).map(([k, val]) => (
                        <div key={k}><dt className="inline text-[var(--muted)]">{k}：</dt><dd className="inline">{val}</dd></div>
                      ))}
                    </dl>
                  ) : null}
                  <p className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
                    {o.sourceSignal ? <span>登记依据线索：{o.sourceSignal.title ?? o.sourceSignal.id}</span> : null}
                    {o.sourceUrl ? <ExtLink href={o.sourceUrl}>资料链接</ExtLink> : null}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ═══════════════════════ 认证与资质 ═══════════════════════ */

function allowedCertActions(status: string): readonly CertificationStatus[] {
  return CERTIFICATION_TRANSITIONS[status as CertificationStatus] ?? [];
}

function VerifyPanel({
  orgId,
  cert,
  projectId,
  busy,
  onSubmit,
  onCancel,
}: {
  orgId: string;
  cert: CertificationView;
  projectId: string | null;
  busy: boolean;
  onSubmit: (input: { archiveItemId?: string; sourceUrl?: string; note?: string }) => void;
  onCancel: () => void;
}) {
  const registryAllowed = cert.sourceKind === "REGISTRY";
  const [mode, setMode] = useState<"archive" | "registry">(registryAllowed ? "registry" : "archive");
  const [archiveId, setArchiveId] = useState("");
  const [registryUrl, setRegistryUrl] = useState(cert.sourceUrl ?? "");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<ArchiveEvidenceOption[] | null>(null);
  const [itemsErr, setItemsErr] = useState<string | null>(null);

  // 不用「已加载」ref 去挡重复请求：StrictMode 会把 effect 跑两遍，第一遍刚发出请求就被清理，
  // 第二遍若被 ref 挡住，回来的响应没人接——列表永远转圈（浏览器验收 F3l 抓到的正是这个）。
  // 正确做法只靠 alive 标志：被清理的那一轮丢弃结果，最后一轮自然接住。
  useEffect(() => {
    if (mode !== "archive" || !projectId) return;
    let alive = true;
    setItems(null);
    setItemsErr(null);
    workspaceFetch<{ items: ArchiveEvidenceOption[] }>(
      `/api/supplier-intel/projects/${projectId}/archive-evidence?orgId=${encodeURIComponent(orgId)}`,
    )
      .then((r) => { if (alive) setItems(r.items); })
      .catch((e) => { if (alive) setItemsErr(errText(e)); });
    return () => { alive = false; };
  }, [mode, orgId, projectId]);

  const canSubmit = mode === "archive" ? Boolean(archiveId) : Boolean(registryUrl.trim());

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2" data-testid="verify-panel">
      <p className="text-xs font-medium">标记为「已独立核验」需要独立依据</p>
      <p className="text-[11px] text-[var(--muted)]">
        厂家自述、社媒、官网、画册都不算依据。只接受：本项目档案里的证书扫描件，或受支持的官方登记库链接。
      </p>
      <div className="flex flex-wrap gap-3 text-xs">
        <label className="inline-flex items-center gap-1">
          <input type="radio" checked={mode === "archive"} onChange={() => setMode("archive")} data-testid="verify-mode-archive" /> 项目档案
        </label>
        <label className={`inline-flex items-center gap-1 ${registryAllowed ? "" : "opacity-50"}`} title={registryAllowed ? undefined : "只有来源为「官方登记库」的资质才能凭链接核验"}>
          <input type="radio" checked={mode === "registry"} disabled={!registryAllowed} onChange={() => setMode("registry")} data-testid="verify-mode-registry" /> 官方登记库链接
        </label>
      </div>
      {mode === "archive" ? (
        !projectId ? (
          <p className="text-[11px] text-[var(--warning)]" data-testid="verify-no-project">
            需要从具体项目进入本页，才能从该项目的档案里选择证书扫描件。
          </p>
        ) : itemsErr ? (
          <p className="text-[11px] text-[var(--danger)]">{itemsErr}</p>
        ) : items === null ? (
          <p className="flex items-center gap-1 text-[11px] text-[var(--muted)]"><Loader2 size={10} className="animate-spin" /> 读取项目档案…</p>
        ) : items.length === 0 ? (
          <p className="text-[11px] text-[var(--muted)]" data-testid="verify-archive-empty">该项目档案里还没有可用条目。请先把证书扫描件归档到项目，再来核验。</p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-auto text-xs" data-testid="verify-archive-list">
            {items.map((it) => (
              <li key={it.id}>
                <label className="inline-flex items-start gap-1">
                  <input type="radio" name={`archive-${cert.id}`} checked={archiveId === it.id} onChange={() => setArchiveId(it.id)} data-testid="verify-archive-option" data-archive-id={it.id} />
                  <span>
                    {it.title ?? `${it.kind}`}
                    <span className="text-[var(--muted)]"> · {it.mimeType} · {new Date(it.capturedAt).toLocaleDateString("zh-CN")}{it.sourceHost ? ` · ${it.sourceHost}` : ""}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )
      ) : (
        <Field label="官方登记库链接（https）" hint="只认受支持的登记库（如国家企业信用信息公示系统、UL Product iQ、IAF CertSearch）；一般网站不算。">
          <input className={INPUT} value={registryUrl} onChange={(e) => setRegistryUrl(e.target.value)} data-testid="verify-registry-url" />
        </Field>
      )}
      <Field label="核验备注（可选）">
        <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} data-testid="verify-note" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canSubmit}
          className={BTN_PRIMARY}
          data-testid="verify-submit"
          onClick={() =>
            onSubmit(
              mode === "archive"
                ? { archiveItemId: archiveId, note: note.trim() || undefined }
                : { sourceUrl: registryUrl.trim(), note: note.trim() || undefined },
            )
          }
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null} 提交核验依据
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>取消</button>
      </div>
    </div>
  );
}

interface CertFormValues {
  scope: string;
  certificationType: string;
  certificateNumber: string;
  issuer: string;
  validFrom: string;
  expiresAt: string;
  sourceKind: string;
  sourceUrl: string;
  offeringId: string;
}

export function CertificationsSection({
  orgId,
  supplierId,
  projectId,
  view,
  onChanged,
}: {
  orgId: string;
  supplierId: string;
  projectId: string | null;
  view: SupplierCapabilityPayload;
  onChanged: () => Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [form, setForm] = useState<CertFormValues>({
    scope: "SUPPLIER", certificationType: "ISO_9001", certificateNumber: "", issuer: "",
    validFrom: "", expiresAt: "", sourceKind: "USER_ENTRY", sourceUrl: "", offeringId: "",
  });
  const q = `?orgId=${encodeURIComponent(orgId)}`;
  const setF = (k: keyof CertFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const create = useCallback(async () => {
    setBusy("create");
    setMsg(null);
    try {
      await workspaceFetch(`/api/supplier-intel/suppliers/${supplierId}/certifications${q}`, {
        method: "POST",
        body: JSON.stringify({
          scope: form.scope,
          certificationType: form.certificationType,
          certificateNumber: form.certificateNumber.trim() || null,
          issuer: form.issuer.trim() || null,
          validFrom: form.validFrom || null,
          expiresAt: form.expiresAt || null,
          sourceKind: form.sourceKind,
          sourceUrl: form.sourceUrl.trim() || null,
          offeringId: form.offeringId || null,
        }),
      });
      setShowCreate(false);
      setMsg({ tone: "ok", text: "已登记，状态为「厂家声称 / 待核验」。要标记为已核验，请在该条上提交独立依据。" });
      await onChanged();
    } catch (e) {
      setMsg({ tone: "err", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }, [form, onChanged, q, supplierId]);

  const act = useCallback(
    async (cert: CertificationView, action: "verify" | "reject" | "expire", extra?: Record<string, unknown>) => {
      setBusy(`${action}:${cert.id}`);
      setMsg(null);
      try {
        await workspaceFetch(`/api/supplier-intel/suppliers/${supplierId}/certifications/${cert.id}${q}`, {
          method: "PATCH",
          body: JSON.stringify({ action, ...(extra ?? {}) }),
        });
        setVerifyingId(null);
        setMsg({
          tone: "ok",
          text: action === "verify" ? "已标记为「已独立核验」，核验依据已记录。" : action === "reject" ? "已记为「核验未通过」。" : "已记为「已过期 / 不再有效」。",
        });
        await onChanged();
      } catch (e) {
        if (action === "verify") {
          const detail = e instanceof WorkspaceApiError && e.status === 422 ? `（${e.message}）` : e instanceof Error ? `（${e.message}）` : "";
          setMsg({ tone: "err", text: `无法标记为已核验：缺少独立核验依据${detail}` });
        } else {
          setMsg({ tone: "err", text: errText(e) });
        }
      } finally {
        setBusy(null);
      }
    },
    [onChanged, q, supplierId],
  );

  return (
    <div className="space-y-3" data-testid="certifications-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          三件事分开看：厂家声称有证书 ≠ 证书资料已归档 ≠ 证书已独立核验。
        </p>
        {view.canWrite && !showCreate ? (
          <button type="button" onClick={() => { setShowCreate(true); setMsg(null); }} className={BTN_PRIMARY} data-testid="cert-add">
            <Plus size={12} /> 登记资质
          </button>
        ) : null}
      </div>
      <MsgLine msg={msg} testId="cert-message" />
      {showCreate ? (
        <form
          className="space-y-2 rounded-xl border border-[var(--border)] p-3"
          data-testid="cert-form"
          onSubmit={(e) => { e.preventDefault(); void create(); }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="认证类型 *">
              <select className={INPUT} value={form.certificationType} onChange={setF("certificationType")} data-testid="cert-type">
                {CERTIFICATION_TYPES.map((t) => <option key={t} value={t}>{certificationTypeLabel(t)}</option>)}
              </select>
            </Field>
            <Field label="覆盖范围 *">
              <select className={INPUT} value={form.scope} onChange={setF("scope")} data-testid="cert-scope">
                {CERTIFICATION_SCOPES.map((s) => <option key={s} value={s}>{certificationScopeLabel(s)}</option>)}
              </select>
            </Field>
            <Field label="证书编号"><input className={INPUT} value={form.certificateNumber} onChange={setF("certificateNumber")} data-testid="cert-number" /></Field>
            <Field label="发证机构"><input className={INPUT} value={form.issuer} onChange={setF("issuer")} /></Field>
            <Field label="生效日期"><input className={INPUT} type="date" value={form.validFrom} onChange={setF("validFrom")} /></Field>
            <Field label="到期日期"><input className={INPUT} type="date" value={form.expiresAt} onChange={setF("expiresAt")} data-testid="cert-expires" /></Field>
            <Field label="厂家声称的来源" hint="这是「谁说的」，不是核验依据。">
              <select className={INPUT} value={form.sourceKind} onChange={setF("sourceKind")} data-testid="cert-source-kind">
                {CERTIFICATION_SOURCE_KINDS.map((k) => <option key={k} value={k}>{certificationSourceKindLabel(k)}</option>)}
              </select>
            </Field>
            <Field label="来源链接"><input className={INPUT} value={form.sourceUrl} onChange={setF("sourceUrl")} placeholder="https://" /></Field>
            {view.offerings.length ? (
              <Field label="对应产品（可选）">
                <select className={INPUT} value={form.offeringId} onChange={setF("offeringId")}>
                  <option value="">整个供应商</option>
                  {view.offerings.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
            ) : null}
          </div>
          <p className="text-[11px] text-[var(--muted)]">登记后状态为「厂家声称 / 待核验」。没有任何登记选项能直接得到「已核验」。</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy !== null} className={BTN_PRIMARY} data-testid="cert-submit">
              {busy === "create" ? <Loader2 size={12} className="animate-spin" /> : null} 登记（待核验）
            </button>
            <button type="button" onClick={() => setShowCreate(false)} disabled={busy !== null} className={BTN_GHOST}>取消</button>
          </div>
        </form>
      ) : null}
      {view.certifications.length === 0 && !showCreate ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]" data-testid="certs-empty">还没有登记任何认证。</p>
      ) : null}
      <ul className="space-y-2">
        {view.certifications.map((c) => {
          const st = certificationStatusDisplay(c.status, c.expiredByDate);
          const actions = allowedCertActions(c.status);
          const verifying = verifyingId === c.id;
          const offering = c.offeringId ? view.offerings.find((o) => o.id === c.offeringId) : null;
          return (
            <li key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3 text-sm" data-testid="cert-card" data-cert-id={c.id} data-cert-status={c.status} data-expired-by-date={c.expiredByDate ? "true" : "false"}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {certificationTypeLabel(c.certificationType)}
                    <span className="ml-1 text-xs font-normal text-[var(--muted)]">· {certificationScopeLabel(c.scope)}{offering ? `（${offering.name}）` : ""}</span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {c.certificateNumber ? `编号 ${c.certificateNumber}` : "编号未记录"}
                    {c.issuer ? ` · ${c.issuer}` : ""}
                    {c.expiresAt ? ` · 有效至 ${new Date(c.expiresAt).toLocaleDateString("zh-CN")}` : " · 有效期未记录"}
                  </p>
                </div>
                <Badge tone={st.tone} testId="cert-status">{st.label}</Badge>
                {c.expiredByDate && c.status !== "EXPIRED" ? <Badge tone="danger" testId="cert-expired-by-date">按日期已过期</Badge> : null}
              </div>
              {st.hint ? <p className="mt-1 text-[11px] text-[var(--muted)]">{st.hint}</p> : null}
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                声称来源：{certificationSourceKindLabel(c.sourceKind)}
                {c.sourceUrl && c.status !== "VERIFIED" ? <> · <ExtLink href={c.sourceUrl}>链接</ExtLink></> : null}
              </p>
              {c.status === "VERIFIED" ? (
                <p className="mt-1 text-[11px]" data-testid="cert-evidence">
                  <span className="text-[var(--muted)]">核验依据：</span>
                  {c.evidence?.kind === "REGISTRY" && c.evidence.url ? (
                    <ExtLink href={c.evidence.url}>{c.evidence.providerLabel ?? "官方登记库"}</ExtLink>
                  ) : c.evidence?.kind === "ARCHIVE" ? (
                    c.evidence.viewable ? <span>项目档案 · {c.evidence.label}</span> : <span>项目档案（当前账号无权查看其所属项目）</span>
                  ) : (
                    <span>依据记录不完整</span>
                  )}
                  {c.verifiedAt ? <span className="text-[var(--muted)]"> · 核验于 {new Date(c.verifiedAt).toLocaleDateString("zh-CN")}</span> : null}
                  {c.verificationNote ? <span className="text-[var(--muted)]"> · {c.verificationNote}</span> : null}
                </p>
              ) : null}
              {view.canWrite && actions.length > 0 && !verifying ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {actions.includes("VERIFIED") ? (
                    <button type="button" disabled={busy !== null} onClick={() => { setVerifyingId(c.id); setMsg(null); }} className={BTN_PRIMARY} data-testid="cert-verify-open">提交核验依据…</button>
                  ) : null}
                  {actions.includes("EXPIRED") ? (
                    <button type="button" disabled={busy !== null} onClick={() => void act(c, "expire")} className={BTN_GHOST} data-testid="cert-expire">置为已过期</button>
                  ) : null}
                  {actions.includes("REJECTED") ? (
                    <button type="button" disabled={busy !== null} onClick={() => void act(c, "reject")} className={BTN_GHOST} data-testid="cert-reject">核验未通过</button>
                  ) : null}
                </div>
              ) : null}
              {verifying ? (
                <VerifyPanel orgId={orgId} cert={c} projectId={projectId} busy={busy === `verify:${c.id}`} onSubmit={(input) => void act(c, "verify", input)} onCancel={() => setVerifyingId(null)} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ═══════════════════════ 能力证据 ═══════════════════════ */

export function CapabilitiesSection({
  orgId,
  supplierId,
  view,
  onChanged,
}: {
  orgId: string;
  supplierId: string;
  view: SupplierCapabilityPayload;
  onChanged: () => Promise<void>;
}) {
  const attachable = view.linkedSignals.filter((s) => s.canAttachCapability);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [form, setForm] = useState({
    discoverySignalId: attachable[0]?.id ?? "",
    type: CAPABILITY_TYPES[0] as string,
    value: "",
    evidenceStatus: "CLAIMED",
    explanation: "",
  });
  const q = `?orgId=${encodeURIComponent(orgId)}`;
  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const create = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      await workspaceFetch(`/api/supplier-intel/suppliers/${supplierId}/capability-signals${q}`, {
        method: "POST",
        body: JSON.stringify({
          discoverySignalId: form.discoverySignalId,
          type: form.type,
          value: form.value.trim() || null,
          evidenceStatus: form.evidenceStatus,
          explanation: form.explanation.trim() || null,
        }),
      });
      setShowCreate(false);
      setForm((p) => ({ ...p, value: "", explanation: "" }));
      setMsg({ tone: "ok", text: "已记录，可回溯到所选线索。" });
      await onChanged();
    } catch (e) {
      if (e instanceof WorkspaceApiError && e.forbidden) {
        setMsg({ tone: "err", text: "你对该线索所属项目没有写权限，不能在这条线索上记录能力（供应商权限不替代项目权限）。" });
      } else {
        setMsg({ tone: "err", text: errText(e) });
      }
    } finally {
      setBusy(false);
    }
  }, [form, onChanged, q, supplierId]);

  return (
    <div className="space-y-3" data-testid="capabilities-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">能力必须有出处：每条都挂在一条已关联的线索上，能回到原文。</p>
        {view.canWrite && !showCreate ? (
          <button type="button" onClick={() => { setShowCreate(true); setMsg(null); }} className={BTN_PRIMARY} data-testid="capability-add" disabled={view.linkedSignals.length === 0}>
            <Plus size={12} /> 记录能力声明
          </button>
        ) : null}
      </div>
      <MsgLine msg={msg} testId="capability-message" />
      {view.linkedSignals.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted)]" data-testid="capability-no-source">
          这家供应商还没有你能看到的已关联线索。能力声明必须有出处——请先在采购工作台把线索关联到它。
        </p>
      ) : null}
      {showCreate ? (
        <form className="space-y-2 rounded-xl border border-[var(--border)] p-3" data-testid="capability-form" onSubmit={(e) => { e.preventDefault(); if (form.discoverySignalId) void create(); }}>
          <Field label="出处线索 *" hint="只能选已关联到这家供应商、且你对其所属项目有写权限的线索。">
            <select className={INPUT} value={form.discoverySignalId} onChange={setF("discoverySignalId")} data-testid="capability-source">
              {attachable.length === 0 ? <option value="">（没有可用的出处线索）</option> : null}
              {view.linkedSignals.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.canAttachCapability}>
                  {s.title ?? s.id}{s.canAttachCapability ? "" : "（无该项目写权限）"}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="能力类型 *">
              <select className={INPUT} value={form.type} onChange={setF("type")} data-testid="capability-type">
                {CAPABILITY_TYPES.map((t) => <option key={t} value={t}>{capabilityTypeLabel(t)}</option>)}
              </select>
            </Field>
            <Field label="证据程度" hint="「已独立核验」不能在这里选：能力的核验只能通过独立证据路径产生。">
              <select className={INPUT} value={form.evidenceStatus} onChange={setF("evidenceStatus")} data-testid="capability-evidence-status">
                {SOCIAL_WRITE_EVIDENCE_STATUSES.map((s) => <option key={s} value={s}>{evidenceStatusDisplay(s).label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="具体内容"><input className={INPUT} value={form.value} onChange={setF("value")} data-testid="capability-value" placeholder="例如：3 轴 CNC × 6 台" /></Field>
          <Field label="说明 / 原文位置"><textarea className={INPUT} rows={2} value={form.explanation} onChange={setF("explanation")} /></Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !form.discoverySignalId} className={BTN_PRIMARY} data-testid="capability-submit">
              {busy ? <Loader2 size={12} className="animate-spin" /> : null} 记录
            </button>
            <button type="button" onClick={() => setShowCreate(false)} disabled={busy} className={BTN_GHOST}>取消</button>
          </div>
        </form>
      ) : null}
      {view.capabilities.length === 0 && view.linkedSignals.length > 0 && !showCreate ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]" data-testid="capabilities-empty">还没有记录任何能力声明。</p>
      ) : null}
      <ul className="space-y-2">
        {view.capabilities.map((c) => {
          const ev = evidenceStatusDisplay(c.evidenceStatus);
          const pf = platformDisplay(c.source.platform);
          return (
            <li key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3 text-sm" data-testid="capability-card" data-capability-id={c.id} data-source-signal-id={c.source.signalId}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{capabilityTypeLabel(c.type)}{c.value ? <span className="ml-1 font-normal">· {c.value}</span> : null}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {extractedByLabel(c.extractedBy)}
                    {c.confidence !== null ? ` · 置信度 ${Math.round(c.confidence * 100)}%` : ""}
                  </p>
                </div>
                <Badge tone={ev.tone} testId="capability-evidence">{ev.label}</Badge>
              </div>
              {c.explanation ? <p className="mt-1 whitespace-pre-wrap text-xs">{c.explanation}</p> : null}
              <div className="mt-2 rounded-lg bg-[var(--background)] p-2 text-[11px]" data-testid="capability-source-box">
                <p>
                  <span className="text-[var(--muted)]">出处线索：</span>
                  {c.source.title ?? c.source.signalId}
                  <span className="text-[var(--muted)]"> · {pf.label}</span>
                  {c.source.contentUrl ? <> · <ExtLink href={c.source.contentUrl}>查看来源</ExtLink></> : null}
                </p>
                {c.source.rawTextExcerpt ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[var(--accent)]">原文摘录</summary>
                    <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">{c.source.rawTextExcerpt}</p>
                  </details>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
