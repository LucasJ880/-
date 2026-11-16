/**
 * quote-import 测试共用的夹具与小工具（不是测试文件，不注册）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CORDLESS_POLICY } from "@/lib/blinds/pricing-data";
import { parseQuoteFile } from "@/lib/sales/quote-import/validate";
import { mapQuoteToForm, type FullnessChoice, type MapContext } from "@/lib/sales/quote-import/map";
import { compareWithQingyan, type CompareSettings } from "@/lib/sales/quote-import/compare";
import type { ParsedQuoteFile } from "@/lib/sales/quote-import/types";

const FIX = join(process.cwd(), "src/lib/sales/quote-import/__tests__/fixtures");
export const fixtureText = (name: string) => readFileSync(join(FIX, name), "utf8");
export const SAMPLE = fixtureText("sample-16.sunny-quote.json");
export const SINGLE = fixtureText("toolcode-single-with-photos.sunny-quote.json");
export const MULTI = fixtureText("toolcode-multiplan-A-B-active-B.sunny-quote.json");

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 在样例（或别的夹具）上改一处再序列化 */
export function edit(mutate: (root: any) => void, base = SAMPLE): string {
  const root = JSON.parse(base);
  mutate(root);
  return JSON.stringify(root);
}

/** 样例的第 n 行（从 1 起）作为模板，改几个字段，得到只有这些行的文件 */
export function onlyRows(rows: Array<{ from: number } & Record<string, unknown>>, more?: (root: any) => void): string {
  return edit((root) => {
    const src = root.quote.items;
    root.quote.items = rows.map(({ from, ...over }, i) => ({ ...src[from - 1], id: `t${i}`, ...over }));
    if (more) more(root);
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function parsed(text: string): ParsedQuoteFile {
  const r = parseQuoteFile(text, Buffer.byteLength(text));
  if (!r.ok) throw new Error(`应当通过却被拒绝：${r.reasonZh}`);
  return r.file;
}

export function ctx(over: Partial<MapContext> = {}): MapContext {
  let n = 0;
  return { orgDiscounts: undefined, cordlessDiscount: 0.3, deliveryFee: 50, newId: () => `L${++n}`, ...over };
}

export function settings(over: Partial<CompareSettings> = {}): CompareSettings {
  return {
    orgDiscounts: undefined,
    cordlessPolicy: DEFAULT_CORDLESS_POLICY,
    sunnyMotorPrice: 150,
    minInstallFee: 200,
    deliveryFee: 50,
    fallbackTaxRate: 0.13,
    ...over,
  };
}

/** 校验 → 取方案 → 映射 → 对照，一步到位 */
export function run(
  text: string,
  opts: { plan?: string; ctx?: Partial<MapContext>; settings?: Partial<CompareSettings>; choices?: Record<number, FullnessChoice> } = {},
) {
  const file = parsed(text);
  const plan = opts.plan === undefined ? file.plans[0] : file.plans.find((p) => p.planId === opts.plan)!;
  const deliveryFee = opts.settings?.deliveryFee ?? opts.ctx?.deliveryFee ?? 50;
  const mapped = mapQuoteToForm(file, plan, ctx({ deliveryFee, orgDiscounts: opts.settings?.orgDiscounts, ...opts.ctx }));
  const result = compareWithQingyan(file, plan, mapped, settings({ deliveryFee, ...opts.settings }), opts.choices ?? {});
  return { file, plan, mapped, result };
}

export function makeChecker() {
  let pass = 0, fail = 0;
  const ok = (c: boolean, n: string, d?: unknown) => {
    if (c) { pass++; console.log(`  ✓ ${n}`); }
    else { fail++; console.error(`  ✗ ${n}`, d === undefined ? "" : JSON.stringify(d)?.slice(0, 700)); }
  };
  const done = () => { console.log(`\n结果：${pass} 通过，${fail} 失败`); if (fail > 0) process.exit(1); };
  return { ok, done };
}
