/**
 * Phase 3: AI 接口独立压测
 *
 * ⚠️ 每个请求消耗真实 OpenAI token，控制好并发和总量
 *
 * 目的：
 *   1. 验证 30s 单轮超时 + 90s 总超时是否生效
 *   2. 验证 OpenAI rate limit 命中时系统行为
 *   3. 测量 AI 接口真实延迟分布
 *
 * 并发：1→3 VU（刻意低并发）
 * 总请求量：控制在 20 次以内
 * 成功标准：p95 < 30s，超时后返回友好消息，无 502/504
 * 失败表现：请求挂死无返回、Vercel function timeout、500 无错误信息
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const TOKEN = __ENV.SESSION_TOKEN;

const aiLatency = new Trend("ai_latency", true);
const aiErrors = new Rate("ai_errors");

export const options = {
  scenarios: {
    ai_chat: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "5s",
      duration: "60s",
      preAllocatedVUs: 3,
      maxVUs: 5,
    },
  },
  thresholds: {
    ai_latency: ["p(95)<30000"],
    ai_errors: ["rate<0.3"],
  },
};

const headers = {
  Cookie: `qy_session=${TOKEN}`,
  "Content-Type": "application/json",
};

const prompts = [
  "帮我整理一下本周的工作重点",
  "我有一个新客户需要跟进，你有什么建议？",
  "帮我写一封报价跟进邮件",
  "分析一下最近的销售数据趋势",
  "下周二下午三点和供应商开会",
];

export default function () {
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  // 测试 agent-core/chat（非流式，方便测量完整延迟）
  const payload = JSON.stringify({
    messages: [{ role: "user", content: prompt }],
    mode: "fast",
  });

  const res = http.post(`${BASE}/api/agent-core/chat`, payload, {
    headers,
    tags: { op: "ai_chat" },
    timeout: "95s",
  });

  aiLatency.add(res.timings.duration);
  aiErrors.add(res.status >= 400);

  check(res, {
    "status is 200": (r) => r.status === 200,
    "has content": (r) => {
      if (r.status !== 200) return false;
      try {
        const body = JSON.parse(r.body);
        return body.content && body.content.length > 0;
      } catch {
        return false;
      }
    },
    "response < 30s": (r) => r.timings.duration < 30000,
    "no timeout hang": (r) => r.timings.duration < 95000,
  });

  sleep(3 + Math.random() * 5);
}
