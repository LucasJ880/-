"use client";

/**
 * PERM-7：企业详情页「岗位」一节（只对平台 super_admin 渲染；接口 /api/organizations/[orgId]/positions 只认 super_admin）
 *
 * 编辑的是一个人 / 一个数字员工在本企业的完整岗位集合：先预览差异（dryRun），确认后写入。
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";

interface ProfileRow {
  key: string;
  name: string;
  group: "pack" | "system";
}

interface PositionsData {
  org: { id: string; name: string; positionMode: boolean };
  profiles: ProfileRow[];
  members: Array<{ userId: string; name: string; email: string; orgRole: string; keys: string[] }>;
  digitalEmployees: Array<{ agentId: string; name: string; sponsor: string | null; keys: string[] }>;
  digitalAllowedKeys: string[];
}

type PlanItem = { profileKey: string };
interface Plan {
  create: PlanItem[];
  keep: PlanItem[];
  deactivate: PlanItem[];
}

interface Editing {
  principalType: "HUMAN" | "DIGITAL_EMPLOYEE";
  principalId: string;
  label: string;
  keys: string[];
}

export function PositionsSection({ orgId }: { orgId: string }) {
  const [data, setData] = useState<PositionsData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [preview, setPreview] = useState<Plan | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiJson<PositionsData>(`/api/organizations/${orgId}/positions`)
      .then((d) => {
        setData(d);
        setLoadError("");
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "加载岗位失败"));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const nameOf = (key: string) => data?.profiles.find((p) => p.key === key)?.name ?? key;

  function startEdit(next: Editing) {
    setEditing(next);
    setPreview(null);
    setErrors([]);
  }

  function toggle(key: string) {
    if (!editing) return;
    const has = editing.keys.includes(key);
    setEditing({ ...editing, keys: has ? editing.keys.filter((k) => k !== key) : [...editing.keys, key] });
    setPreview(null);
  }

  async function submit(dryRun: boolean) {
    if (!editing) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await apiFetch(`/api/organizations/${orgId}/positions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ principalType: editing.principalType, principalId: editing.principalId, keys: editing.keys, dryRun }),
      });
      const body = (await res.json().catch(() => ({}))) as { plan?: Plan; error?: string; errors?: string[] };
      if (!res.ok) {
        setErrors(body.errors?.length ? body.errors : [body.error ?? `保存失败（${res.status}）`]);
        return;
      }
      if (dryRun) {
        setPreview(body.plan ?? null);
        return;
      }
      setEditing(null);
      setPreview(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-border bg-card-bg p-5 text-sm text-[#a63d3d]">{loadError}</div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card-bg p-5 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" /> 加载岗位…
      </div>
    );
  }

  const choices =
    editing?.principalType === "DIGITAL_EMPLOYEE"
      ? data.profiles.filter((p) => data.digitalAllowedKeys.includes(p.key))
      : data.profiles;
  const groups: Array<{ title: string; rows: ProfileRow[] }> = [
    { title: "行业包岗位", rows: choices.filter((p) => p.group === "pack") },
    { title: "系统模板", rows: choices.filter((p) => p.group === "system") },
  ].filter((g) => g.rows.length > 0);

  const keyChips = (keys: string[]) =>
    keys.length ? (
      <span className="flex flex-wrap gap-1">
        {keys.map((k) => (
          <span key={k} className="rounded bg-accent/10 px-1.5 py-0.5 text-xs">
            {nameOf(k)}
          </span>
        ))}
      </span>
    ) : (
      <span className="text-xs text-muted">无岗位</span>
    );

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <h2 className="text-sm font-semibold">岗位</h2>
      <p className="mt-1 text-xs text-muted">
        仅平台管理员可见。勾选的是此人在本企业的全部岗位：未勾选的现有岗位会被停用。保存前先预览差异。
        {data.org.positionMode ? "本企业按岗位判定权限，至少保留一位老板岗位。" : "本企业尚未启用岗位模式（旧规则仍按企业角色兜底）。"}
      </p>

      <div className="mt-4 max-w-full overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="pb-2 pr-2">成员</th>
              <th className="pb-2 pr-2">企业角色</th>
              <th className="pb-2 pr-2">岗位</th>
              <th className="pb-2 w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.userId} className="border-b border-border/60">
                <td className="py-2 pr-2">
                  {m.name}
                  <div className="text-xs text-muted">{m.email}</div>
                </td>
                <td className="py-2 pr-2 text-xs">{m.orgRole}</td>
                <td className="py-2 pr-2">{keyChips(m.keys)}</td>
                <td className="py-2">
                  <button
                    type="button"
                    className="text-xs text-accent hover:underline"
                    onClick={() => startEdit({ principalType: "HUMAN", principalId: m.userId, label: m.name || m.email, keys: m.keys })}
                  >
                    编辑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.digitalEmployees.length > 0 && (
        <>
          <h3 className="mt-5 text-xs font-semibold">数字员工岗位</h3>
          <p className="mt-1 text-xs text-muted">只允许 {data.digitalAllowedKeys.map(nameOf).join(" / ") || "（本企业未落地可用岗位）"}；审批人为 sponsor（Agent 创建人）。</p>
          <div className="mt-2 max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[560px] text-left text-sm">
              <tbody>
                {data.digitalEmployees.map((a) => (
                  <tr key={a.agentId} className="border-b border-border/60">
                    <td className="py-2 pr-2">
                      {a.name}
                      <div className="text-xs text-muted">sponsor：{a.sponsor ?? "—"}</div>
                    </td>
                    <td className="py-2 pr-2">{keyChips(a.keys)}</td>
                    <td className="py-2 w-20">
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline"
                        onClick={() => startEdit({ principalType: "DIGITAL_EMPLOYEE", principalId: a.agentId, label: a.name, keys: a.keys })}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <div className="mt-5 rounded-lg border border-border p-4">
          <div className="text-sm font-semibold">编辑岗位：{editing.label}</div>
          {groups.map((g) => (
            <div key={g.title} className="mt-3">
              <div className="text-xs text-muted">{g.title}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {g.rows.map((p) => (
                  <label key={p.key} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={editing.keys.includes(p.key)} onChange={() => toggle(p.key)} />
                    {p.name}
                    <span className="text-xs text-muted">{p.key}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {preview && (
            <div className="mt-3 rounded bg-background p-3 text-xs">
              <div>新增：{preview.create.map((x) => nameOf(x.profileKey)).join("、") || "无"}</div>
              <div>停用：{preview.deactivate.map((x) => nameOf(x.profileKey)).join("、") || "无"}</div>
              <div className="text-muted">保留：{preview.keep.map((x) => nameOf(x.profileKey)).join("、") || "无"}</div>
            </div>
          )}
          {errors.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-xs text-[#a63d3d]">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex gap-2">
            {!preview ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => submit(true)}
                className="rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                预览差异
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || (preview.create.length === 0 && preview.deactivate.length === 0)}
                onClick={() => submit(false)}
                className="rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-sm text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50"
              >
                确认保存
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(null)}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm text-muted hover:text-foreground"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
