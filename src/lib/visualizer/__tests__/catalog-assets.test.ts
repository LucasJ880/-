import { sanitizeCatalogAssets } from "../catalog";

let total = 0;
let failed = 0;

function expect(condition: boolean, message: string) {
  total++;
  if (condition) console.log(`✓ ${message}`);
  else {
    failed++;
    console.error(`✗ ${message}`);
  }
}

const valid = sanitizeCatalogAssets([
  {
    role: "installed",
    fileUrl: "/api/files/visualizer/catalog/org/installed.jpg",
    fileName: "installed.jpg",
    mimeType: "image/jpeg",
    width: 2048,
    height: 1365,
    bytes: 900_000,
    sortOrder: 0,
    isPrimary: true,
    sourceType: "real",
  },
  {
    role: "style_reference",
    fileUrl: "/api/files/visualizer/catalog/org/style.webp",
    fileName: "style.webp",
    mimeType: "image/webp",
    sourceType: "ai_generated",
  },
]);

expect(valid.length === 2, "保留合法产品参考资产");
expect(valid[0]?.role === "installed" && valid[0]?.isPrimary, "保留安装主图标记");
expect(valid[1]?.sourceType === "ai_generated", "区分 AI 效果参考与真实产品图");

const invalid = sanitizeCatalogAssets([
  { role: "unknown", fileUrl: "/bad.jpg", fileName: "bad.jpg", mimeType: "image/jpeg" },
  { role: "texture", fileUrl: "", fileName: "texture.jpg", mimeType: "image/jpeg" },
  { role: "detail", fileUrl: "/file.pdf", fileName: "file.pdf", mimeType: "application/pdf" },
]);
expect(invalid.length === 0, "过滤非法角色、空地址和非图片文件");

const tooMany = sanitizeCatalogAssets(
  Array.from({ length: 20 }, (_, index) => ({
    role: "detail",
    fileUrl: `/api/files/visualizer/catalog/org/detail-${index}.jpg`,
    fileName: `detail-${index}.jpg`,
    mimeType: "image/jpeg",
  })),
);
expect(tooMany.length === 12, "单个产品最多保留十二张参考资产");

const wrongOrg = sanitizeCatalogAssets(
  [{
    role: "installed",
    fileUrl: "/api/files/visualizer/catalog/org-b/product.jpg",
    fileName: "product.jpg",
    mimeType: "image/jpeg",
  }],
  { orgId: "org-a" },
);
expect(wrongOrg.length === 0, "拒绝引用其他组织的产品资产");

console.log(`\n${failed === 0 ? "✅" : "❌"} visualizer catalog assets: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
