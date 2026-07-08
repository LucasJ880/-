/**
 * 可视化产品库导入 — 把面料目录（Yuma + Sunny）同步进 VisualizerCatalogProduct
 *
 * 背景：网页版可视化工作台的产品面板读 VisualizerCatalogProduct（需要每个颜色的
 * #RRGGBB 色值用于画面叠加），而 scripts/import-fabric-catalog.ts 导入的 304 个
 * SKU 在 FabricInventory（微信链路用）。本脚本打通两者：
 *   - Sunny 57 款 → 4 个产品（蜂巢遮光/柔光、斑马柔光/遮暗），色值来自 CSV swatch_hex（精确）
 *   - Yuma 264 款 → 按系列分组 ~48 个产品，色值按颜色名映射（近似）
 *   - 颜色名带 SKU 编号（如 "White · SC-A8-301"），与报价/微信同一编号体系
 *
 * 导入为平台预置产品（orgId=null，全组织可见）：用户账号常同时属于多个组织
 * （如 Sunny Shutter 与 Lucas Bid），产品面板按「当前选中组织」过滤组织私有产品，
 * 导入为组织私有会导致换组织后看不到。同名未归档产品已存在时跳过，可重复运行。
 *
 * 用法：
 *   npm run import:visualizer-catalog          # dry-run（默认，只读）
 *   npm run import:visualizer-catalog:write    # 真实写入
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";

const WRITE = process.argv.includes("--write");
const DATA_DIR = join(__dirname, "data");

interface CatalogColor {
  name: string;
  hex: string;
}
interface ProductDraft {
  name: string;
  category: string;
  categoryLabel: string;
  defaultOpacity: number;
  colors: CatalogColor[];
  previewImageUrl: string | null;
  notes: string;
}

// ── 清洗工具（与 import-fabric-catalog.ts 同源，脚本独立保持可单跑） ──

function cleanFabricType(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = s.split(" ");
  const out: string[] = [];
  for (const w of words) {
    out.push(w);
    const half = Math.floor(out.length / 2);
    if (
      out.length % 2 === 0 &&
      out.slice(0, half).join(" ") === out.slice(half).join(" ")
    ) {
      out.length = half;
    }
  }
  return out.filter((w, i) => w !== out[i - 1]).join(" ");
}

function cleanColorName(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/\s*(L\/F|B\/O)\s*$/i, "").replace(/\s+/g, " ").trim();
}

// ── 颜色名 → 近似色值（Yuma 无色值数据，用标准色映射） ──

const COLOR_HEX: Array<[RegExp, string]> = [
  [/white/i, "#F4F3EE"],
  [/snow/i, "#FAFAF7"],
  [/ivory|cream/i, "#F1E8D7"],
  [/linen/i, "#E8DFD0"],
  [/bone/i, "#E3DAC9"],
  [/pearl|oyster/i, "#E5DFD3"],
  [/beige/i, "#D9CBB4"],
  [/sand/i, "#D6C6A8"],
  [/wheat/i, "#E8D4A9"],
  [/tan|camel/i, "#C9AE8C"],
  [/taupe/i, "#B0A493"],
  [/stone/i, "#ADA495"],
  [/mocha|coffee|mushroom/i, "#8B6F5A"],
  [/chocolate|walnut/i, "#5C4033"],
  [/brown|bronze/i, "#7A5C48"],
  [/light\s*gr[ae]y|silver/i, "#C9C9C7"],
  [/dark\s*gr[ae]y|graphite|iron/i, "#5F5F5D"],
  [/charcoal/i, "#4A4A48"],
  [/slate|steel/i, "#708090"],
  [/smoke|ash|haze/i, "#A9A8A2"],
  [/gr[ae]y/i, "#9A9A98"],
  [/black|shadow|ebony|onyx|midnight/i, "#2B2B2B"],
  [/navy|indigo/i, "#3B4A63"],
  [/blue/i, "#6E87A0"],
  [/green|sage/i, "#8A9A85"],
  [/red|wine|burgundy/i, "#7E3B3B"],
  [/yellow|gold|butter/i, "#D9B978"],
  [/orange|terra/i, "#C07B4F"],
  [/khaki/i, "#B8A97F"],
  [/latte|late/i, "#C8A27A"],
  [/cloud/i, "#C9CBC8"],
  [/fog|mist/i, "#BFC3BE"],
  [/burlap|jute|hemp/i, "#B8A487"],
  [/eggshell|vanilla/i, "#F0E9D8"],
  [/moca/i, "#8B6F5A"],
  [/pewter/i, "#8E9294"],
  [/storm/i, "#7D8083"],
  [/night|dark/i, "#3A3A3C"],
  [/lite|light/i, "#E9E5DB"],
];

const FALLBACK_HEX = "#BFB9AF"; // 未匹配时的暖灰

function hexForColorName(name: string): { hex: string; matched: boolean } {
  // 双拼色（"White/Tan"）取第一段
  const primary = name.split("/")[0].trim();
  for (const [re, hex] of COLOR_HEX) {
    if (re.test(primary) || re.test(name)) return { hex, matched: true };
  }
  return { hex: FALLBACK_HEX, matched: false };
}

// ── Yuma JSON → 按系列分组 ──

interface YumaColor {
  name?: string;
  code?: string;
  image?: string;
}
interface YumaItem {
  title?: string;
  type?: string;
  product_category?: string;
  colors?: YumaColor[];
}

function loadYumaProducts(unmatchedLog: string[]): ProductDraft[] {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, "yuma-fabrics.json"), "utf8"),
  ) as YumaItem[];

  const drafts: ProductDraft[] = [];
  for (const item of raw) {
    const series = (item.title || "").trim();
    if (!series) continue;
    const type = cleanFabricType(item.type);
    const isBlackout = /blackout/i.test(type);
    const isSunCool = /suncool/i.test(item.product_category || "");

    const colors: CatalogColor[] = [];
    let previewImageUrl: string | null = null;
    for (const c of item.colors || []) {
      const code = (c.code || "").trim();
      if (!code) continue;
      const colorName = cleanColorName(c.name) || code;
      const { hex, matched } = hexForColorName(colorName);
      if (!matched) unmatchedLog.push(`${code} ${colorName}`);
      colors.push({ name: `${colorName} · ${code}`.slice(0, 60), hex });
      if (!previewImageUrl && c.image) previewImageUrl = c.image;
    }
    if (colors.length === 0) continue;

    drafts.push({
      name: `Yuma ${series}${type ? ` ${type}` : ""}`.slice(0, 120),
      category: isSunCool ? "solar" : isBlackout ? "blackout_roller" : "roller",
      categoryLabel: isSunCool ? "阳光帘" : isBlackout ? "遮光卷帘" : "卷帘",
      defaultOpacity: isBlackout ? 0.98 : 0.8,
      colors,
      previewImageUrl,
      notes: `[fabric-catalog-import] Yuma ${item.product_category || ""} / ${series}`,
    });
  }
  return drafts;
}

// ── Sunny CSV → 4 个产品 ──

function loadSunnyProducts(): ProductDraft[] {
  const text = readFileSync(join(DATA_DIR, "sunny-fabrics.csv"), "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(",").map((s) => s.trim());
  const idx = (name: string) => header.indexOf(name);

  const PRODUCTS: Record<
    string,
    { name: string; category: string; categoryLabel: string; opacity: number }
  > = {
    "sunny-honeycomb-blackout": { name: "Sunny Honeycomb Blackout", category: "honeycomb", categoryLabel: "蜂巢帘", opacity: 0.98 },
    "sunny-honeycomb-light-filtering": { name: "Sunny Honeycomb Light Filtering", category: "honeycomb", categoryLabel: "蜂巢帘", opacity: 0.85 },
    "sunny-zebra-light-filtering": { name: "Sunny Zebra Light Filtering", category: "zebra", categoryLabel: "斑马帘", opacity: 0.85 },
    "sunny-zebra-room-darkening": { name: "Sunny Zebra Room Darkening", category: "zebra", categoryLabel: "斑马帘", opacity: 0.95 },
  };

  const grouped = new Map<string, CatalogColor[]>();
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((s) => s.trim());
    const slug = cols[idx("product_slug")];
    const sku = cols[idx("fabric_sku")];
    if (!sku || !PRODUCTS[slug] || cols[idx("active")] !== "yes") continue;
    const hexRaw = cols[idx("swatch_hex")] || "";
    const hex = HEX_RE.test(hexRaw) ? hexRaw : FALLBACK_HEX;
    const colorName = cols[idx("fabric_name")] || sku;
    if (!grouped.has(slug)) grouped.set(slug, []);
    grouped.get(slug)!.push({ name: `${colorName} · ${sku}`.slice(0, 60), hex });
  }

  const drafts: ProductDraft[] = [];
  for (const [slug, colors] of grouped) {
    const p = PRODUCTS[slug];
    drafts.push({
      name: p.name,
      category: p.category,
      categoryLabel: p.categoryLabel,
      defaultOpacity: p.opacity,
      colors,
      previewImageUrl: null,
      notes: `[fabric-catalog-import] Sunny ${slug}`,
    });
  }
  return drafts;
}

// ── 主流程 ──

async function main() {
  console.log(`模式: ${WRITE ? "WRITE（真实写入）" : "DRY-RUN（只读）"}\n`);

  const unmatched: string[] = [];
  const drafts = [...loadSunnyProducts(), ...loadYumaProducts(unmatched)];
  console.log(`解析产品: ${drafts.length} 个（Sunny 4 + Yuma ${drafts.length - 4}），颜色合计 ${drafts.reduce((s, d) => s + d.colors.length, 0)} 款`);
  if (unmatched.length) {
    console.log(`⚠ ${unmatched.length} 个颜色名未匹配到标准色值，使用暖灰兜底: ${unmatched.slice(0, 10).join("; ")}${unmatched.length > 10 ? " ..." : ""}`);
  }

  // 幂等：平台预置里同名未归档产品已存在 → 跳过
  const existing = await db.visualizerCatalogProduct.findMany({
    where: { orgId: null, archived: false },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((e) => e.name.toLowerCase()));
  const toCreate = drafts.filter((d) => !existingNames.has(d.name.toLowerCase()));
  console.log(`平台预置现有 ${existing.length} 个；同名跳过 ${drafts.length - toCreate.length} 个；待新增 ${toCreate.length} 个\n`);

  for (const d of [...toCreate.slice(0, 6), ...toCreate.slice(-2)]) {
    console.log(`  ${d.name}  [${d.categoryLabel}] ${d.colors.length} 色  如: ${d.colors[0].name} ${d.colors[0].hex}`);
  }
  if (toCreate.length > 8) console.log(`  ...（其余 ${toCreate.length - 8} 个省略）`);

  if (!WRITE) {
    console.log("\nDRY-RUN 结束，未写入。确认无误后运行: npm run import:visualizer-catalog:write");
    return;
  }

  let created = 0;
  for (const d of toCreate) {
    await db.visualizerCatalogProduct.create({
      data: {
        orgId: null,
        name: d.name,
        category: d.category,
        categoryLabel: d.categoryLabel,
        previewImageUrl: d.previewImageUrl,
        textureUrl: null,
        defaultOpacity: d.defaultOpacity,
        colorsJson: d.colors as unknown as object,
        mountingsJson: ["inside", "outside"] as unknown as object,
        pricingProductName: null,
        notes: d.notes,
        archived: false,
        createdById: null,
      },
    });
    created++;
  }

  const after = await db.visualizerCatalogProduct.count({
    where: { orgId: null, archived: false },
  });
  console.log(`\n✅ 写入完成: 新增 ${created} 个产品；平台预置现有 ${after} 个`);
}

main()
  .catch((err) => {
    console.error("导入失败:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
