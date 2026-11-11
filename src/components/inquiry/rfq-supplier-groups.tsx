"use client";

/**
 * RFQ-AUTO-5 询价抽屉里的「供应商分组」：一排可点的分组 + 管理（存为新分组 / 用当前勾选覆盖 / 改名字与关键词 / 删除）。
 *
 * 只决定「先勾选谁」：点一个分组 = 把勾选换成这一组里现在可选的供应商，之后照常增减。
 * 不发信、不批准、不建轮次。分组的名字与关键词不进询价单与邮件。
 * 规则（校验、比对、勾选、保存结果的处理）全在 supplier-groups.ts 的纯函数里，这里只负责显示与调用。
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import {
  addGroup,
  findGroup,
  groupHint,
  groupsWithoutKeywords,
  interpretGroupsSaveResponse,
  parseKeywordsInput,
  removeGroup,
  replaceGroupSuppliers,
  sameSelection,
  selectionForGroup,
  updateGroupMeta,
  validateSupplierGroups,
  type SupplierGroupsDoc,
  type SupplierGroupsEntry,
} from "@/lib/tender-rfq/supplier-groups";
import { cn } from "@/lib/utils";

type Supplier = { id: string; ready: boolean; isDefault: boolean };

type Props = {
  projectId: string;
  view: SupplierGroupsEntry;
  suppliers: Supplier[];
  /** 抽屉里当前勾选的供应商 */
  selected: string[];
  max: number;
  /** 点了一个分组：把勾选换成这些 */
  onSelect: (ids: string[]) => void;
  /** 保存成功或发现别处改过：换成这一份（父组件同时刷新入口） */
  onSaved: (view: SupplierGroupsEntry) => void;
};

const inputCls = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent/60";

