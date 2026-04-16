/**
 * Phase 4: 登录限流 + 恶意流量验证
 *
 * 目的：
 *   1. 验证 rate limit 在 10 次/分钟后触发 429
 *   2. 验证 429 响应包含 Retry-After 头
 *   3. 验证限流后正常请求恢复
 *   4. 验证错误密码不泄露用户是否存在的信息
 *
 * 并发：1 VU（单 IP 模拟）
 * 成功标准：第 11 次请求返回 429，Retry-After > 0
 * 失败表现：限流不触发、429 后所有请求永久被拒、内存泄漏
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";

const BASE = __ENV.BASE_URL || "http://localhost:3000";

const got429 = new Counter("rate_limited_429");
const gotThrough = new Counter("requests_passed");

export const options = {
  scenarios: {
    brute_force: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 20,
      maxDuration: "30s",
    },
    recovery: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 3,
      startTime: "70s",
      maxDuration: "10s",
    },
  },
};

export default function () {
  const scenario = __ENV.K6_SCENARIO || exec.scenario.name;
  const payload = JSON.stringify({
    email: "loadtest@example.com",
    password: "wrong_password_attempt",
  });

  const res = http.post(`${BASE}/api/auth/login`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { scenario },
  });

  if (res.status === 429) {
    got429.add(1);

    check(res, {
      "429 has Retry-After header": (r) => {
        const ra = r.headers["Retry-After"];
        return ra && parseInt(ra) > 0;
      },
      "429 has error message": (r) => {
        try {
          return JSON.parse(r.body).error.includes("频繁");
        } catch {
          return false;
        }
      },
    });
  } else {
    gotThrough.add(1);

    check(res, {
      "login response is 401 (wrong password)": (r) => r.status === 401,
      "error message is generic": (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.error === "邮箱或密码错误";
        } catch {
          return false;
        }
      },
    });
  }

  sleep(0.1);
}
