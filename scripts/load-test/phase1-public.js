/**
 * Phase 1b: 公开分享页压测（无需登录）
 *
 * 目的：
 *   1. 验证公开报价页在高频访问下的 DB 性能
 *   2. 模拟爬虫/搜索引擎扫描
 *   3. 作为整体基线测试（最简单，建议第一个跑）
 *
 * 并发：10→50 VU
 * 成功标准：p95 < 300ms，错误率 < 1%
 * 失败表现：DB 连接耗尽、响应变慢
 *
 * 使用前：需要先拿到一个真实的 shareToken
 *   在数据库里执行：SELECT "shareToken" FROM "SalesQuote" LIMIT 1;
 *   然后设置环境变量：export SHARE_TOKEN="xxx"
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const SHARE_TOKEN = __ENV.SHARE_TOKEN || "nonexistent_token";

const errorRate = new Rate("errors");

export const options = {
  stages: [
    { duration: "10s", target: 10 },
    { duration: "20s", target: 50 },
    { duration: "20s", target: 50 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<300"],
    errors: ["rate<0.01"],
  },
};

export default function () {
  // 真实 token 走正常流程
  const res = http.get(
    `${BASE}/api/sales/quotes/share/${SHARE_TOKEN}`,
    { tags: { endpoint: "quote_share" } }
  );

  check(res, {
    "status is 200 or 404": (r) => r.status === 200 || r.status === 404,
    "response < 500ms": (r) => r.timings.duration < 500,
    "no 500 error": (r) => r.status < 500,
  });

  errorRate.add(res.status >= 500);

  // 也测一下不存在的 token（模拟恶意扫描）
  if (Math.random() < 0.3) {
    const fakeRes = http.get(
      `${BASE}/api/sales/quotes/share/fake_${Date.now()}`,
      { tags: { endpoint: "quote_share_invalid" } }
    );

    check(fakeRes, {
      "invalid token returns 400 or 404": (r) =>
        r.status === 400 || r.status === 404,
    });
  }

  sleep(0.2 + Math.random() * 0.3);
}
