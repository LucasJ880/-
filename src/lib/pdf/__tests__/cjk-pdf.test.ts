/**
 * CJK-PDF 包 — 中文安全 PDF 生成（纯平面，零 DB / 零浏览器）
 *
 * 症状→根治：①三类文档「全是 html」②jsPDF 中文方块「受损打不开」。
 * 方案 = 服务端 Chromium 渲染既有 HTML 模板 → 真 PDF；jsPDF 生成路径退役。
 *
 * CJK-CONV-*  转换层契约（fail-closed / 字体注入 / 环境解析）
 * CJK-GEN-*   generate-docs 漏斗（PDF 优先 + 显式降级）
 * 反例守卫：jsPDF 不得回潮 generate-docs；坏字节绝不当 PDF 存库。
 *
 * 运行：npx tsx src/lib/pdf/__tests__/cjk-pdf.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

console.log("CJK-PDF 包 — 中文安全 PDF 生成");

const conv = code("src/lib/pdf/html-to-pdf.ts");
ok(
  conv.includes("%PDF-") && conv.includes("HtmlToPdfError"),
  "CJK-CONV-01: 输出魔数健全性校验（坏字节绝不交给调用方当 PDF）",
);
ok(
  conv.includes("@font-face") && conv.includes("Noto Sans SC") && conv.includes("base64"),
  "CJK-CONV-02: CJK 字体 data-URI 注入（lambda 无中文字体 → 不注入=方块复辟）",
);
ok(
  conv.includes("CHROME_EXECUTABLE_PATH") &&
    conv.includes("@sparticuz/chromium") &&
    conv.includes("document.fonts.ready"),
  "CJK-CONV-03: 三级环境解析 + 字体就绪等待",
);

const gen = code("src/lib/projects/generate/generate-docs.ts");
ok(
  gen.includes("renderHtmlToPdf") &&
    gen.includes('"application/pdf"') &&
    gen.includes("html_fallback:"),
  "CJK-GEN-01: persist 漏斗 PDF 优先 + 显式降级标注（renderMode 落 meta）",
);
ok(
  !gen.includes("createProjectPdfDoc") &&
    !gen.includes("writeWrappedText") &&
    !gen.includes('doc.output("arraybuffer")'),
  "CJK-GEN-02（反例守卫）: jsPDF 生成路径已从 generate-docs 整体退役",
);
ok(
  gen.includes("textBody") && !gen.includes("sanitizeSupplierFacing"),
  "CJK-GEN-03: legacy 文本文档并入漏斗（RFQ-PDF-1：只剩内部文件；供应商侧的文字替换随旧路径删除，询价单命中即整份不生成）",
);
{
  // RFQ-PDF-1：供应商询价单直接存检查过的 PDF，不走「转换失败存 HTML」那条路
  const start = gen.indexOf('if (input.docType === "supplier_rfq") {');
  const branch = gen.slice(start, gen.indexOf("const docType = input.docType;", start));
  ok(
    start > 0 && branch.includes("persistGeneratedFile(") && branch.includes('renderMode: "chromium_pdf"') && !/persistGeneratedHtml|html_fallback|renderHtmlToPdf/.test(branch),
    "CJK-GEN-04: 供应商询价单不回落 HTML（PDF 不合格就不保存）",
  );
}

const cfg = read("next.config.ts");
ok(
  cfg.includes("@sparticuz/chromium") && cfg.includes("puppeteer-core"),
  "CJK-CFG-01: serverExternalPackages 登记（Next 打包不内联浏览器二进制）",
);
const route = read("src/app/api/projects/[id]/generate-pdf/route.ts");
const h2p = read("src/lib/pdf/html-to-pdf.ts");
ok(h2p.includes('path.join(process.cwd(), "node_modules", ...f.segments)') && h2p.includes("CJK 字体缺失"), "CJK-CFG-04: 字体加载直接路径优先 + require.resolve 兜底 + 全失败显式告警（生产静默无字体的根治）");
const cfg2 = read("next.config.ts");
ok(cfg2.split("@expo-google-fonts/noto-sans-sc/package.json").length === 3, "CJK-CFG-05: 两个 PDF 路由都 trace 字体包 package.json（require.resolve 兜底的前提）");

ok(
  route.includes("maxDuration = 800") && route.includes("ROUTE_BUDGET_MS"),
  "CJK-CFG-02: 生成路由 maxDuration=800（备忘录 v2 全文多轮推理；Fluid 上限试探，部署被拒即回退 300+续跑）+ 显式时间预算传入生成器",
);
ok(
  !existsSync(join(process.cwd(), "src/components/bid-workflow/china-supplier-brief-panel.tsx")),
  "CJK-CFG-03: 国内供应商简报面板已随简报下线删除（RFQ-PDF-1；原断言是面板里过时的 jsPDF 文案已纠正）",
);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
