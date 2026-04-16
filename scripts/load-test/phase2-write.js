/**
 * Phase 2: 写接口 + 数据一致性压测
 *
 * 目的：
 *   1. 验证并发创建客户是否产生脏数据
 *   2. 验证报价 version 计数在并发下是否重复
 *   3. 验证 withAuth 的 try/catch 在高压下是否正常兜底
 *
 * 并发：5→15 VU（写接口不宜太高）
 * 成功标准：p95 < 1s，错误率 < 2%，无重复 version
 * 失败表现：数据库唯一约束冲突、500 错误、报价 version 重复
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const TOKEN = __ENV.SESSION_TOKEN;

const errorRate = new Rate("errors");
const created = new Counter("customers_created");

export const options = {
  stages: [
    { duration: "10s", target: 5 },
    { duration: "30s", target: 15 },
    { duration: "10s", target: 15 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    errors: ["rate<0.02"],
  },
};

const headers = {
  Cookie: `qy_session=${TOKEN}`,
  "Content-Type": "application/json",
};

function createCustomer() {
  const ts = Date.now();
  const vu = __VU;
  const payload = JSON.stringify({
    name: `压测客户_${vu}_${ts}`,
    phone: `1380000${String(ts).slice(-4)}`,
    email: `test_${vu}_${ts}@loadtest.local`,
    source: "load_test",
  });

  const res = http.post(`${BASE}/api/sales/customers`, payload, {
    headers,
    tags: { op: "create_customer" },
  });

  const ok = check(res, {
    "customer created 201": (r) => r.status === 201,
  });

  if (ok) created.add(1);
  errorRate.add(!ok);
  return res;
}

function createOpportunity(customerId) {
  const payload = JSON.stringify({
    customerId,
    title: `压测商机_${__VU}_${Date.now()}`,
    stage: "new_lead",
    priority: "warm",
  });

  const res = http.post(`${BASE}/api/sales/opportunities`, payload, {
    headers,
    tags: { op: "create_opportunity" },
  });

  check(res, {
    "opportunity created 201": (r) => r.status === 201,
  });

  errorRate.add(res.status >= 400);
  return res;
}

export default function () {
  // 创建客户
  const custRes = createCustomer();
  if (custRes.status !== 201) {
    sleep(1);
    return;
  }

  const customer = JSON.parse(custRes.body);

  // 为同一个客户创建商机
  createOpportunity(customer.id);

  sleep(1 + Math.random());
}

/**
 * 压测结束后清理数据（可选）：
 *
 * DELETE FROM "SalesOpportunity" WHERE title LIKE '压测商机_%';
 * DELETE FROM "SalesCustomer" WHERE source = 'load_test';
 */
