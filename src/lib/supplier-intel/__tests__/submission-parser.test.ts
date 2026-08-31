/**
 * T3（纯解析）+ T19（SSRF 守卫）+ §17 输入上限
 * 用户提交 = untrusted external input：只做字符串解析，永不 fetch；
 * scheme 白名单 http/https；平台归类是 host 白名单 endsWith 匹配（防子串仿冒）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPLIER_INTEL_LIMITS } from "../constants";
import { SupplierIntelError, isSupplierIntelError } from "../errors";
import { isKnownPlatform, parseUserSubmission } from "../submission-parser";

function expectCode(code: string, fn: () => unknown) {
  try {
    fn();
    assert.fail(`期望抛 ${code}，实际成功`);
  } catch (e) {
    if (!isSupplierIntelError(e, code as never)) throw e;
  }
}

async function main() {
  console.log("平台归类：抖音/小红书/视频号/1688/一般网站");
  assert.equal(parseUserSubmission({ url: "https://v.douyin.com/iAbc123/" }).platform, "DOUYIN");
  assert.equal(parseUserSubmission({ url: "https://www.douyin.com/video/7123456" }).platform, "DOUYIN");
  assert.equal(parseUserSubmission({ url: "https://www.xiaohongshu.com/explore/abcd" }).platform, "XIAOHONGSHU");
  assert.equal(parseUserSubmission({ url: "https://xhslink.com/xyz" }).platform, "XIAOHONGSHU");
  assert.equal(parseUserSubmission({ url: "https://channels.weixin.qq.com/s/abc" }).platform, "WECHAT_CHANNELS");
  assert.equal(parseUserSubmission({ url: "https://weixin.qq.com/sph/AbCdEf" }).platform, "WECHAT_CHANNELS");
  assert.equal(parseUserSubmission({ url: "https://detail.1688.com/offer/123.html" }).platform, "ONE688");
  assert.equal(parseUserSubmission({ url: "https://xxfurniture.cn/about" }).platform, "WEBSITE");

  console.log("host 仿冒不误归类：douyin.com.evil.com → WEBSITE");
  assert.equal(parseUserSubmission({ url: "https://douyin.com.evil.com/x" }).platform, "WEBSITE");
  assert.equal(parseUserSubmission({ url: "https://notdouyin.com/x" }).platform, "WEBSITE");

  console.log("纯文本线索 → MANUAL；文案内嵌链接被提取归类（微信分享形态）");
  const manual = parseUserSubmission({ rawText: "展会遇到的工厂，老周 138xxxx" });
  assert.equal(manual.platform, "MANUAL");
  assert.equal(manual.contentUrl, null);
  const share = parseUserSubmission({
    rawText: "8.8 复制打开抖音 https://v.douyin.com/xYz789/ 看看这家工厂～",
  });
  assert.equal(share.platform, "DOUYIN");
  assert.equal(share.contentUrl, "https://v.douyin.com/xYz789/");

  console.log("解析不到的元数据一律 null（禁止猜）");
  const parsed = parseUserSubmission({ url: "https://v.douyin.com/iAbc123/" });
  assert.equal(parsed.accountName, null);
  assert.equal(parsed.title, null);
  assert.equal(parsed.description, null);
  assert.equal(parsed.publishedAt, null);
  assert.ok(isKnownPlatform(parsed.platform));

  console.log("scheme 白名单：javascript:/file:/ftp: 拒收");
  expectCode("INVALID_URL_SCHEME", () => parseUserSubmission({ url: "javascript:alert(1)" }));
  expectCode("INVALID_URL_SCHEME", () => parseUserSubmission({ url: "file:///etc/passwd" }));
  expectCode("INVALID_URL_SCHEME", () => parseUserSubmission({ url: "ftp://ftp.example.com/a" }));

  console.log("上限：URL 2048 / rawText 20000 / 空提交拒收");
  expectCode("URL_TOO_LONG", () =>
    parseUserSubmission({ url: `https://a.example/${"x".repeat(SUPPLIER_INTEL_LIMITS.URL_MAX_LENGTH)}` }));
  expectCode("RAW_TEXT_TOO_LONG", () =>
    parseUserSubmission({ rawText: "x".repeat(SUPPLIER_INTEL_LIMITS.RAW_TEXT_MAX_LENGTH + 1) }));
  expectCode("EMPTY_SUBMISSION", () => parseUserSubmission({}));

  console.log("T19：内网地址 URL 只被当作字符串存储归类，绝不触发抓取");
  const ssrf = parseUserSubmission({ url: "http://169.254.169.254/latest/meta-data" });
  assert.equal(ssrf.platform, "WEBSITE");
  assert.equal(ssrf.contentUrl, "http://169.254.169.254/latest/meta-data");

  console.log("T19 源码守卫：解析器与信号服务零网络调用（no fetch / no http client）");
  for (const rel of ["src/lib/supplier-intel/submission-parser.ts", "src/lib/supplier-intel/signal-service.ts"]) {
    const source = readFileSync(join(process.cwd(), rel), "utf8");
    for (const forbidden of ["fetch(", "axios", "undici", 'from "http"', 'from "https"', "XMLHttpRequest"]) {
      assert.ok(!source.includes(forbidden), `${rel} 不得包含 ${forbidden}`);
    }
  }

  // 类型自检：SupplierIntelError 携带 httpStatus
  assert.equal(new SupplierIntelError("NOT_FOUND", "x").httpStatus, 404);

  console.log("\nsubmission-parser T3/T19 全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
