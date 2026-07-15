import { createHmac } from "crypto";
import {
  classifyMarketChange,
  normalizeCompetitorUrl,
  selectCompetitorUrls,
  verifyFirecrawlSignature,
  verifySharedWebhookToken,
} from "../rules";

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

const normalized = normalizeCompetitorUrl("www.example.com/");
expect(normalized.normalizedDomain === "example.com", "竞品域名去除 www");
expect(normalized.websiteUrl === "https://www.example.com/", "缺少协议时补充 https");

const selected = selectCompetitorUrls(
  "https://example.com",
  [
    { url: "https://example.com/products/zebra-shades", title: "Zebra Shades" },
    { url: "https://example.com/sale", title: "Summer promotion" },
    { url: "https://example.com/gallery", title: "Projects" },
    { url: "https://example.com/book-consultation", title: "Book" },
    { url: "https://example.com/blog", title: "Blog" },
    { url: "https://other.example/pricing", title: "External" },
  ],
  5,
);
expect(selected.length === 5, "页面选择遵守抓取预算");
expect(selected[0] === "https://example.com/", "首页作为基线优先");
expect(selected.some((url) => url.includes("/sale")), "优先保留优惠页面");
expect(!selected.some((url) => url.includes("other.example")), "拒绝跨域页面");

expect(
  classifyMarketChange({
    pageStatus: "changed",
    diff: { json: { "offers[0].price": { previous: "$99", current: "$79" } } },
  }).severity === "high",
  "价格变化判为高强度",
);
expect(
  classifyMarketChange({
    pageStatus: "changed",
    diff: { json: { "products[0].name": { previous: "A", current: "B" } } },
  }).severity === "medium",
  "产品变化判为中强度",
);
expect(
  classifyMarketChange({ pageStatus: "changed", diff: { text: "footer wording" } }).severity ===
    "low",
  "普通文案变化判为低强度",
);
expect(
  classifyMarketChange({ pageStatus: "removed" }).severity === "high",
  "页面下线判为高强度",
);

const body = JSON.stringify({ type: "monitor.page", data: [] });
const secret = "firecrawl-test-secret";
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
expect(verifyFirecrawlSignature(body, signature, secret), "接受有效 Firecrawl HMAC");
expect(!verifyFirecrawlSignature(`${body}x`, signature, secret), "拒绝被篡改的 webhook");
expect(verifySharedWebhookToken("token-123", "token-123"), "接受独立共享 token");
expect(!verifySharedWebhookToken("token-12x", "token-123"), "拒绝错误共享 token");

console.log(`\n${failed === 0 ? "✅" : "❌"} market-intelligence rules: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
