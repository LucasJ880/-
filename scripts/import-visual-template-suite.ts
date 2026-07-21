/**
 * 将授权采集的套图模版导入青砚模版库
 *
 * 用法：
 *   npx tsx scripts/import-visual-template-suite.ts <suite-id>
 *   npx tsx scripts/import-visual-template-suite.ts --all
 *   npx tsx scripts/import-visual-template-suite.ts --from-csv content/visual-template-imports/TEMPLATE.csv
 *
 * 输入：content/visual-template-imports/<suite-id>/manifest.json + 图片
 * 输出：public/product-content-templates/<suite-id>/suite.json + 图片
 */

import fs from "fs";
import path from "path";
import {
  buildSuiteFromImportManifest,
} from "../src/lib/product-content/templates/import-build";
import type { VisualTemplateImportManifest } from "../src/lib/product-content/templates/import-types";
import type { StyleRefKind } from "../src/lib/product-content/templates/types";

const IMPORT_ROOT = path.join(process.cwd(), "content", "visual-template-imports");
const PUBLIC_ROOT = path.join(process.cwd(), "public", "product-content-templates");

function listSuiteDirs(): string[] {
  if (!fs.existsSync(IMPORT_ROOT)) return [];
  return fs
    .readdirSync(IMPORT_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);
}

function resolveExistingFile(dir: string, preferred: string): string | null {
  const candidates = [
    preferred,
    preferred.replace(/\.jpg$/i, ".png"),
    preferred.replace(/\.png$/i, ".jpg"),
    preferred.replace(/\.jpeg$/i, ".jpg"),
  ];
  for (const name of candidates) {
    const abs = path.join(dir, name);
    if (fs.existsSync(abs)) return name;
  }
  return null;
}

function copyIfExists(srcDir: string, destDir: string, fileName: string | null) {
  if (!fileName) return null;
  const src = path.join(srcDir, fileName);
  if (!fs.existsSync(src)) return null;
  const dest = path.join(destDir, fileName);
  fs.copyFileSync(src, dest);
  return fileName;
}

function importOne(suiteId: string) {
  const srcDir = path.join(IMPORT_ROOT, suiteId);
  const manifestPath = path.join(srcDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`缺少 manifest.json: ${manifestPath}`);
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8"),
  ) as VisualTemplateImportManifest;

  if (manifest.id !== suiteId) {
    console.warn(
      `警告: 目录名 ${suiteId} 与 manifest.id ${manifest.id} 不一致，以 manifest.id 为准`,
    );
  }
  const id = manifest.id;
  const BUILTIN_IDS = new Set([
    "amazon_realism_bathrobe_v1",
    "mint_palace_bedding_v1",
  ]);
  if (BUILTIN_IDS.has(id)) {
    throw new Error(`不可覆盖内置模版 ${id}`);
  }

  const files = manifest.files ?? {};
  const previewPreferred = files.preview ?? "preview.jpg";
  const modelPreferred = files.styleModel ?? "style-model.jpg";
  const displayPreferred = files.styleDisplay ?? "style-display.jpg";

  const previewFile = resolveExistingFile(srcDir, previewPreferred);
  const modelFile = resolveExistingFile(srcDir, modelPreferred);
  const displayFile = resolveExistingFile(srcDir, displayPreferred);

  if (!previewFile && !modelFile) {
    console.warn(
      `[${id}] 未找到 preview / style-model 图片，仍将导入 suite.json（列表预览可能空白）`,
    );
  }

  const publicBase = `/product-content-templates/${id}`;
  const suite = buildSuiteFromImportManifest(
    {
      ...manifest,
      files: {
        preview: previewFile ?? previewPreferred,
        styleModel: modelFile ?? modelPreferred,
        styleDisplay: displayFile ?? displayPreferred,
      },
    },
    publicBase,
  );

  // 若缺图，去掉不存在的 style 路径，避免运行时读文件失败
  if (!modelFile && suite.styleAssetPaths) {
    delete suite.styleAssetPaths.model;
  }
  if (!displayFile && suite.styleAssetPaths) {
    delete suite.styleAssetPaths.display;
  }
  if (!previewFile) {
    delete suite.previewImage;
  }

  const destDir = path.join(PUBLIC_ROOT, id);
  fs.mkdirSync(destDir, { recursive: true });
  copyIfExists(srcDir, destDir, previewFile);
  copyIfExists(srcDir, destDir, modelFile);
  copyIfExists(srcDir, destDir, displayFile);

  const suiteJsonPath = path.join(destDir, "suite.json");
  fs.writeFileSync(suiteJsonPath, JSON.stringify(suite, null, 2) + "\n", "utf8");

  console.log(`✅ 已导入 ${id}`);
  console.log(`   shots: ${suite.shotCount}`);
  console.log(`   out: ${suiteJsonPath}`);
  return suite;
}

/** 简易 CSV → 多套 manifest（同 suite_id 多行聚合） */
function importFromCsv(csvPath: string) {
  const abs = path.isAbsolute(csvPath)
    ? csvPath
    : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(abs)) throw new Error(`CSV 不存在: ${abs}`);

  const text = fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV 无数据行");

  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (cols[i] ?? "").trim();
    });
    return row;
  });

  const bySuite = new Map<string, typeof rows>();
  for (const row of rows) {
    const id = row.suite_id;
    if (!id) continue;
    const list = bySuite.get(id) ?? [];
    list.push(row);
    bySuite.set(id, list);
  }

  for (const [suiteId, suiteRows] of bySuite) {
    const head = suiteRows[0];
    const dir = path.join(IMPORT_ROOT, suiteId);
    fs.mkdirSync(dir, { recursive: true });

    const manifest: VisualTemplateImportManifest = {
      id: suiteId,
      name: head.suite_name || suiteId,
      category: head.category || "imported",
      description: head.description || "",
      source: {
        vendor: head.vendor || undefined,
        externalName: head.external_name || undefined,
        licenseNote: head.license_note || undefined,
      },
      files: {
        preview: head.preview_file || "preview.jpg",
        styleModel: head.style_model_file || "style-model.jpg",
        styleDisplay: head.style_display_file || "style-display.jpg",
      },
      shots: suiteRows.map((r) => ({
        key: r.shot_key,
        label: r.shot_label || r.shot_key,
        styleGroup: r.style_group || "imported",
        styleRefs: (r.style_refs as StyleRefKind) || "both",
        compositionNotes: r.composition_notes || r.shot_label || r.shot_key,
      })),
    };

    const manifestPath = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`📝 已从 CSV 生成 ${manifestPath}`);
    console.log(
      `   请将图片放入 ${dir} 后执行: npx tsx scripts/import-visual-template-suite.ts ${suiteId}`,
    );
  }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--from-csv") {
    if (!args[1]) throw new Error("用法: --from-csv <path>");
    importFromCsv(args[1]);
    return;
  }
  if (args[0] === "--all") {
    const ids = listSuiteDirs();
    if (ids.length === 0) {
      console.log("没有可导入目录（跳过 _ 开头）。可先看 _example/");
      return;
    }
    for (const id of ids) importOne(id);
    return;
  }
  const suiteId = args[0];
  if (!suiteId) {
    console.log(`用法:
  npx tsx scripts/import-visual-template-suite.ts <suite-id>
  npx tsx scripts/import-visual-template-suite.ts --all
  npx tsx scripts/import-visual-template-suite.ts --from-csv content/visual-template-imports/TEMPLATE.csv
`);
    process.exit(1);
  }
  importOne(suiteId);
}

main();
