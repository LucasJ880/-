/**
 * 把 src/lib/visualizer/mock-products.ts 里的十款产品 upsert 进 VisualizerCatalogProduct（平台预置）。
 *
 *   pnpm exec tsx scripts/seed-visualizer-catalog.ts
 *   pnpm exec tsx scripts/seed-visualizer-catalog.ts --write
 *
 * 默认 dry-run；--write 才真正写库。
 *
 * 设计要点：
 * - 保留 mock_xxx 作为主键 id，避免 VisualizerProductOption.productCatalogId 历史值失效
 * - orgId = null 表示平台预置（所有组织可见、不可改）
 * - 已存在则 update 关键字段（保留管理员可能调过的细节）
 */

import { db } from "@/lib/db";
import { VISUALIZER_MOCK_PRODUCTS } from "@/lib/visualizer/mock-products";

const WRITE = process.argv.includes("--write");

async function main() {
  console.log(`[seed-visualizer-catalog] dryRun=${!WRITE} count=${VISUALIZER_MOCK_PRODUCTS.length}`);

  let upserted = 0;
  let skipped = 0;

  for (const p of VISUALIZER_MOCK_PRODUCTS) {
    const data = {
      id: p.id,
      orgId: null as string | null,
      name: p.name,
      category: p.category,
      categoryLabel: p.categoryLabel,
      previewImageUrl: p.previewImageUrl,
      textureUrl: p.textureUrl,
      defaultOpacity: p.defaultOpacity,
      colorsJson: p.supportedColors as unknown as object,
      mountingsJson: p.mountingTypes as unknown as object,
      pricingProductName: null as string | null,
      notes: p.notes,
      archived: false,
      createdById: null as string | null,
    };

    if (!WRITE) {
      console.log(`  · plan upsert ${p.id} (${p.name})`);
      continue;
    }

    try {
      await db.visualizerCatalogProduct.upsert({
        where: { id: p.id },
        create: data,
        update: {
          name: data.name,
          category: data.category,
          categoryLabel: data.categoryLabel,
          previewImageUrl: data.previewImageUrl,
          textureUrl: data.textureUrl,
          defaultOpacity: data.defaultOpacity,
          colorsJson: data.colorsJson,
          mountingsJson: data.mountingsJson,
          notes: data.notes,
        },
      });
      upserted += 1;
      console.log(`  ✔ upsert ${p.id} (${p.name})`);
    } catch (err) {
      skipped += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ✗ failed ${p.id}: ${msg}`);
    }
  }

  console.log(
    `[seed-visualizer-catalog] done. ${WRITE ? `upserted=${upserted} failed=${skipped}` : "dry-run only"}`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-visualizer-catalog] fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
