/**
 * 共享 SKU 目录：读取 `public/sku-catalog.csv`
 * - 给电子报价单（order-shades / order-drapes）提供 SKU 下拉
 * - 解析为人类可读标签（如 "Aquawide3 · Beige · Light Filtering"）
 * - 提供 skuToPricingFabric 将具体 SKU 映射到 pricing-engine 能识别的面料类别
 */

import type { ProductName } from "./pricing-types";
import { getAvailableFabrics } from "./pricing-data";

export interface SkuEntry {
  sku: string;
  product: ProductName;
  thumbUrl: string;
  /** 可读标签，例如 "Aquawide3 · Beige · Light Filtering" */
  readable: string;
  /** 当 CSV 里没有该 product 的真 SKU 时，退化为 fabric 类别 */
  isCategoryFallback?: boolean;
}

const CSV_URL = "/sku-catalog.csv";

let cache: Record<string, SkuEntry[]> | null = null;
let loadingPromise: Promise<Record<string, SkuEntry[]>> | null = null;

// ─── helpers ───────────────────────────────────────────────

function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SUFFIX_LABEL: Record<string, string> = {
  LF: "Light Filtering",
  BO: "Blackout",
  DO: "Blackout",
  SC: "Light Filtering",
};

/**
 * 把 SKU 拆解为可读标签。
 * 例：AQUAWIDE3-BEIGE-LF       → "Aquawide3 · Beige · Light Filtering"
 *     BLACKLABEL2TONE-ICEWHITE-BO → "Blacklabel2tone · Icewhite · Blackout"
 *     OMEGA3PCT-BLACK           → "Omega3pct · Black"
 */
export function parseSkuReadable(sku: string): string {
  const parts = sku.split("-").filter(Boolean);
  if (!parts.length) return sku;

  const last = parts[parts.length - 1].toUpperCase();
  const suffixLabel = SUFFIX_LABEL[last];
  const core = suffixLabel ? parts.slice(0, -1) : parts;
  const labels = core.map(titleCase);
  if (suffixLabel) labels.push(suffixLabel);
  return labels.join(" · ");
}

function buildFallbackEntries(product: ProductName): SkuEntry[] {
  return getAvailableFabrics(product).map((fabric) => ({
    sku: fabric,
    product,
    thumbUrl: "",
    readable: `${product} · ${fabric}`,
    isCategoryFallback: true,
  }));
}

function parseCsv(text: string): Record<string, SkuEntry[]> {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return {};

  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const idxProduct = header.indexOf("product");
  const idxSku = (() => {
    const a = header.indexOf("fabricname");
    return a >= 0 ? a : header.indexOf("sku");
  })();
  const idxThumb = (() => {
    for (const k of ["thumburl", "thumb_url", "imageurl"]) {
      const i = header.indexOf(k);
      if (i >= 0) return i;
    }
    return -1;
  })();

  const out: Record<string, SkuEntry[]> = {};
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",");
    const product = (row[idxProduct] ?? "").trim();
    const sku = idxSku >= 0 ? (row[idxSku] ?? "").trim() : "";
    const thumbUrl = idxThumb >= 0 ? (row[idxThumb] ?? "").trim() : "";
    if (!product || !sku) continue;
    if (!out[product]) out[product] = [];
    out[product].push({
      sku,
      product: product as ProductName,
      thumbUrl,
      readable: parseSkuReadable(sku),
    });
  }
  // dedup
  for (const p of Object.keys(out)) {
    const seen = new Set<string>();
    out[p] = out[p].filter((e) => (seen.has(e.sku) ? false : (seen.add(e.sku), true)));
  }
  return out;
}

async function loadCsv(): Promise<Record<string, SkuEntry[]>> {
  try {
    const res = await fetch(CSV_URL, { cache: "force-cache" });
    if (!res.ok) return {};
    const text = await res.text();
    return parseCsv(text);
  } catch {
    return {};
  }
}

// ─── public API ────────────────────────────────────────────

export async function ensureSkuCatalogLoaded(): Promise<Record<string, SkuEntry[]>> {
  if (cache) return cache;
  if (!loadingPromise) {
    loadingPromise = loadCsv().then((r) => {
      cache = r;
      return r;
    });
  }
  return loadingPromise;
}

export function getSkusByProduct(product: ProductName): SkuEntry[] {
  const list = cache?.[product];
  if (list && list.length) return list;
  return buildFallbackEntries(product);
}

export function findSku(sku: string): SkuEntry | null {
  if (!cache) return null;
  for (const list of Object.values(cache)) {
    const hit = list.find((e) => e.sku === sku);
    if (hit) return hit;
  }
  return null;
}

export function productOfSku(sku: string): ProductName | null {
  return findSku(sku)?.product ?? null;
}

/**
 * 把具体 SKU 映射到 pricing-engine 能识别的 fabric 类别。
 * pricing-engine 的 fabric key 形如 "Light Filtering" / "Blackout" / "Light Filtering (Open Roll)" 等。
 *
 * 策略：
 * 1) 如果 sku 本身就是一个 fallback 类别（即 sku === fabric），直接返回
 * 2) 按后缀：-LF / -SC → 当前 product 下第一条含 "Light Filtering" 的类别
 *            -BO / -DO → 第一条含 "Blackout" 的类别
 * 3) 兜底：返回该 product 的第一个面料类别
 */
export function skuToPricingFabric(sku: string, product: ProductName): string {
  const available = getAvailableFabrics(product);
  if (available.includes(sku)) return sku;

  const upper = sku.toUpperCase();
  const wantBlackout = /-(BO|DO)$/.test(upper);
  const wantLight = /-(LF|SC)$/.test(upper);

  if (wantBlackout) {
    const hit = available.find((f) => /blackout/i.test(f));
    if (hit) return hit;
  }
  if (wantLight) {
    const hit = available.find((f) => /light\s*filtering/i.test(f));
    if (hit) return hit;
  }

  return available[0] ?? sku;
}
