/**
 * 国内下单表（外购帘：斑马帘 / 卷帘 / 香格里拉帘 / 蜂窝帘 / 梦幻帘 …）
 *
 * 口径 = 原件《Blinds 国内下单表（斑马帘 卷帘 香格里拉帘 蜂窝帘 梦幻帘）1》：
 *   工艺单 E/F = 英寸 × 2.54（不取整），P = E×F/10000（平方米）
 *   LABEL PRINT：每个宽高均为正数的行一张标签，4 行；尺寸为英寸原值，不扣减
 * 与原件逐值对照：src/lib/sunny-process/__tests__/domestic-oracle.test.ts
 */

import { sixteenthsText } from "./excel-fns";

export const DOMESTIC_PRODUCTS = ["卷帘", "斑马帘", "香格里拉", "蜂窝帘", "梦幻帘", "罗马帘"] as const;
export const DOMESTIC_MEASURES = ["内装", "外装"] as const;
export const DOMESTIC_CONTROLS = ["普通", "电机", "无绳"] as const;
export const DOMESTIC_SIDES = ["左", "右", "无"] as const;
export const DOMESTIC_MOUNTS = ["墙装", "顶装"] as const;

export interface DomesticRowInput {
  /** 单号数字部分 / 每樘编号（如 Ly26-12），标签第二行 */
  code: string;
  widthIn: number;
  heightIn: number;
  productType: string;
  sku: string;
  measure: string;
  control: string;
  side: string;
  headrail: string;
  mount: string;
  remark: string;
}

export interface DomesticRowResult {
  widthCm: number;
  heightCm: number;
  sqm: number;
}

export function computeDomesticRow(r: Pick<DomesticRowInput, "widthIn" | "heightIn">): DomesticRowResult {
  const widthCm = (r.widthIn || 0) * 2.54;
  const heightCm = (r.heightIn || 0) * 2.54;
  return { widthCm, heightCm, sqm: (widthCm * heightCm) / 10000 };
}

/** 标签（每张 4 行）。行号 = 原表序号（1 起），无订单号/编号/货号/操控侧时用原件的占位文本 */
export function buildDomesticLabels(orderNo: string, rows: DomesticRowInput[]): string[][] {
  const labels: string[][] = [];
  rows.forEach((r, idx) => {
    if (!(r.widthIn > 0) || !(r.heightIn > 0)) return;
    labels.push([
      `#${idx + 1}  ${orderNo ? orderNo : "【缺订单号】"}`,
      r.code ? r.code : "【缺编号】",
      `${r.sku ? r.sku : "【缺货号】"}  ${r.side ? r.side : "【缺操控侧】"}`,
      `${sixteenthsText(r.widthIn)} W × ${sixteenthsText(r.heightIn)} H (in)`,
    ]);
  });
  return labels;
}
