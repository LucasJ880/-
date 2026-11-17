"use client";

/**
 * 导入报价文件 · 核对窗（QUOTE-1b，openspec change quote-import-studio-file，spec sales/quote-file-import）
 *
 * 选文件（只在浏览器里读，先判大小）→ 校验失败显示原因 → 多方案时选一套 → 逐行对照
 * （文件金额 / 青砚金额 / 差额 / 处理方式，待选褶皱率的行给两档选项）→ 两边合计与让利明细 →
 * 阻断 / 提醒两级清单 →「填入表单」。
 *
 * 这个组件只调 @/lib/sales/quote-import 的纯函数并渲染：不发任何请求，文件不离开浏览器；
 * 所有来自文件的文字都按文本渲染。
 */
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, Info, OctagonAlert } from "lucide-react";
import type { CordlessPolicy, ProductName } from "@/lib/blinds/pricing-types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_FILE_BYTES, type ImportHint, type ParsedQuoteFile } from "@/lib/sales/quote-import/types";
import { parseQuoteFile, planDisplayName } from "@/lib/sales/quote-import/validate";
import {
  applyFullnessChoices,
  buildFormFill,
  buildImportSource,
  mapQuoteToForm,
  matchCustomer,
  type CustomerCandidate,
  type FullnessChoice,
  type ImportFormFill,
} from "@/lib/sales/quote-import/map";
import { compareWithQingyan, type CompareRow, type SideTotals } from "@/lib/sales/quote-import/compare";

