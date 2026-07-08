/**
 * 面料目录导入 — Yuma 供应商目录 + Sunny 自有品牌面料
 *
 * 数据源（scripts/data/，2026-07 由用户提供）：
 *   - yuma-fabrics.json  官网 yuma_fabrics_full.json 快照（48 系列 / ~264 个带 SKU 的颜色款）
 *   - sunny-fabrics.csv  sunny_shop_engine 商城包 data/fabrics.csv（57 款蜂巢/斑马帘面料）
 *
 * 导入目标：FabricInventory（微信 AI 分身 SKU 识别按 sku 精确匹配此表）
 *   - 纯目录记录：totalYards=0 / minYards=0，notes 打 [catalog] 标记，不参与库存预警
 *   - 已存在的 SKU 一律跳过，不覆盖人工维护过的数据
 *
 * 用法：
 *   npm run import:fabric-catalog          # dry-run（默认，只读）
 *   npm run import:fabric-catalog:write    # 真实写入
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";

const WRITE = process.argv.includes("--write");
const DATA_DIR = join(__dirname, "data");

interface CatalogRow {
  sku: string;
  productType: string;
  fabricName: string;
  color: string | null;
  supplier: string;
  notes: string;
}

/** 清洗 Yuma type 字段的脏数据："Blackout Blackout Blackout" / "Light FilteringLight Filtering" / "Light-Filtering" */
function cleanFabricType(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  // 拆词后去重（保序），处理 "Blackout Blackout"、"Light FilteringLight Filtering" 这类拼接
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = s.split(" ");
  const out: string[] = [];
  for (const w of words) {
    // "Light Filtering Light Filtering" → 检测两词循环
    out.push(w);
    const half = Math.floor(out.length / 2);
    if (
      out.length % 2 === 0 &&
      out.slice(0, half).join(" ") === out.slice(half).join(" ")
    ) {
      out.length = half;
    }
  }
  // 相邻重复词兜底（"Blackout Blackout Blackout" 逐步折叠）
  const dedup = out.filter((w, i) => w !== out[i - 1]);
  return dedup.join(" ");
}

/** 颜色名里的 "L/F" / "B/O" 后缀与 type 重复，展示时去掉 */
function cleanColorName(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/\s*(L\/F|B\/O)\s*$/i, "").replace(/\s+/g, " ").trim();
}

// ── Yuma JSON ──

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

function loadYuma(): CatalogRow[] {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, "yuma-fabrics.json"), "utf8"),
  ) as YumaItem[];
  const rows: CatalogRow[] = [];
  let skippedNoCode = 0;

  for (const item of raw) {
    const series = (item.title || "").trim();
    const type = cleanFabricType(item.type);
    const fabricName = [series, type].filter(Boolean).join(" ") || series;
    for (const c of item.colors || []) {
      const sku = (c.code || "").trim();
      if (!sku) {
        skippedNoCode++;
        continue;
      }
      rows.push({
        sku,
        productType: "Roller",
        fabricName,
        color: cleanColorName(c.name) || null,
        supplier: "Yuma",
        notes: `[catalog] ${item.product_category || ""}${c.image ? ` | swatch: ${c.image}` : ""}`.trim(),
      });
    }
  }
  console.log(`Yuma: 解析 ${rows.length} 个 SKU（跳过无编号颜色 ${skippedNoCode} 个）`);
  return rows;
}

// ── Sunny CSV ──

function parseCsvLine(line: string): string[] {
  // 该 CSV 无引号包裹、无内嵌逗号，直接 split 即可
  return line.split(",").map((s) => s.trim());
}

