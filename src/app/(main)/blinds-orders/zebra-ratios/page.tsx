"use client";

/**
 * 斑马帘「面料编码 → 布:纱」对照表（组织级，存 Organization.settingsJson）。
 * 报价签字生成工艺单、以及国内下单行退回自产时查这张表；查不到默认 3:2 并在待核对里提示。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { ensureSkuCatalogLoaded } from "@/lib/blinds/sku-catalog";
import { lookupZebraRatio, parseRatioPart, ratioPartText, type ZebraRatioEntry } from "@/lib/sunny-process/zebra-ratios";

interface Row {
  codes: string;
  fabric: string;
  silk: string;
  noteZh: string;
}

const toRow = (e: ZebraRatioEntry): Row => ({ codes: e.codes.join(", "), fabric: ratioPartText(e.fabric), silk: ratioPartText(e.silk), noteZh: e.noteZh });

function toEntry(r: Row): ZebraRatioEntry | null {
  const codes = r.codes.split(/[,，;；\n]/).map((c) => c.trim()).filter(Boolean);
  const fabric = parseRatioPart(r.fabric);
  const silk = parseRatioPart(r.silk);
  return codes.length > 0 && fabric !== null && silk !== null ? { codes, fabric, silk, noteZh: r.noteZh } : null;
}

const inputCls = "w-full rounded border border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-accent";

/** 报价目录 SKU 的系列名（第一段），如 AQUAWIDE3-BEIGE-LF → AQUAWIDE3 */
const familyOf = (sku: string) => sku.split("-")[0]!.trim();