export interface ImportReviewSettings {
  orgDiscounts: Partial<Record<ProductName, number>> | undefined;
  cordlessPolicy: CordlessPolicy;
  sunnyMotorPrice: number;
  minInstallFee: number;
  deliveryFee: number;
  addonPrices?: Record<string, number>;
  /** 表单当前税率（文件没有可用税率时沿用） */
  taxRate: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 页面已加载的企业设置（与服务端计价同源） */
  settings: ImportReviewSettings;
  /** 页面已加载的客户（最多 200 位），用于按电话 / 邮箱匹配 */
  customers: readonly CustomerCandidate[];
  /** SKU 是否在青砚目录里（页面已加载的目录） */
  isSkuInCatalog: (product: ProductName, sku: string) => boolean;
  onFill: (fill: ImportFormFill, info: { matchedCustomer: boolean; rowCount: number }) => void;
}

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const signed = (n: number | null | undefined) => (typeof n !== "number" ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}`);

function newLineId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const HANDLING_TONE: Record<CompareRow["handling"], string> = {
  match: "text-emerald-700",
  keep_discount: "text-sky-700",
  promotion: "text-amber-700",
  warn_higher: "text-amber-700",
  pending_fullness: "text-violet-700",
  block: "text-red-700",
  no_file_amount: "text-muted-foreground",
};

export function ImportReviewDialog({ open, onOpenChange, settings, customers, isSkuInCatalog, onFill }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<ParsedQuoteFile | null>(null);
  const [planIndex, setPlanIndex] = useState<number | null>(null);
  const [choices, setChoices] = useState<Record<number, FullnessChoice | undefined>>({});

  const reset = () => {
    setFileName("");
    setReading(false);
    setError(null);
    setFile(null);
    setPlanIndex(null);
    setChoices({});
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handlePick = async (picked: File | undefined) => {
    if (!picked) return;
    reset();
    setFileName(picked.name);
    // 先判大小，超限的文件不读
    if (picked.size > MAX_FILE_BYTES) {
      setError("文件超过 35 MB，无法导入");
      return;
    }
    setReading(true);
    try {
      const text = await picked.text();
      const result = parseQuoteFile(text, picked.size);
      if (!result.ok) {
        setError(result.reasonZh);
        return;
      }
      setFile(result.file);
      // 只有一套方案时直接进核对窗
      setPlanIndex(result.file.plans.length === 1 ? 0 : null);
    } catch {
      setError("读取文件失败，请重新选择");
    } finally {
      setReading(false);
    }
  };

  const plan = file && planIndex !== null ? file.plans[planIndex] : null;
  const multi = !!file && file.plans.length > 1;

  const mapped = useMemo(() => {
    if (!file || !plan) return null;
    return mapQuoteToForm(file, plan, {
      orgDiscounts: settings.orgDiscounts,
      cordlessDiscount: settings.cordlessPolicy.discount,
      deliveryFee: settings.deliveryFee,
      isSkuInCatalog,
      newId: newLineId,
    });
  }, [file, plan, settings.orgDiscounts, settings.cordlessPolicy.discount, settings.deliveryFee, isSkuInCatalog]);

  const result = useMemo(() => {
    if (!file || !plan || !mapped) return null;
    return compareWithQingyan(
      file,
      plan,
      mapped,
      {
        orgDiscounts: settings.orgDiscounts,
        cordlessPolicy: settings.cordlessPolicy,
        sunnyMotorPrice: settings.sunnyMotorPrice,
        minInstallFee: settings.minInstallFee,
        deliveryFee: settings.deliveryFee,
        addonPrices: settings.addonPrices,
        fallbackTaxRate: settings.taxRate,
      },
      choices,
    );
  }, [file, plan, mapped, settings, choices]);

  const handleFill = () => {
    if (!file || !plan || !mapped || !result || !result.canFill) return;
    const applied = applyFullnessChoices(mapped, choices);
    const importSource = buildImportSource(file, plan, {
      importedAt: new Date().toISOString(),
      fileGrandTotal: result.fileTotals ? result.fileTotals.grand : null,
      pricelistMatch: result.pricelistMatch,
    });
    const customerId = matchCustomer(file.customer, customers);
    const fill = buildFormFill(applied, { customerId, specialPromotion: result.promotion.total, importSource });
    onFill(fill, {
      matchedCustomer: customerId !== null,
      rowCount: fill.shadeOrders.length + fill.shutterOrders.length + fill.drapeOrders.length,
    });
    reset();
  };

  const blocks = result ? result.hints.filter((h) => h.level === "block") : [];
  const warns = result ? result.hints.filter((h) => h.level === "warn") : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-5xl" data-testid="import-review-dialog">
        <DialogHeader>
          <DialogTitle>导入报价文件</DialogTitle>
          <DialogDescription>
            选择报价工具导出的 .json 文件。文件只在这台设备的浏览器里读取，不会上传；金额以青砚的计算为准，文件比青砚便宜的部分计入特别让利。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── 选文件 ── */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="import-file-input"
              onChange={(e) => void handlePick(e.target.files?.[0])}
            />
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={reading}>
              <FileUp className="mr-1.5 h-4 w-4" />
              {file || error ? "换一个文件" : "选择文件"}
            </Button>
            {fileName && <span className="break-all text-xs text-muted-foreground" data-testid="import-file-name">{fileName}</span>}
            {reading && <span className="text-xs text-muted-foreground">正在读取…</span>}
          </div>

          {/* ── 校验不通过 ── */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="import-error">
              <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── 多方案：先选一套 ── */}
          {file && multi && (
            <div className="rounded-lg border border-border p-3" data-testid="import-plan-picker">
              <p className="text-sm font-medium text-foreground">这份文件有 {file.plans.length} 套方案，一次只导入一套（每套对应一张报价）：</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {file.plans.map((p, i) => (
                  <button
                    key={`${p.planId}-${i}`}
                    type="button"
                    data-testid={`import-plan-option-${p.planId || i}`}
                    onClick={() => { setPlanIndex(i); setChoices({}); }}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      planIndex === i ? "border-teal-600 bg-teal-50 text-teal-900" : "border-border hover:bg-muted/60",
                    )}
                  >
                    <span className="block font-medium">{planDisplayName(p, true)}</span>
                    <span className="block text-xs text-muted-foreground">{p.items.length} 行产品 · {p.addons.length} 个附加项目</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── 核对 ── */}
          {file && plan && mapped && result && (
            <>
              <div className="text-xs text-muted-foreground" data-testid="import-summary">
                工具报价号 {file.quoteNumber || "（无）"}
                {multi ? ` · ${planDisplayName(plan, true)}` : ""} · 文件 {plan.items.length} 行 → 表单{" "}
                {mapped.shadeOrders.length + mapped.shutterOrders.length + mapped.drapeOrders.length} 行（Shades {mapped.shadeOrders.length} / Shutters{" "}
                {mapped.shutterOrders.length} / Drapes {mapped.drapeOrders.length}）· 客户 {file.customer.name || "（未填）"}
              </div>

              {blocks.length > 0 && <HintList tone="block" title={`阻断（${blocks.length} 项，解决前不能填入表单）`} hints={blocks} />}

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[720px] text-xs" data-testid="import-rows">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 font-medium">#</th>
                      <th className="px-2 py-2 font-medium">位置 / 产品</th>
                      <th className="px-2 py-2 text-right font-medium">文件金额</th>
                      <th className="px-2 py-2 text-right font-medium">青砚金额</th>
                      <th className="px-2 py-2 text-right font-medium">差额</th>
                      <th className="px-2 py-2 font-medium">处理方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.rowIndex} className="border-t border-border align-top" data-testid={`import-row-${row.rowIndex}`} data-handling={row.handling}>
                        <td className="px-2 py-2 text-muted-foreground">{row.rowIndex}</td>
                        <td className="px-2 py-2">
                          <span className="font-medium text-foreground">{row.room || "（未填位置）"}</span>
                          <span className="block text-muted-foreground">
                            {row.product} · {row.fabric} · {row.sizeLabel}
                            {row.qty > 1 ? ` · ×${row.qty}` : ""}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(row.fileAmount)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(row.qingyanAmount)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{signed(row.diff)}</td>
                        <td className={cn("px-2 py-2", HANDLING_TONE[row.handling])}>
                          <span data-testid={`import-handling-${row.rowIndex}`}>{row.handlingZh}</span>
                          {row.fullnessOptions && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {(["180", "230"] as const).map((tier) => {
                                const opt = row.fullnessOptions![tier];
                                const selected = choices[row.rowIndex] === tier;
                                return (
                                  <button
                                    key={tier}
                                    type="button"
                                    disabled={opt.qingyanAmount === null}
                                    data-testid={`import-fullness-${row.rowIndex}-${tier}`}
                                    aria-pressed={selected}
                                    onClick={() => setChoices((prev) => ({ ...prev, [row.rowIndex]: tier }))}
                                    className={cn(
                                      "min-h-0 rounded-md border px-2 py-1 text-left text-[11px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                                      selected ? "border-violet-600 bg-violet-50 text-violet-900" : "border-border text-foreground hover:bg-muted/60",
                                    )}
                                  >
                                    <span className="block font-medium">褶皱率 {tier}</span>
                                    <span className="block tabular-nums">
                                      {opt.qingyanAmount === null ? opt.errorZh : `青砚 ${fmt(opt.qingyanAmount)}${opt.diff !== null ? `（比文件 ${signed(opt.diff)}）` : ""}`}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <TotalsTable fileTotals={result.fileTotals} qingyanTotals={result.qingyanTotals} pricelistMatch={result.pricelistMatch} pending={result.pendingFullnessRows.length} />

              <div className="rounded-lg border border-border px-3 py-2 text-xs" data-testid="import-promotion">
                <span className="font-medium text-foreground">本次计入特别让利：</span>
                <span className="font-semibold tabular-nums text-foreground" data-testid="import-promotion-total">{fmt(result.promotion.total)}</span>
                <span className="ml-2 text-muted-foreground">
                  （行差 {fmt(result.promotion.rows)} · 负数附加项目 {fmt(result.promotion.addons)} · 运费差 {fmt(result.promotion.delivery)}）
                </span>
                <span className="mt-1 block text-muted-foreground">填入后让利占比、三档判定与审批完全按现有规则走，导入不设单独的规则。</span>
              </div>

              {warns.length > 0 && <HintList tone="warn" title={`提醒（${warns.length} 项，可继续）`} hints={warns} />}

              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  「填入表单」会替换详细订单里现有的 Shades / Shutters / Drapes 行、Part B、备注、安装方式、税率与特别让利，并带入客户名、电话、邮箱、地址；
                  电话或邮箱在已加载的客户里恰好对上一位时自动选中，否则请手动选择或新建客户。
                </span>
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={handleFill} disabled={!result || !result.canFill} data-testid="import-fill">
            {result && result.pendingFullnessRows.length > 0
              ? `还有 ${result.pendingFullnessRows.length} 行待选褶皱率`
              : blocks.length > 0
                ? "有阻断项，不能填入"
                : "填入表单"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HintList({ tone, title, hints }: { tone: "block" | "warn"; title: string; hints: ImportHint[] }) {
  const isBlock = tone === "block";
  return (
    <div
      className={cn("rounded-lg border px-3 py-2 text-xs", isBlock ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50/70 text-amber-900")}
      data-testid={isBlock ? "import-blocks" : "import-warns"}
    >
      <p className="flex items-center gap-1.5 font-medium">
        {isBlock ? <OctagonAlert className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        {title}
      </p>
      <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5">
        {hints.map((h, i) => (
          <li key={`${h.code}-${h.rowIndex ?? "all"}-${i}`} data-code={h.code}>
            {h.messageZh}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TotalsTable({
  fileTotals,
  qingyanTotals,
  pricelistMatch,
  pending,
}: {
  fileTotals: SideTotals | null;
  qingyanTotals: SideTotals | null;
  pricelistMatch: boolean;
  pending: number;
}) {
  const lines: Array<[string, keyof SideTotals, boolean]> = [
    ["产品小计", "products", false],
    ["附加项目（文件一侧含 Downtown）", "addons", false],
    ["安装", "install", false],
    ["送货", "delivery", false],
    ["特别让利", "promotion", false],
    ["税前", "preTax", false],
    ["税", "tax", false],
    ["合计", "grand", true],
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs" data-testid="import-totals">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-2 py-2 font-medium">合计对照</th>
            <th className="px-2 py-2 text-right font-medium">文件</th>
            <th className="px-2 py-2 text-right font-medium">青砚</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(([label, key, strong]) => (
            <tr key={key} className={cn("border-t border-border", strong && "font-semibold")}>
              <td className="px-2 py-1.5">{label}</td>
              <td className="px-2 py-1.5 text-right tabular-nums" data-testid={`import-file-${key}`}>
                {fileTotals ? (key === "promotion" ? "—" : fmt(fileTotals[key])) : "—"}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums" data-testid={`import-qingyan-${key}`}>
                {qingyanTotals ? (key === "promotion" ? `−${fmt(qingyanTotals.promotion)}` : fmt(qingyanTotals[key])) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(!pricelistMatch || pending > 0 || !fileTotals) && (
        <p className="border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
          {!pricelistMatch
            ? "该文件的价表与公司现行价表不同，文件一侧不显示金额。"
            : !fileTotals
              ? "有行被阻断，文件一侧的合计不显示。"
              : ""}
          {pending > 0 ? " 还有行未选褶皱率，青砚一侧的合计选完后显示。" : ""}
        </p>
      )}
    </div>
  );
}
