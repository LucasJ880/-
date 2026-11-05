"use client";

/**
 * PROC-1 资料申请台账（/projects/intelligence/records）：按机构 / 项目 / 状态 / 待办筛选；
 * 申请人资料、机关规则核实、历史台账确认与历史导入。青砚数据库是唯一正式申请台账。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { ANALYSIS_STATUS_LABELS, EVIDENCE_LEVEL_LABELS, FILES_STATUS_LABELS, OUTCOME_LABELS, REQUEST_STATUSES, REQUEST_STATUS_LABELS, type GovernmentOutcome, type RequestStatus } from "@/lib/procurement-records/labels";
import { JURISDICTION_LABELS } from "@/lib/procurement-records/identity";
import { Btn, Chip, cents, Field, inputCls, Note, NotEnabled, Section, toneForStatus, useApiCall, when } from "./primitives";

type Json = Record<string, unknown>;

const APPLICANT_FIELDS: Array<[string, string]> = [
  ["label", "标签"],
  ["legalName", "申请人 / 公司法定名称 *"],
  ["representativeName", "代表人 *"],
  ["addressLine1", "地址 *"],
  ["addressLine2", "地址第二行"],
  ["city", "城市 *"],
  ["province", "省 / 州 *"],
  ["postalCode", "邮编 *"],
  ["country", "国家 *"],
  ["email", "邮箱 *"],
  ["phone", "电话"],
];

export function RecordsLedger() {
  const { orgId, ambiguous, loading } = useCurrentOrgId();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [items, setItems] = useState<Json[]>([]);
  const [status, setStatus] = useState("ALL");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [applicants, setApplicants] = useState<Json[]>([]);
  const [rules, setRules] = useState<Json[]>([]);
  const [attests, setAttests] = useState<Json[]>([]);
  const [editing, setEditing] = useState<Json | null>(null);
  const [verify, setVerify] = useState<Record<string, { portal: string; fee: string; method: string }>>({});
  const [att, setAtt] = useState({ jurisdiction: "CA-FED", institutionKey: "*", method: "USER_CONFIRMED_NONE", note: "" });
  const [historyJson, setHistoryJson] = useState("");
  const api = useApiCall();
  const q = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";

  const load = useCallback(async () => {
    if (!orgId) return;
    const r = await api.call("list", `/api/procurement/requests${q}${status !== "ALL" ? `&status=${status}` : ""}${pendingOnly ? "&pending=1" : ""}`);
    if (r.body.available === false) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    if (r.ok) setItems((r.body.items as Json[]) ?? []);
    const [a, ru, at] = await Promise.all([
      api.call("apps", `/api/procurement/applicants${q}`),
      api.call("rules", `/api/procurement/rules${q}`),
      api.call("att", `/api/procurement/ledger-attestations${q}`),
    ]);
    if (a.ok) setApplicants((a.body.items as Json[]) ?? []);
    if (ru.ok) setRules((ru.body.items as Json[]) ?? []);
    if (at.ok) setAttests((at.body.items as Json[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, q, status, pendingOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveApplicant = async () => {
    if (!editing) return;
    const id = editing.id as string | undefined;
    const body = Object.fromEntries(APPLICANT_FIELDS.map(([k]) => [k, (editing[k] as string) ?? null]));
    const r = await api.call("saveApp", id ? `/api/procurement/applicants/${id}${q}` : `/api/procurement/applicants${q}`, { method: id ? "PUT" : "POST", json: body });
    if (r.ok) {
      setEditing(null);
      api.setNote({ tone: "info", text: "已保存；修改后的资料回到「未确认」，请核对后点「确认」。" });
      await load();
    }
  };
  const confirmApplicant = async (a: Json) => {
    const r = await api.call(`conf-${String(a.id)}`, `/api/procurement/applicants/${String(a.id)}/confirm${q}`, { method: "POST", json: { expectedVersion: a.version } });
    if (r.ok) await load();
  };
  const verifyRule = async (rule: Json) => {
    const v = verify[String(rule.id)] ?? { portal: String(rule.officialPortalUrl ?? ""), fee: rule.applicationFeeCents === null ? "" : String(rule.applicationFeeCents), method: "" };
    const r = await api.call(`rule-${String(rule.id)}`, `/api/procurement/rules/${String(rule.id)}${q}`, {
      method: "PUT",
      json: { patch: { officialPortalUrl: v.portal.trim() || null, applicationFeeCents: v.fee.trim() === "" ? null : Number(v.fee) }, verify: { method: v.method } },
    });
    if (r.ok) {
      api.setNote({ tone: "good", text: "规则已标为已核实（记录了核实人、时间与方法）。" });
      await load();
    }
  };
  const attest = async () => {
    const r = await api.call("attest", `/api/procurement/ledger-attestations${q}`, { method: "POST", json: att });
    if (r.ok) {
      api.setNote({ tone: "good", text: "已记录台账确认（范围、时间、确认人）。" });
      await load();
    }
  };
  const importHistory = async () => {
    let items: unknown;
    try {
      items = JSON.parse(historyJson);
    } catch {
      api.setNote({ tone: "bad", text: "JSON 格式错误" });
      return;
    }
    const r = await api.call("hist", `/api/procurement/history-import${q}`, { method: "POST", json: { items: Array.isArray(items) ? items : [items] } });
    if (r.body.results) api.setNote({ tone: r.ok ? "good" : "warn", text: `导入结果：${JSON.stringify(r.body.results).slice(0, 400)}` });
    await load();
  };

  if (loading) return <p className="text-sm text-muted">加载中…</p>;
  if (ambiguous || !orgId) return <p className="text-sm text-muted">请先在顶部选择当前组织。</p>;
  if (available === false) return <NotEnabled />;

  return (
    <div className="space-y-5" data-testid="records-ledger">
      <Section
        title="资料申请台账"
        hint="「打开入口」「复制正文」都不等于已提交；提交状态只由用户回填与回执核对改变。"
        actions={
          <>
            <select className={`${inputCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">全部状态</option>
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>{REQUEST_STATUS_LABELS[s]}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} /> 只看有待办
            </label>
          </>
        }
      >
        {items.length === 0 ? <p className="text-xs text-muted">暂无申请。从「采购监控」的候选点「准备申请」，或等待扫描自动草拟。</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-2">申请</th>
                <th className="py-1 pr-2">接收机关</th>
                <th className="py-1 pr-2">申请状态</th>
                <th className="py-1 pr-2">文件 / 分析</th>
                <th className="py-1 pr-2">政府处理结果</th>
                <th className="py-1 pr-2">期限</th>
                <th className="py-1">待办</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={String(r.id)} className="border-t border-border align-top" data-testid="ledger-row">
                  <td className="py-1.5 pr-2">
                    <Link className="text-accent underline" href={`/projects/intelligence/records/${String(r.id)}`}>
                      {String(r.title)}
                    </Link>
                    <p className="text-[11px] text-muted">
                      {JURISDICTION_LABELS[r.jurisdiction as keyof typeof JURISDICTION_LABELS] ?? String(r.jurisdiction)}
                      {r.projectName ? ` · ${String(r.projectName)}` : ""}
                      {r.origin !== "NORMAL" ? ` · ${r.origin === "HISTORICAL_IMPORT" ? "历史导入（待核实）" : "测试数据"}` : ""}
                      {r.caseNumber ? ` · 案件 ${String(r.caseNumber)}` : ""}
                    </p>
                  </td>
                  <td className="py-1.5 pr-2">{String(r.recipientDisplay ?? "未核实")}</td>
                  <td className="py-1.5 pr-2">
                    <Chip tone={toneForStatus(String(r.status))}>{REQUEST_STATUS_LABELS[r.status as RequestStatus] ?? String(r.status)}</Chip>
                    {r.evidenceLevel ? <p className="mt-0.5 text-[11px] text-muted">{EVIDENCE_LEVEL_LABELS[String(r.evidenceLevel)] ?? String(r.evidenceLevel)}</p> : null}
                  </td>
                  <td className="py-1.5 pr-2">
                    {FILES_STATUS_LABELS[String(r.filesStatus)] ?? String(r.filesStatus)}
                    <br />
                    <span className="text-muted">{ANALYSIS_STATUS_LABELS[String(r.analysisStatus)] ?? String(r.analysisStatus)}</span>
                  </td>
                  <td className="py-1.5 pr-2">{r.governmentOutcome ? OUTCOME_LABELS[r.governmentOutcome as GovernmentOutcome] : "—"}</td>
                  <td className="py-1.5 pr-2">
                    {r.officialDueAt ? `官方 ${String(r.officialDueAt)}` : r.estimatedDueAt ? `估算 ${String(r.estimatedDueAt)}` : "—"}
                  </td>
                  <td className="py-1.5">{Number(r.pendingTasks) > 0 ? <Chip tone="warn">{String(r.pendingTasks)} 条</Chip> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note note={api.note} />
      </Section>

      <Section title="申请人资料" hint="只有组织管理员能维护；修改即版本 +1 并回到未确认；不从历史回复信自动带出地址；系统不补造姓名、地址或编号。" testId="applicants" actions={<Btn onClick={() => setEditing({ label: "申请人" })}>新增</Btn>}>
        <ul className="space-y-2">
          {applicants.map((a) => (
            <li key={String(a.id)} className="rounded-lg border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <span className="font-medium">{String(a.label)}</span> · v{String(a.version)} ·{" "}
                  <Chip tone={toneForStatus(String(a.verificationStatus))}>{a.verificationStatus === "CONFIRMED" ? "已确认" : "未确认"}</Chip>
                </p>
                <div className="flex gap-2">
                  <Btn onClick={() => setEditing({ ...a })}>修改</Btn>
                  {a.verificationStatus !== "CONFIRMED" ? (
                    <Btn variant="primary" onClick={() => void confirmApplicant(a)} busy={api.busy === `conf-${String(a.id)}`}>
                      核对无误，确认
                    </Btn>
                  ) : null}
                </div>
              </div>
              <p className="mt-1 text-muted">
                {[a.legalName, a.representativeName, a.addressLine1, a.city, a.province, a.postalCode, a.country, a.email].map((x) => (x ? String(x) : "（缺）")).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
        {editing ? (
          <div className="mt-3 grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
            {APPLICANT_FIELDS.map(([k, label]) => (
              <Field key={k} label={label}>
                <input className={inputCls} value={String(editing[k] ?? "")} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
              </Field>
            ))}
            <div className="flex items-end gap-2">
              <Btn variant="primary" onClick={() => void saveApplicant()} busy={api.busy === "saveApp"}>保存</Btn>
              <Btn onClick={() => setEditing(null)}>取消</Btn>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="机关申请规则" hint="种子来自任务书引用的官方页面，未经核实；核实须由组织管理员打开官方页面核对入口、费用与时限，并写明方法。未知费用为空，不按 0 处理。" testId="rules">
        <ul className="space-y-2">
          {rules.map((r) => {
            const v = verify[String(r.id)] ?? { portal: String(r.officialPortalUrl ?? ""), fee: r.applicationFeeCents === null ? "" : String(r.applicationFeeCents), method: "" };
            const refs = (Array.isArray(r.sourceRefsJson) ? r.sourceRefsJson : []) as Array<{ label: string; url: string }>;
            return (
              <li key={String(r.id)} className="rounded-lg border border-border p-3 text-xs">
                <p>
                  <span className="font-medium">{JURISDICTION_LABELS[r.jurisdiction as keyof typeof JURISDICTION_LABELS] ?? String(r.jurisdiction)}</span> · {String(r.lawLabel)} · {String(r.channel)} ·{" "}
                  <Chip tone={toneForStatus(String(r.verificationStatus))}>{r.verificationStatus === "VERIFIED" ? "已核实" : "未核实"}</Chip>
                  {r.selfServeSupported ? null : <Chip tone="warn">自助提交未核实 → 只能研究与草拟</Chip>}
                </p>
                <p className="mt-1 text-muted">
                  费用：{cents(r.applicationFeeCents as number | null, r.currency as string | null)} · 时限：{r.deadlineValue ? `${String(r.deadlineValue)} ${r.deadlineUnit === "BUSINESS_DAYS" ? "个工作日" : "个日历日"}` : "未核实"} · 入口：{r.officialPortalUrl ? String(r.officialPortalUrl) : "未核实"}
                  {r.verifiedAt ? ` · 核实于 ${when(String(r.verifiedAt))}：${String(r.verificationMethod ?? "")}` : ""}
                </p>
                {r.otherFeesRule ? <p className="mt-0.5 text-muted">其他费用：{String(r.otherFeesRule)}</p> : null}
                {refs.length ? (
                  <p className="mt-0.5">
                    {refs.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" className="mr-2 text-accent underline">
                        {s.label}
                      </a>
                    ))}
                  </p>
                ) : null}
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <input className={inputCls} placeholder="官方提交入口（https）" value={v.portal} onChange={(e) => setVerify({ ...verify, [String(r.id)]: { ...v, portal: e.target.value } })} />
                  <input className={inputCls} placeholder="费用（分；免费填 0）" value={v.fee} onChange={(e) => setVerify({ ...verify, [String(r.id)]: { ...v, fee: e.target.value } })} />
                  <input className={inputCls} placeholder="核实方法（打开了哪个官方页面、看到了什么）" value={v.method} onChange={(e) => setVerify({ ...verify, [String(r.id)]: { ...v, method: e.target.value } })} />
                  <Btn onClick={() => void verifyRule(r)} busy={api.busy === `rule-${String(r.id)}`}>保存并标为已核实</Btn>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="历史台账" hint="首次使用：导入历史申请，或由真实用户确认某范围没有历史申请；系统不会自行宣称台账完整。未确认时重复检查显示 UNVERIFIED。" testId="ledger-attestations">
        <ul className="mb-3 space-y-1 text-xs">
          {attests.map((a) => (
            <li key={String(a.id)}>
              {JURISDICTION_LABELS[a.jurisdiction as keyof typeof JURISDICTION_LABELS] ?? String(a.jurisdiction)} · 机关 {String(a.institutionKey)} · {a.method === "USER_CONFIRMED_NONE" ? "确认无历史申请" : "已导入历史"} · {String(a.attestedBy)} 于 {when(String(a.attestedAt))}
              {a.note ? ` · ${String(a.note)}` : ""}
            </li>
          ))}
          {attests.length === 0 ? <li className="text-muted">尚无台账确认。</li> : null}
        </ul>
        <div className="grid gap-2 sm:grid-cols-4">
          <select className={inputCls} value={att.jurisdiction} onChange={(e) => setAtt({ ...att, jurisdiction: e.target.value })}>
            {Object.entries(JURISDICTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input className={inputCls} value={att.institutionKey} onChange={(e) => setAtt({ ...att, institutionKey: e.target.value })} placeholder="机关（* = 全部）" />
          <select className={inputCls} value={att.method} onChange={(e) => setAtt({ ...att, method: e.target.value })}>
            <option value="USER_CONFIRMED_NONE">我确认此范围没有历史申请</option>
            <option value="HISTORY_IMPORTED">我已导入此范围的全部历史申请</option>
          </select>
          <input className={inputCls} value={att.note} onChange={(e) => setAtt({ ...att, note: e.target.value })} placeholder="说明" />
        </div>
        <div className="mt-2">
          <Btn onClick={() => void attest()} busy={api.busy === "attest"}>记录确认</Btn>
        </div>
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted">导入历史申请（JSON；旧状态经显式映射，未知值拒绝）</summary>
          <textarea className={`${inputCls} mt-2 h-32 font-mono`} value={historyJson} onChange={(e) => setHistoryJson(e.target.value)} placeholder='[{"title":"…","jurisdiction":"CA-FED","recipientInstitution":null,"instrumentNumbers":["CW…"],"startDate":"2021-11-01","endDate":"2025-07-04","legacyStatus":"RELEASE_NOTICE_RECEIVED","caseNumber":"A-…","originNote":"来源说明"}]' />
          <Btn onClick={() => void importHistory()} busy={api.busy === "hist"}>导入</Btn>
        </details>
      </Section>
    </div>
  );
}
