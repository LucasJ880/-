"use client";

import { useEffect, useState } from "react";
import { Percent, Check, Loader2, ShieldCheck, RefreshCcw } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { cn } from "@/lib/utils";

/**
 * 折扣率全局设置卡片 — 驾驶舱
 *
 * - admin/super_admin 可编辑所有产品的默认百分比折扣
 * - 其他销售只读
 * - Order Form / AI 报价工具统一从此数据源读取
 */

interface DiscountsDto {
  zebra: number;
  shangrila: number;
  cellular: number;
  roller: number;
  drapery: number;
  sheer: number;
  shutters: number;
  honeycomb: number;
  promoWarnPct: number;
  promoDangerPct: number;
  promoMaxPct: number;
  updatedAt: string;
  updatedBy: string | null;
}

const FIELDS: { key: keyof DiscountsDto; label: string }[] = [
  { key: "zebra", label: "Zebra" },
  { key: "shangrila", label: "SHANGRILA" },
  { key: "cellular", label: "Cordless Cellular" },
  { key: "roller", label: "Roller" },
  { key: "drapery", label: "Drapery" },
  { key: "sheer", label: "Sheer" },
  { key: "shutters", label: "Shutters" },
  { key: "honeycomb", label: "Skylight Honeycomb" },
];

const THRESHOLD_FIELDS: { key: "promoWarnPct" | "promoDangerPct" | "promoMaxPct"; label: string; hint: string }[] = [
  { key: "promoWarnPct", label: "黄色预警阈值", hint: "达到此比例开始温和提醒" },
  { key: "promoDangerPct", label: "红色强警告阈值", hint: "达到此比例建议经理审核" },
  { key: "promoMaxPct", label: "销售最高让利上限", hint: "销售不得超过；admin 不受限" },
];

type DraftKey =
  | keyof Omit<DiscountsDto, "updatedAt" | "updatedBy">;
type DraftMap = Record<DraftKey, string>;

function toDraftMap(d: DiscountsDto): DraftMap {
  return {
    zebra: Math.round(d.zebra * 100).toString(),
    shangrila: Math.round(d.shangrila * 100).toString(),
    cellular: Math.round(d.cellular * 100).toString(),
    roller: Math.round(d.roller * 100).toString(),
    drapery: Math.round(d.drapery * 100).toString(),
    sheer: Math.round(d.sheer * 100).toString(),
    shutters: Math.round(d.shutters * 100).toString(),
    honeycomb: Math.round(d.honeycomb * 100).toString(),
    promoWarnPct: Math.round(d.promoWarnPct * 100).toString(),
    promoDangerPct: Math.round(d.promoDangerPct * 100).toString(),
    promoMaxPct: Math.round(d.promoMaxPct * 100).toString(),
  };
}

export function DiscountSettingsCard() {
  const { user } = useCurrentUser();
  const canEdit = user?.role === "admin" || user?.role === "super_admin";

  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState<DiscountsDto | null>(null);
  const [draft, setDraft] = useState<DraftMap | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<"saved" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    apiJson<DiscountsDto>("/api/sales/quote-settings/discounts")
      .then((d) => {
        setCurrent(d);
        setDraft(toDraftMap(d));
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => setLoaded(true));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    if (!draft) return;
    setError(null);

    const payload: Record<string, number> = {};
    const allFields: { key: DraftKey; label: string }[] = [
      ...FIELDS.map((f) => ({ key: f.key as DraftKey, label: f.label })),
      ...THRESHOLD_FIELDS.map((f) => ({ key: f.key as DraftKey, label: f.label })),
    ];
    for (const f of allFields) {
      const n = Number(draft[f.key]);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setError(`${f.label} 必须是 0~100 之间的数字`);
        return;
      }
      payload[f.key as string] = Math.round(n) / 100;
    }
    // 顺序校验：warn <= danger <= max
    const w = payload.promoWarnPct;
    const d2 = payload.promoDangerPct;
    const m = payload.promoMaxPct;
    if (w !== undefined && d2 !== undefined && w > d2) {
      setError("黄色预警阈值不能大于红色强警告阈值");
      return;
    }
    if (d2 !== undefined && m !== undefined && d2 > m) {
      setError("红色强警告阈值不能大于最高让利上限");
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch("/api/sales/quote-settings/discounts", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存失败");
        return;
      }
      setCurrent(data);
      setDraft(toDraftMap(data));
      setEditing(false);
      setFlash("saved");
      setTimeout(() => setFlash(null), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (current) setDraft(toDraftMap(current));
    setEditing(false);
    setError(null);
  };

  if (!loaded) {
    return (
      <div className="rounded-xl border border-border bg-white/60 p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={14} />
        加载折扣率设置…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-white/60 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Percent size={16} className="text-orange-600" />
          <h3 className="text-sm font-semibold">全局折扣率</h3>
          {canEdit ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">
              <ShieldCheck size={10} />
              可编辑
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">
              只读
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {flash === "saved" && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <Check size={12} /> 已保存
            </span>
          )}
          <button
            onClick={load}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="刷新"
          >
            <RefreshCcw size={12} />
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Order Form 和 AI 报价工具都使用这套折扣率作为默认值。
        {canEdit
          ? "修改后立即对全公司生效，每次变更都会记录审计日志。"
          : "如需调整请联系管理员。"}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground block">
              {f.label}
            </label>
            {editing && draft && canEdit ? (
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={draft[f.key as keyof DraftMap]}
                  onChange={(e) =>
                    setDraft({ ...draft, [f.key as keyof DraftMap]: e.target.value })
                  }
                  className="w-full rounded-lg border border-input bg-white px-2 py-1.5 pr-7 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-slate-50 px-2 py-1.5 text-sm font-semibold text-slate-700">
                {current ? `${Math.round(current[f.key] as number * 100)}%` : "—"}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Special Promotion 阈值区 */}
      <div className="mt-5 pt-4 border-t border-border">
        <h4 className="text-xs font-semibold text-foreground mb-1">Special Promotion 阈值</h4>
        <p className="text-[11px] text-muted-foreground mb-3">
          控制销售在电子报价单中手填 Special Promotion 时的预警与上限。
          销售超过「最高让利上限」将无法提交，需要 admin 账号登录签发。
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {THRESHOLD_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                {f.label}
              </label>
              {editing && draft && canEdit ? (
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={draft[f.key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [f.key]: e.target.value })
                    }
                    className="w-full rounded-lg border border-input bg-white px-2 py-1.5 pr-7 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-slate-50 px-2 py-1.5 text-sm font-semibold text-slate-700">
                  {current ? `${Math.round((current[f.key] as number) * 100)}%` : "—"}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">{f.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      )}

      {canEdit && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {current?.updatedAt &&
              `上次更新：${new Date(current.updatedAt).toLocaleString("zh-CN")}`}
          </p>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-slate-50 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50",
                  )}
                >
                  {saving ? <Loader2 className="animate-spin" size={12} /> : <Check size={12} />}
                  保存修改
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100"
              >
                编辑折扣率
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
