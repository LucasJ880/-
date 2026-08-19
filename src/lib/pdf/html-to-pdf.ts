/**
 * 中文安全 HTML → PDF 转换层（服务端 Chromium）
 *
 * 背景：jsPDF 无 CJK 字体（中文=方块/乱码），FB-4/5/16 曾把生成文档止血为
 * HTML；quote/export-pdf.ts 注释早已预言正确路线=「服务端浏览器内核方案」。
 * 本模块落地该路线：复用既有 HTML 模板（排版/中文字体栈已就绪），
 * 用无头 Chromium print-to-PDF 产出真正的 PDF——任何设备可开、中文完好。
 *
 * 运行环境三级解析（fail-closed，绝不静默产出坏文件）：
 * 1. CHROME_EXECUTABLE_PATH env 显式指定（本地/自托管）
 * 2. Vercel/Linux serverless：@sparticuz/chromium（打包二进制 + 注册
 *    Noto Sans SC 字体——lambda 镜像无 CJK 字体，不注册=又是方块）
 * 3. macOS 本地开发：系统 Chrome
 *
 * 失败语义：抛 HtmlToPdfError，由调用方决定降级（generate-docs 回落存 HTML，
 * 绝不把损坏字节当 PDF 存库——「受损打不开」正是本次要根治的症状）。
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

export class HtmlToPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HtmlToPdfError";
  }
}

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// 路径用数组拼接：躲开 turbopack 对字面 require.resolve(".ttf") 的静态打包
// （Unknown module type）；serverless 端文件由 next.config 的
// outputFileTracingIncludes 显式带进 bundle。
const CJK_FONTS: Array<{ weight: number; segments: string[] }> = [
  {
    weight: 400,
    segments: ["@expo-google-fonts", "noto-sans-sc", "400Regular", "NotoSansSC_400Regular.ttf"],
  },
  {
    weight: 700,
    segments: ["@expo-google-fonts", "noto-sans-sc", "700Bold", "NotoSansSC_700Bold.ttf"],
  },
];
const nodeRequire = createRequire(
  typeof __filename !== "undefined" ? __filename : process.cwd() + "/",
);

/**
 * CJK 字体以 data-URI @font-face 注入 HTML（模块级缓存）。
 * 为什么不走 fontconfig：@sparticuz/chromium v147 已移除 font() API，
 * 且 lambda 镜像无 CJK 字体；data-URI 注入平台无关（本地/CI/serverless 同一行为），
 * 模板字体栈里的 "Noto Sans SC" 直接命中。
 */
let cjkFontFaceCss: string | null = null;
function getCjkFontFaceCss(): string {
  if (cjkFontFaceCss !== null) return cjkFontFaceCss;
  const faces: string[] = [];
  for (const f of CJK_FONTS) {
    try {
      const b64 = readFileSync(nodeRequire.resolve(f.segments.join("/"))).toString("base64");
      faces.push(
        `@font-face{font-family:"Noto Sans SC";font-weight:${f.weight};src:url(data:font/ttf;base64,${b64}) format("truetype")}`,
      );
    } catch {
      /* 单字重缺失不阻塞；E2E 以「中文可抽取」把关最终效果 */
    }
  }
  cjkFontFaceCss = faces.length > 0 ? `<style>${faces.join("")}</style>` : "";
  return cjkFontFaceCss;
}

async function resolveLaunch(): Promise<{
  executablePath: string;
  args: string[];
}> {
  const override = process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (override) {
    if (!existsSync(override)) {
      throw new HtmlToPdfError(`CHROME_EXECUTABLE_PATH 不存在：${override}`);
    }
    return { executablePath: override, args: [] };
  }
  if (process.platform === "linux") {
    const chromium = (await import("@sparticuz/chromium")).default;
    return { executablePath: await chromium.executablePath(), args: chromium.args };
  }
  if (process.platform === "darwin" && existsSync(MAC_CHROME)) {
    return { executablePath: MAC_CHROME, args: [] };
  }
  throw new HtmlToPdfError(
    "找不到可用的 Chromium（设 CHROME_EXECUTABLE_PATH，或在 Linux serverless 使用 @sparticuz/chromium）",
  );
}

export async function renderHtmlToPdf(
  html: string,
  opts?: { timeoutMs?: number },
): Promise<Buffer> {
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const { executablePath, args } = await resolveLaunch();
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath,
    args: [...args, "--no-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    // CJK 字体注入在最前（后续同名 @font-face/系统字体栈不受影响；
    // 生成文档 HTML 均自包含无外链，waitUntil load 足够且更快）
    const htmlWithFonts = html.replace(
      /<meta charset="utf-8">/i,
      (m) => `${m}${getCjkFontFaceCss()}`,
    );
    await page.setContent(htmlWithFonts, { waitUntil: "load", timeout: timeoutMs });
    await page.evaluateHandle("document.fonts.ready");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
      timeout: timeoutMs,
    });
    const buffer = Buffer.from(pdf);
    // 基本健全性：PDF 魔数 + 非空——绝不把坏字节交给调用方当 PDF 存
    if (buffer.length < 1_000 || !buffer.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
      throw new HtmlToPdfError(`Chromium 输出非法 PDF（${buffer.length} bytes）`);
    }
    return buffer;
  } catch (e) {
    if (e instanceof HtmlToPdfError) throw e;
    throw new HtmlToPdfError(
      e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}
