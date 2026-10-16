"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2, RotateCcw, AlertCircle, Lock } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

interface PanelCodeView {
  id: string | null;
  code: string;
  louverSize: number | null;
  strips: number;
  caps: number;
  note: string | null;
  source: "builtin" | "custom";
  overridesBuiltin: boolean;
}

interface DraftRow {
  code: string;
  louverSize: string; // "" = 通用
  strips: string;
  caps: string;
  note: string;
}

const EMPTY_DRAFT: DraftRow = { code: "", louverSize: "", strips: "", caps: "", note: "" };

function sizeLabel(v: number | null): string {
  return v == null ? "通用" : `${v}"`;
}

export default function VinylPanelCodesPage() {
  const [codes, setCodes] = useState<PanelCodeView[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftRow>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<Record<string, DraftRow>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/vinyl/panel-codes");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCodes(data.codes ?? []);
      setCanEdit(Boolean(data.canEdit));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const customCount = useMemo(() => codes.filter((c) => c.source === "custom").length, [codes]);

  async function send(url: string, method: string, body?: unknown, key = url) {
    setBusy(key);
    setError("");
    try {
      const res = await apiFetch(url, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      return false;
    } finally {
      setBusy(null);
    }
  }

  function toPayload(d: DraftRow) {
    return {
      code: d.code,
      louverSize: d.louverSize === "" ? null : Number(d.louverSize),
      strips: Number(d.strips),
      caps: Number(d.caps),
      note: d.note,
    };
  }

  async function handleCreate() {
    if (await send("/api/vinyl/panel-codes", "POST", toPayload(draft), "create")) {
      setDraft(EMPTY_DRAFT);
      await load();
    }
  }

  async function handleSave(id: string) {
    const d = editing[id];
    if (!d) return;
    if (await send(`/api/vinyl/panel-codes/${id}`, "PUT", toPayload(d), id)) {
      setEditing((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      await load();
    }
  }

  async function handleDelete(row: PanelCodeView) {
    if (!row.id) return;
    const msg = row.overridesBuiltin
      ? `删除后「${row.code}」将回落到内置默认值，确认？`
      : `删除自定义编码「${row.code}」？删除后这个码在工艺单里将变成"待补"。`;
    if (!window.confirm(msg)) return;
    if (await send(`/api/vinyl/panel-codes/${row.id}`, "DELETE", undefined, row.id)) {
      await load();
    }
  }

  function startEdit(row: PanelCodeView) {
    if (!row.id) return;
    setEditing((p) => ({
      ...p,
      [row.id!]: {
        code: row.code,
        louverSize: row.louverSize == null ? "" : String(row.louverSize),
        strips: String(row.strips),
        caps: String(row.caps),
        note: row.note ?? "",
      },
    }));
  }

  /** 把内置项复制成一条可编辑的自定义项（不直接改内置基线） */
  function overrideBuiltin(row: PanelCodeView) {
    setDraft({
      code: row.code,
      louverSize: row.louverSize == null ? "" : String(row.louverSize),
      strips: String(row.strips),
      caps: String(row.caps),
      note: "覆盖内置默认值",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const inputCls =
    "w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div className="mx-auto max-w-5xl px-5 py-6">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={15} /> 返回设置
      </Link>

      <h1 className="text-xl font-semibold">Vinyl 百叶窗 · 开启状态编码</h1>
      <p className="mt-1 text-sm text-muted">
        工艺单里每扇窗的方向码（如 <code className="font-mono">LLRR</code>）决定 LIGHT BLOCK 盖条与盖的用量。
        内置表誊录自《Vinyl百叶窗统一工艺单 V15》不可改；新工艺出现新码时，在这里加即可，无需改代码发版。
      </p>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {!loading && !canEdit && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-[rgba(26,36,32,0.03)] px-4 py-3 text-sm text-muted">
          <Lock size={15} className="shrink-0" />
          编码表直接影响工厂下料用量，只有企业负责人可以修改。你可以查看。
        </div>
      )}

      {canEdit && (
        <div className="mt-5 rounded-xl border border-border bg-card-bg p-4">
          <h2 className="mb-3 text-sm font-semibold">新增编码</h2>
          <div className="grid grid-cols-[1.4fr_1fr_0.8fr_0.8fr_2fr_auto] items-end gap-2">
            <label className="text-xs text-muted">
              方向码
              <input
                className={`${inputCls} mt-1 font-mono uppercase`}
                value={draft.code}
                placeholder="LLRR"
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="text-xs text-muted">
              百叶尺寸
              <select
                className={`${inputCls} mt-1`}
                value={draft.louverSize}
                onChange={(e) => setDraft({ ...draft, louverSize: e.target.value })}
              >
                <option value="">通用</option>
                <option value="2.5">2.5&quot;</option>
                <option value="3.5">3.5&quot;</option>
              </select>
            </label>
            <label className="text-xs text-muted">
              条
              <input
                type="number" min={0} max={99}
                className={`${inputCls} mt-1 font-mono`}
                value={draft.strips}
                onChange={(e) => setDraft({ ...draft, strips: e.target.value })}
              />
            </label>
            <label className="text-xs text-muted">
              盖
              <input
                type="number" min={0} max={99}
                className={`${inputCls} mt-1 font-mono`}
                value={draft.caps}
                onChange={(e) => setDraft({ ...draft, caps: e.target.value })}
              />
            </label>
            <label className="text-xs text-muted">
              备注
              <input
                className={`${inputCls} mt-1`}
                value={draft.note}
                placeholder="这个码代表的开启方式"
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <button
              onClick={handleCreate}
              disabled={busy === "create" || !draft.code || draft.strips === "" || draft.caps === ""}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white disabled:opacity-40"
            >
              <Plus size={15} /> 添加
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card-bg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            编码表 <span className="font-normal text-muted">共 {codes.length} 条 · 自定义 {customCount} 条</span>
          </h2>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted">加载中…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">方向码</th>
                <th className="px-3 py-2.5 font-medium">百叶尺寸</th>
                <th className="px-3 py-2.5 font-medium">条</th>
                <th className="px-3 py-2.5 font-medium">盖</th>
                <th className="px-3 py-2.5 font-medium">来源 / 备注</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {codes.map((row) => {
                const rowKey = row.id ?? `builtin-${row.code}-${row.louverSize ?? "all"}`;
                const d = row.id ? editing[row.id] : undefined;
                return (
                  <tr key={rowKey} className="hover:bg-[rgba(43,96,85,0.02)]">
                    <td className="px-4 py-2 font-mono font-medium">
                      {d ? (
                        <input
                          className={`${inputCls} font-mono uppercase`}
                          value={d.code}
                          onChange={(e) =>
                            setEditing((p) => ({ ...p, [row.id!]: { ...d, code: e.target.value.toUpperCase() } }))
                          }
                        />
                      ) : (
                        row.code
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {d ? (
                        <select
                          className={inputCls}
                          value={d.louverSize}
                          onChange={(e) =>
                            setEditing((p) => ({ ...p, [row.id!]: { ...d, louverSize: e.target.value } }))
                          }
                        >
                          <option value="">通用</option>
                          <option value="2.5">2.5&quot;</option>
                          <option value="3.5">3.5&quot;</option>
                        </select>
                      ) : (
                        <span className={row.louverSize == null ? "text-muted" : ""}>{sizeLabel(row.louverSize)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {d ? (
                        <input
                          type="number" className={`${inputCls} font-mono`} value={d.strips}
                          onChange={(e) => setEditing((p) => ({ ...p, [row.id!]: { ...d, strips: e.target.value } }))}
                        />
                      ) : (
                        row.strips
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {d ? (
                        <input
                          type="number" className={`${inputCls} font-mono`} value={d.caps}
                          onChange={(e) => setEditing((p) => ({ ...p, [row.id!]: { ...d, caps: e.target.value } }))}
                        />
                      ) : (
                        row.caps
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.source === "builtin" ? (
                        <span className="rounded bg-[rgba(26,36,32,0.05)] px-1.5 py-0.5 text-muted">内置 V15</span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">自定义</span>
                          {row.overridesBuiltin && <span className="text-muted">覆盖内置</span>}
                          {d ? (
                            <input
                              className={inputCls}
                              value={d.note}
                              onChange={(e) => setEditing((p) => ({ ...p, [row.id!]: { ...d, note: e.target.value } }))}
                            />
                          ) : (
                            row.note && <span className="text-muted">{row.note}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {!canEdit ? null : row.source === "builtin" ? (
                        <button
                          onClick={() => overrideBuiltin(row)}
                          className="text-xs text-muted hover:text-accent"
                        >
                          覆盖
                        </button>
                      ) : d ? (
                        <span className="inline-flex gap-2">
                          <button
                            onClick={() => handleSave(row.id!)}
                            disabled={busy === row.id}
                            className="inline-flex items-center gap-1 text-xs text-accent disabled:opacity-40"
                          >
                            <Save size={13} /> 保存
                          </button>
                          <button
                            onClick={() =>
                              setEditing((p) => {
                                const next = { ...p };
                                delete next[row.id!];
                                return next;
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs text-muted"
                          >
                            <RotateCcw size={13} /> 取消
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-2">
                          <button onClick={() => startEdit(row)} className="text-xs text-muted hover:text-accent">
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(row)}
                            disabled={busy === row.id}
                            className="inline-flex items-center gap-1 text-xs text-danger disabled:opacity-40"
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        找不到的码不会按 0 处理 —— 工艺单会把那一行标成「条盖待补」并在导出末尾列出来，
        因为静默算成 0 会出一份少料的物料单。
      </p>
    </div>
  );
}