export default function ZebraRatiosPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState("");
  const [catalog, setCatalog] = useState<string[]>([]);
  const query = typeof window !== "undefined" ? window.location.search : "";

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(`/api/sunny-process/zebra-ratios${query}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "加载失败");
    } else {
      setRows((data.entries as ZebraRatioEntry[]).map(toRow));
      setSeeded(!!data.seeded);
      setCanEdit(!!data.canEdit);
      setDirty(false);
      setError(null);
    }
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void load();
    ensureSkuCatalogLoaded()
      .then((c) => setCatalog([...new Set((c.Zebra ?? []).filter((e) => !e.isCategoryFallback).map((e) => e.sku))]))
      .catch(() => setCatalog([]));
  }, [load]);

  const entries = useMemo(() => rows.map(toEntry), [rows]);
  const valid = entries.filter((e): e is ZebraRatioEntry => e !== null);
  const invalidCount = entries.length - valid.length;
  const probeHit = probe.trim() ? lookupZebraRatio(valid, probe) : null;
  const missingFamilies = useMemo(() => {
    const fams = [...new Set(catalog.map(familyOf))].filter(Boolean);
    return fams.filter((f) => !catalog.some((sku) => familyOf(sku) === f && lookupZebraRatio(valid, sku)));
  }, [catalog, valid]);

  function edit(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  async function save() {
    if (invalidCount > 0 && !confirm(`有 ${invalidCount} 行编码或布/纱未填对，这些行不会保存。继续？`)) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/sunny-process/zebra-ratios${query}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: valid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "保存失败");
        return;
      }
      setRows((data.entries as ZebraRatioEntry[]).map(toRow));
      setSeeded(false);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/blinds-orders" className="text-muted hover:text-foreground"><ArrowLeft size={20} /></Link>
            <h1 className="text-2xl font-bold text-foreground">斑马帘布纱比对照表</h1>
          </div>
          <p className="mt-1 ml-8 text-sm text-muted">
            报价签字自动生成工艺单、国内下单行退回自产时按面料查布:纱；查不到默认 3:2 并在待核对里提示。只影响之后生成的工艺单。
          </p>
        </div>
        <button
          onClick={save}
          disabled={!canEdit || saving || loading || (!dirty && !seeded)}
          title={canEdit ? undefined : "需要组织管理员才能修改"}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? "保存中..." : seeded && !dirty ? "启用为本组织对照表" : "保存"}
        </button>
      </div>

      {error && <div className="rounded-lg border border-[rgba(166,61,61,0.25)] px-4 py-2 text-sm text-danger">{error}</div>}
      {!loading && !error && !canEdit && (
        <div className="rounded-lg border border-border px-4 py-2 text-xs text-muted">只读：这张表影响全组织之后所有斑马帘的裁剪位，需要组织管理员修改。</div>
      )}
      {seeded && !error && (
        <div className="rounded-lg border border-[rgba(154,106,47,0.25)] bg-[rgba(154,106,47,0.04)] px-4 py-2 text-xs text-[#9a6a2f]">
          当前是原件《Blinds 工艺单》Sheet1 备注里的工厂面料编码（未保存）。报价单用的是销售目录 SKU（如 AQUAWIDE3-BEIGE-LF），
          请在「编码」里补上对应的报价 SKU 或系列名（如 AQUAWIDE3），保存后生效。
        </div>
      )}

      <div className="rounded-xl border border-border bg-card-bg p-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">试查：</span>
          <input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="输入报价 SKU，如 AQUAWIDE3-BEIGE-LF" className={`${inputCls} max-w-xs`} />
          {probe.trim() && (
            <span className={probeHit ? "text-[#2e7a56]" : "text-[#9a6a2f]"}>
              {probeHit ? `命中「${probeHit.code}」→ ${ratioPartText(probeHit.entry.fabric)} : ${ratioPartText(probeHit.entry.silk)}` : "未命中 → 默认 3:2"}
            </span>
          )}
        </div>
        {canEdit && missingFamilies.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-muted">报价目录里还没配布纱比的斑马帘系列（{missingFamilies.length}）：点一下加一行</div>
            <div className="flex flex-wrap gap-1.5">
              {missingFamilies.map((f) => (
                <button key={f} type="button" onClick={() => { setRows((rs) => [...rs, { codes: f, fabric: "", silk: "", noteZh: "" }]); setDirty(true); }}
                  className="rounded-full border border-border px-2 py-0.5 hover:border-accent hover:text-accent">
                  + {f}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card-bg shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-muted">
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">编码 / 报价 SKU / 系列（逗号分隔）</th>
              <th className="px-2 py-2 font-medium" style={{ width: 90 }}>布</th>
              <th className="px-2 py-2 font-medium" style={{ width: 90 }}>纱</th>
              <th className="px-2 py-2 font-medium">备注</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">加载中…</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className={entries[i] ? "" : "bg-[rgba(166,61,61,0.03)]"}>
                <td className="px-2 py-1 text-muted">{i + 1}</td>
                <td className="px-1 py-1"><input value={r.codes} onChange={(e) => edit(i, { codes: e.target.value })} disabled={!canEdit} className={inputCls} /></td>
                <td className="px-1 py-1"><input value={r.fabric} onChange={(e) => edit(i, { fabric: e.target.value })} placeholder="3 2/16" disabled={!canEdit} className={inputCls} /></td>
                <td className="px-1 py-1"><input value={r.silk} onChange={(e) => edit(i, { silk: e.target.value })} placeholder="2 2/16" disabled={!canEdit} className={inputCls} /></td>
                <td className="px-1 py-1"><input value={r.noteZh} onChange={(e) => edit(i, { noteZh: e.target.value })} disabled={!canEdit} className={inputCls} /></td>
                <td className="px-1 py-1">
                  <button type="button" title="删除此行" disabled={!canEdit} className="text-muted hover:text-danger disabled:opacity-30" onClick={() => { setRows((rs) => rs.filter((_, k) => k !== i)); setDirty(true); }}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && <button type="button" onClick={() => { setRows((rs) => [...rs, { codes: "", fabric: "", silk: "", noteZh: "" }]); setDirty(true); }}
          className="flex w-full items-center justify-center gap-1 border-t border-border py-2 text-xs text-accent hover:bg-accent-soft">
          <Plus size={13} /> 添加一行
        </button>}
      </div>
      <p className="text-xs text-muted">布 / 纱按原件写法填 16 分（如 3 2/16），也可填小数。匹配：完全相同优先；否则编码作为完整一段出现在 SKU 里即命中（AQUAWIDE3 ↔ AQUAWIDE3-GRAY-LF），多条命中取最长的。</p>
    </div>
  );
}