function loadSunny(): CatalogRow[] {
  const text = readFileSync(join(DATA_DIR, "sunny-fabrics.csv"), "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);

  const PRODUCT_TYPE: Record<string, { productType: string; fabricName: string }> = {
    "sunny-honeycomb-blackout": { productType: "Honeycomb", fabricName: "Honeycomb Blackout" },
    "sunny-honeycomb-light-filtering": { productType: "Honeycomb", fabricName: "Honeycomb Light Filtering" },
    "sunny-zebra-light-filtering": { productType: "Zebra", fabricName: "Zebra Light Filtering" },
    "sunny-zebra-room-darkening": { productType: "Zebra", fabricName: "Zebra Room Darkening" },
  };

  const rows: CatalogRow[] = [];
  let skippedInactive = 0;
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const slug = cols[idx("product_slug")];
    const sku = cols[idx("fabric_sku")];
    if (!sku) continue;
    if (cols[idx("active")] !== "yes") {
      skippedInactive++;
      continue;
    }
    const mapped = PRODUCT_TYPE[slug] || {
      productType: "Roller",
      fabricName: slug.replace(/^sunny-/, "").replace(/-/g, " "),
    };
    const collection = cols[idx("collection")];
    const colorFamily = cols[idx("color_family")];
    rows.push({
      sku,
      productType: mapped.productType,
      fabricName: mapped.fabricName,
      color: cols[idx("fabric_name")] || null,
      supplier: "Sunny",
      notes: `[catalog] ${collection || ""}${colorFamily ? ` | family: ${colorFamily}` : ""} | swatch: ${cols[idx("swatch_image")] || ""}`.trim(),
    });
  }
  console.log(`Sunny: 解析 ${rows.length} 个 SKU（跳过 inactive ${skippedInactive} 个）`);
  return rows;
}

// ── 主流程 ──

async function main() {
  console.log(`模式: ${WRITE ? "WRITE（真实写入）" : "DRY-RUN（只读）"}\n`);

  const all = [...loadYuma(), ...loadSunny()];

  // 数据源内部查重
  const seen = new Map<string, CatalogRow>();
  const dupes: string[] = [];
  for (const r of all) {
    const key = r.sku.toLowerCase();
    if (seen.has(key)) dupes.push(r.sku);
    else seen.set(key, r);
  }
  if (dupes.length) {
    console.log(`⚠ 数据源内部重复 SKU（保留首次出现）: ${dupes.join(", ")}`);
  }
  const rows = Array.from(seen.values());

  // 与库中已有 SKU 比对（不区分大小写防撞）
  const existing = await db.fabricInventory.findMany({ select: { sku: true } });
  const existingSet = new Set(existing.map((e) => e.sku.toLowerCase()));
  const toCreate = rows.filter((r) => !existingSet.has(r.sku.toLowerCase()));
  const skippedExisting = rows.length - toCreate.length;

  console.log(`\n合计: ${rows.length} 个 SKU；库中已存在跳过 ${skippedExisting} 个；待新增 ${toCreate.length} 个`);
  console.log(`当前库中记录数: ${existing.length}\n`);

  const preview = [...toCreate.slice(0, 5), ...toCreate.slice(-3)];
  for (const r of preview) {
    console.log(`  ${r.sku}  [${r.supplier}] ${r.productType} / ${r.fabricName}${r.color ? ` / ${r.color}` : ""}`);
  }
  if (toCreate.length > preview.length) console.log(`  ...（其余 ${toCreate.length - preview.length} 条省略）`);

  if (!WRITE) {
    console.log("\nDRY-RUN 结束，未写入。确认无误后运行: npm run import:fabric-catalog:write");
    return;
  }

  const result = await db.fabricInventory.createMany({
    data: toCreate.map((r) => ({
      sku: r.sku,
      productType: r.productType,
      fabricName: r.fabricName,
      color: r.color,
      supplier: r.supplier,
      totalYards: 0,
      reservedYards: 0,
      minYards: 0,
      unitCost: 0,
      status: "in_stock",
      notes: r.notes,
    })),
    skipDuplicates: true,
  });

  const after = await db.fabricInventory.count();
  console.log(`\n✅ 写入完成: 新增 ${result.count} 条；库中现有 ${after} 条`);
}

main()
  .catch((err) => {
    console.error("导入失败:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
