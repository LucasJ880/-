/**
 * Markdown / vault 导入解析
 * 运行：npx tsx src/lib/knowledge/__tests__/markdown-vault-import.test.ts
 */

import { zipSync, strToU8 } from "fflate";
import {
  extractTextFilesFromZip,
  parseVaultDocument,
  parseVaultFiles,
  splitFrontmatter,
} from "../markdown-vault-import";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

const fm = splitFrontmatter("---\ntitle: 斑马帘\ncategory: product\ntags: a, b\n---\n\n正文内容");
check("frontmatter title", fm.meta.title === "斑马帘");
check("frontmatter body", fm.body === "正文内容");

const doc = parseVaultDocument({
  path: "faq/shipping.md",
  content: "# 运费\n\nFOB 说明",
});
check("folder→faq", doc?.category === "faq");
check("title from file", doc?.title === "shipping");

const skippedDot = parseVaultDocument({
  path: ".obsidian/workspace.json",
  content: "{}",
});
check("skip obsidian", skippedDot === null);

const zipSlip = extractTextFilesFromZip(
  zipSync({
    "product/ok.md": strToU8("# ok"),
    "../evil.md": strToU8("# evil"),
  }),
);
check("zip only safe path", zipSlip.length === 1 && zipSlip[0]?.path === "product/ok.md");

const batch = parseVaultFiles([
  { path: "product/a.md", content: "A" },
  { path: "notes/image.png", content: "x" },
]);
check("batch one doc", batch.documents.length === 1 && batch.skipped.length === 1);

console.log(failed === 0 ? "\nmarkdown-vault-import 检查通过" : `\n失败 ${failed}`);
if (failed > 0) process.exit(1);