export function RfqSupplierGroups({ projectId, view, suppliers, selected, max, onSelect, onSaved }: Props) {
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [editing, setEditing] = useState<{ group: string; name: string; keywords: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const doc: SupplierGroupsDoc = { groups: view.groups.map((g) => ({ name: g.name, supplierIds: g.supplierIds, keywords: g.keywords })) };
  const hint = groupHint({ groups: view, suppliers, selected, max });
  const noKeywords = groupsWithoutKeywords(doc);
  const atLimit = view.groups.length >= view.limits.groups;

  /** 整份保存。成功返回 true；失败时界面上的分组与勾选都不动，只显示原因。 */
  async function save(next: SupplierGroupsDoc): Promise<boolean> {
    const checked = validateSupplierGroups(next.groups);
    if (!checked.ok) {
      setMessage({ tone: "error", text: checked.error });
      return false;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tender-rfq/supplier-groups`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseVersion: view.version, groups: checked.doc.groups }),
      });
      const outcome = interpretGroupsSaveResponse({ ok: res.ok, status: res.status, json: await res.json().catch(() => null) });
      if (outcome.kind === "saved") {
        onSaved(outcome.view);
        return true;
      }
      if (outcome.kind === "conflict") {
        // 分组换成了最新的一份：正在改 / 正在确认删除的那一组可能已经不在了，一并收起
        onSaved(outcome.view);
        setEditing(null);
        setConfirmDelete(null);
      }
      setMessage({ tone: "error", text: outcome.messageZh });
      return false;
    } catch {
      setMessage({ tone: "error", text: "网络出错了，没有保存，请重试。" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createFromSelection() {
    if (await save(addGroup(doc, { name: newName, supplierIds: selected, keywords: parseKeywordsInput(newKeywords) }))) {
      setNewName("");
      setNewKeywords("");
    }
  }

  /** 要改的那一组还在不在（别处删掉或改名之后，这里的按钮可能还留着） */
  function stillThere(name: string): boolean {
    if (findGroup(doc, name)) return true;
    setMessage({ tone: "error", text: `分组「${name}」已经不在了，没有改动。` });
    setEditing(null);
    setConfirmDelete(null);
    return false;
  }

  async function saveEditing() {
    if (!editing || !stillThere(editing.group)) return;
    if (await save(updateGroupMeta(doc, editing.group, { name: editing.name, keywords: parseKeywordsInput(editing.keywords) }))) setEditing(null);
  }

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-background p-2.5 text-xs" data-testid="rfq-groups-bar">
      {view.groups.length === 0 ? (
        <p className="text-muted">还没有供应商分组。按品类分好组、填上关键词之后，系统会按项目名称替你选对应的那一组。</p>
      ) : (
        <>
          {hint && (
            <p className={cn(hint.tone === "matched" ? "text-foreground/85" : "text-[#9a6a2f]")} data-testid="rfq-group-hint">
              {hint.textZh}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {view.groups.map((g) => {
              const ids = selectionForGroup(g, suppliers, max);
              const active = ids.length > 0 && sameSelection(ids, selected);
              return (
                <button
                  key={g.name}
                  type="button"
                  onClick={() => onSelect(ids)}
                  title={g.keywords.length ? `关键词：${g.keywords.join("、")}` : "没有关键词：不会被自动选中"}
                  aria-pressed={active}
                  data-testid="rfq-group-chip"
                  className={cn(
                    "rounded-full border px-2.5 py-1 transition-colors",
                    active ? "border-accent bg-accent/10 text-accent" : "border-border text-foreground hover:border-accent/50",
                  )}
                >
                  {g.name}
                  <span className="ml-1 text-muted">
                    {g.readyCount === g.supplierIds.length ? `${g.readyCount} 家` : `${g.readyCount} / ${g.supplierIds.length} 家可选`}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <button type="button" onClick={() => setManaging((v) => !v)} className="inline-flex items-center gap-1 text-accent" data-testid="rfq-groups-manage-toggle">
        {managing ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        管理分组
      </button>

      {managing && (
        <div className="space-y-3 border-t border-border/60 pt-2" data-testid="rfq-groups-manage">
          {view.groups.map((g) => (
            <div key={g.name} className="space-y-1.5" data-testid="rfq-group-row">
              {editing?.group === g.name ? (
                <div className="space-y-1.5">
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} maxLength={60} aria-label="分组名字" />
                  <input
                    value={editing.keywords}
                    onChange={(e) => setEditing({ ...editing, keywords: e.target.value })}
                    className={inputCls}
                    placeholder="关键词，逗号分隔，如 blind, shade, 窗帘"
                    aria-label="关键词"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="accent" onClick={saveEditing} loading={busy} loadingText="保存中…">
                      保存
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-foreground">{g.name}</span>
                  <span className="text-muted">
                    {g.supplierIds.length} 家 · {g.keywords.length ? `关键词：${g.keywords.join("、")}` : "没有关键词"}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || selected.length === 0}
                      onClick={() => stillThere(g.name) && save(replaceGroupSuppliers(doc, g.name, selected))}
                      className="text-accent disabled:text-muted"
                      title={selected.length === 0 ? "先勾选供应商" : `把这一组的供应商换成当前勾选的 ${selected.length} 家`}
                      data-testid="rfq-group-overwrite"
                    >
                      用当前勾选覆盖
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditing({ group: g.name, name: g.name, keywords: g.keywords.join(", ") })}
                      aria-label={`改「${g.name}」的名字与关键词`}
                      className="text-muted hover:text-foreground"
                    >
                      <Pencil size={13} />
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirmDelete(g.name)} aria-label={`删除分组「${g.name}」`} className="text-muted hover:text-danger">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              )}
              {confirmDelete === g.name && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/[0.04] p-2 text-danger" role="alert">
                  <span>删除分组「{g.name}」？供应商本身不会被删。</span>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy}
                    loadingText="删除中…"
                    onClick={async () => {
                      if (stillThere(g.name) && (await save(removeGroup(doc, g.name)))) setConfirmDelete(null);
                    }}
                    data-testid="rfq-group-delete-confirm"
                  >
                    确认删除
                  </Button>
                  <button type="button" onClick={() => setConfirmDelete(null)} disabled={busy} className="text-muted">
                    取消
                  </button>
                </div>
              )}
            </div>
          ))}

          <div className="space-y-1.5 rounded-md border border-dashed border-border p-2">
            <p className="flex items-center gap-1 font-medium text-foreground">
              <FolderPlus size={13} />
              把当前勾选的 {selected.length} 家存为新分组
            </p>
            {atLimit ? (
              <p className="text-muted">最多 {view.limits.groups} 个分组，先删掉一个再加。</p>
            ) : (
              <>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputCls} placeholder="名字，如 窗饰" maxLength={60} aria-label="新分组的名字" data-testid="rfq-group-new-name" />
                <input
                  value={newKeywords}
                  onChange={(e) => setNewKeywords(e.target.value)}
                  className={inputCls}
                  placeholder="关键词，逗号分隔，如 blind, shade, 窗帘"
                  aria-label="新分组的关键词"
                  data-testid="rfq-group-new-keywords"
                />
                <p className="text-muted">项目名称里出现任一关键词，就用这一组。不填关键词的组不会被自动选中，只能手动点。</p>
                <Button size="sm" variant="outline" onClick={createFromSelection} disabled={selected.length === 0 || !newName.trim()} loading={busy} loadingText="保存中…" data-testid="rfq-group-create">
                  存为分组
                </Button>
              </>
            )}
          </div>

          {noKeywords.length > 0 && <p className="text-[#9a6a2f]">没有关键词的组不会被自动选中：{noKeywords.map((n) => `「${n}」`).join("")}。</p>}
        </div>
      )}

      {message && (
        <p className={cn(message.tone === "error" ? "text-danger" : "text-muted")} role={message.tone === "error" ? "alert" : undefined} data-testid="rfq-groups-message">
          {message.text}
        </p>
      )}
    </div>
  );
}
