"use client";

import { useEffect, useState } from "react";
import { Percent, Check, Loader2, ShieldCheck, RefreshCcw } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

/**
 * 折扣率全局设置卡片 — 驾驶舱
 *
 * - 企业负责人可编辑所有产品的默认百分比折扣
 * - 其他销售只读
 * - 电子报价单统一从此数据源读取
 */

interface DiscountsDto {
  canEdit: boolean;
  zebra: number;
  shangrila: number;
  cellular: number;
  roller: number;
  drapery: number;
  sheer: number;
  shutters: number;
  honeycomb: number;
  sunnyMotorPrice: number;
  minInstallFee: number;
  deliveryFee: number;
  commissionMarginRate: number;
  commissionRate: number;
  promoWarnPct: number;
  promoDangerPct: number;
  promoMaxPct: number;
  depositWarnPct: number;
  depositMinPct: number;
  hasDepositOverrideCode: boolean;
  hasLineDiscountUnlockCode?: boolean;
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

const DEPOSIT_FIELDS: { key: "depositWarnPct" | "depositMinPct"; label: string; hint: string }[] = [
  { key: "depositWarnPct", label: "定金黄色提醒阈值", hint: "低于此比例黄色提醒（默认 40%）" },
  { key: "depositMinPct", label: "定金最低阈值", hint: "低于此比例销售需输入解锁码；可设为 0 表示不限制" },
];

const PRICE_FIELDS = [
  {
    key: "sunnyMotorPrice" as const,
    label: "Sunny Motor",
    hint: "Shade Order Form 的 Lift 选择 M 时，每行自动加入此税前价格",
  },
  {
    key: "minInstallFee" as const,
    label: "最低安装费 Minimum Installation",
    hint: "Installation 模式下，行内安装费合计不足此金额时自动补足",
  },
  {
    key: "deliveryFee" as const,
    label: "运费 Delivery",
    hint: "Installation 模式下每单加收；Pickup 自提不收",
  },
];

type PriceDraftKey = (typeof PRICE_FIELDS)[number]["key"];

const COMMISSION_FIELDS: { key: "commissionMarginRate" | "commissionRate"; label: string; hint: string }[] = [
  {
    key: "commissionMarginRate",
    label: "毛利率估算系数",
    hint: "按公司混合毛利水平填写；0 = 未配置，销售业绩页不显示提成卡",
  },
  {
    key: "commissionRate",
    label: "提成比例",
    hint: "提成 = 估算毛利 × 该比例（默认 30%）",
  },
];

type NumericDraftKey =
  | "zebra" | "shangrila" | "cellular" | "roller"
  | "drapery" | "sheer" | "shutters" | "honeycomb"
  | "promoWarnPct" | "promoDangerPct" | "promoMaxPct"
  | "depositWarnPct" | "depositMinPct"
  | "commissionMarginRate" | "commissionRate";

interface DraftMap {
  zebra: string;
  shangrila: string;
  cellular: string;
  roller: string;
  drapery: string;
  sheer: string;
  shutters: string;
  honeycomb: string;
  promoWarnPct: string;
  promoDangerPct: string;
  promoMaxPct: string;
  depositWarnPct: string;
  depositMinPct: string;
  commissionMarginRate: string;
  commissionRate: string;
  sunnyMotorPrice: string;
  minInstallFee: string;
  deliveryFee: string;
  // 解锁码：空串表示"清空"；undefined 表示"不改动"（保存时不发送）；永不回显服务端值
  depositOverrideCode?: string;
  lineDiscountUnlockCode?: string;
}

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
    depositWarnPct: Math.round(d.depositWarnPct * 100).toString(),
    depositMinPct: Math.round(d.depositMinPct * 100).toString(),
    commissionMarginRate: Math.round(d.commissionMarginRate * 100).toString(),
    commissionRate: Math.round(d.commissionRate * 100).toString(),
    sunnyMotorPrice: Number(d.sunnyMotorPrice).toFixed(
      Number.isInteger(d.sunnyMotorPrice) ? 0 : 2,
    ),
    minInstallFee: Number(d.minInstallFee).toFixed(
      Number.isInteger(d.minInstallFee) ? 0 : 2,
    ),
    deliveryFee: Number(d.deliveryFee).toFixed(
      Number.isInteger(d.deliveryFee) ? 0 : 2,
    ),
    depositOverrideCode: undefined,
    lineDiscountUnlockCode: undefined,
  };
}

