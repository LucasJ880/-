/**
 * Phase 1: 基础读接口压测
 *
 * 目的：验证 DB 连接池在并发下是否扛得住，响应时间基线
 * 并发：10→30 VU，持续 60s
 * 成功标准：p95 < 500ms，错误率 < 1%
 * 失败表现：大量 500/502、响应时间飙到 5s+、DB connection timeout
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const TOKEN = __ENV.SESSION_TOKEN; // qy_session cookie 值

const errorRate = new Rate("errors");
const apiDuration = new Trend("api_duration", true);

export const options = {
  stages: [
    { duration: "10s", target: 10 },
    { duration: "30s", target: 30 },
    { duration: "10s", target: 30 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    errors: ["rate<0.01"],
  },
};

const endpoints = [
  { path: "/api/sales/customers?page=1&pageSize=20", name: "customers_list" },
  { path: "/api/sales/opportunities", name: "opportunities_list" },
  { path: "/api/sales/quotes/list", name: "quotes_list" },
  { path: "/api/auth/me", name: "auth_me" },
];

export default function () {
  const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
  const params = {
    headers: { Cookie: `qy_session=${TOKEN}` },
    tags: { endpoint: ep.name },
  };

  const res = http.get(`${BASE}${ep.path}`, params);

  apiDuration.add(res.timings.duration, { endpoint: ep.name });
  errorRate.add(res.status >= 400);

  check(res, {
    "status is 200": (r) => r.status === 200,
    "has body": (r) => r.body && r.body.length > 0,
    "response < 1s": (r) => r.timings.duration < 1000,
  });

  sleep(0.5 + Math.random());
}