export function DiscountSettingsCard() {
  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState<DiscountsDto | null>(null);
  const [draft, setDraft] = useState<DraftMap | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<"saved" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = current?.canEdit === true;

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

    const payload: Record<string, number | string | null> = {};
    const allFields: { key: NumericDraftKey; label: string }[] = [
      ...FIELDS.map((f) => ({ key: f.key as NumericDraftKey, label: f.label })),
      ...THRESHOLD_FIELDS.map((f) => ({ key: f.key as NumericDraftKey, label: f.label })),
      ...DEPOSIT_FIELDS.map((f) => ({ key: f.key as NumericDraftKey, label: f.label })),
      ...COMMISSION_FIELDS.map((f) => ({ key: f.key as NumericDraftKey, label: f.label })),
    ];
    for (const f of allFields) {
      const n = Number(draft[f.key]);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setError(`${f.label} 必须是 0~100 之间的数字`);
        return;
      }
      payload[f.key as string] = Math.round(n) / 100;
    }
    for (const field of PRICE_FIELDS) {
      const amount = Number(draft[field.key]);
      if (!Number.isFinite(amount) || amount < 0 || amount > 10000) {
        setError(`${field.label} 必须是 0~10000 之间的 CAD 金额`);
        return;
      }
      payload[field.key] = Math.round(amount * 100) / 100;
    }
    // 顺序校验：warn <= danger <= max
    const w = payload.promoWarnPct as number | undefined;
    const d2 = payload.promoDangerPct as number | undefined;
    const m = payload.promoMaxPct as number | undefined;
    if (w !== undefined && d2 !== undefined && w > d2) {
      setError("黄色预警阈值不能大于红色强警告阈值");
      return;
    }
    if (d2 !== undefined && m !== undefined && d2 > m) {
      setError("红色强警告阈值不能大于最高让利上限");
      return;
    }
    const dw = payload.depositWarnPct as number | undefined;
    const dmLocal = payload.depositMinPct as number | undefined;
    if (dw !== undefined && dmLocal !== undefined && dw < dmLocal) {
      setError("定金黄色提醒阈值不能低于定金最低阈值");
      return;
    }
    // 解锁码明文仅用于本次提交，服务端存哈希；undefined = 不改动
    if (draft.depositOverrideCode !== undefined) {
      const raw = draft.depositOverrideCode;
      if (raw === "") {
        payload.depositOverrideCode = null;
      } else if (raw.length < 3 || raw.length > 64) {
        setError("定金解锁码长度需为 3~64 个字符（留空表示清除）");
        return;
      } else {
        payload.depositOverrideCode = raw;
      }
    }
    if (draft.lineDiscountUnlockCode !== undefined) {
      const raw = draft.lineDiscountUnlockCode;
      if (raw === "") {
        payload.lineDiscountUnlockCode = null;
      } else if (raw.length < 3 || raw.length > 64) {
        setError("行折扣解锁码长度需为 3~64 个字符（留空表示清除）");
        return;
      } else {
        payload.lineDiscountUnlockCode = raw;
      }
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
      <div className="rounded-xl border border-border bg-card-bg/60 p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={14} />
        加载折扣率设置…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg/60 p-5">
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
        电子报价单使用这套折扣率作为默认值。
        {canEdit
          ? "修改后立即对全公司生效，每次变更都会记录审计日志。"
          : "如需调整请联系企业负责人。"}
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
                  className="w-full rounded-lg border border-input bg-card-bg px-2 py-1.5 pr-7 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-accent-soft px-2 py-1.5 text-sm font-semibold text-slate-700">
                {current ? `${Math.round(current[f.key] as number * 100)}%` : "—"}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <h4 className="mb-1 text-xs font-semibold text-foreground">报价附加价格</h4>
        <p className="mb-3 text-[11px] text-muted-foreground">
          这些金额不参与产品折扣，作为附加价格自动计入电子报价单与 AI 报价。
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PRICE_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <label className="block text-[11px] font-medium text-muted-foreground">
                {field.label}
              </label>
              {editing && draft && canEdit ? (
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    $
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    step="0.01"
                    value={draft[field.key as PriceDraftKey]}
                    onChange={(event) =>
                      setDraft({ ...draft, [field.key]: event.target.value })
                    }
                    className="w-full rounded-lg border border-input bg-card-bg py-1.5 pl-6 pr-12 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    CAD
                  </span>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-accent-soft px-2 py-1.5 text-sm font-semibold text-slate-700">
                  {current
                    ? new Intl.NumberFormat("en-CA", {
                        style: "currency",
                        currency: "CAD",
                      }).format(current[field.key])
                    : "—"}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">{field.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 提成估算参数 —— 销售业绩页「预计提成」卡的数据源 */}
      <div className="mt-5 pt-4 border-t border-border">
        <h4 className="text-xs font-semibold text-foreground mb-1">提成估算</h4>
        <p className="text-[11px] text-muted-foreground mb-3">
          销售业绩页的「预计提成」卡按 签约额 × 毛利率估算系数 × 提成比例 计算，
          属于估算口径（销售单据暂无真实成本数据）。毛利率设为 0 时该卡对销售隐藏。
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {COMMISSION_FIELDS.map((f) => (
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
                    className="w-full rounded-lg border border-input bg-card-bg px-2 py-1.5 pr-7 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-accent-soft px-2 py-1.5 text-sm font-semibold text-slate-700">
                  {current ? `${Math.round((current[f.key] as number) * 100)}%` : "—"}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">{f.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 定金阈值与解锁码 */}
      <div className="mt-5 pt-4 border-t border-border">
        <h4 className="text-xs font-semibold text-foreground mb-1">定金比例阈值</h4>
        <p className="text-[11px] text-muted-foreground mb-3">
          按 Grand Total（含税总价）的比例控制销售的定金收取。低于「最低阈值」时销售
          需要输入下方的解锁码才能保存报价单。最低阈值可设为 0 表示不限制。
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {DEPOSIT_FIELDS.map((f) => (
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
                    className="w-full rounded-lg border border-input bg-card-bg px-2 py-1.5 pr-7 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-accent-soft px-2 py-1.5 text-sm font-semibold text-slate-700">
                  {current ? `${Math.round((current[f.key] as number) * 100)}%` : "—"}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">{f.hint}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground block">
            定金解锁码
          </label>
          {editing && draft && canEdit ? (
            <>
              <input
                type="text"
                placeholder={
                  current?.hasDepositOverrideCode
                    ? "已配置；留空保存将清除，输入新值以覆盖"
                    : "尚未配置；输入 3~64 个字符"
                }
                value={draft.depositOverrideCode ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, depositOverrideCode: e.target.value })
                }
                className="w-full rounded-lg border border-input bg-card-bg px-2 py-1.5 text-sm font-medium font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className="text-[10px] text-muted-foreground">
                销售低于最低阈值时需凭此码解锁。变更会立即对全公司生效。
              </p>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-accent-soft px-2 py-1.5 text-sm font-semibold text-slate-700">
              {current?.hasDepositOverrideCode ? "已配置（哈希存储，不可回显）" : "未配置"}
            </div>
          )}
        </div>
        <div className="mt-3 space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground block">
            行折扣解锁码
          </label>
          {editing && draft && canEdit ? (
            <>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={
                  current?.hasLineDiscountUnlockCode
                    ? "已配置；留空保存将清除，输入新值以覆盖"
                    : "尚未配置；输入 3~64 个字符"
                }
                value={draft.lineDiscountUnlockCode ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, lineDiscountUnlockCode: e.target.value })
                }
                className="w-full rounded-lg border border-input bg-card-bg px-2 py-1.5 text-sm font-medium font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className="text-[10px] text-muted-foreground">
                报价单行折扣修改时使用。服务端仅存 bcrypt 哈希，永不回显。
              </p>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-accent-soft px-2 py-1.5 text-sm font-semibold text-slate-700">
              {current?.hasLineDiscountUnlockCode ? "已配置（哈希存储，不可回显）" : "未配置"}
            </div>
          )}
        </div>
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
                    className="w-full rounded-lg border border-input bg-card-bg px-2 py-1.5 pr-7 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-accent-soft px-2 py-1.5 text-sm font-semibold text-slate-700">
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
                  className="rounded-lg border border-border bg-card-bg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent-soft disabled:opacity-50"
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
