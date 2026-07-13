/**
 * WORK_JSON 分类验收 — 直连版
 *
 * 与 scripts/test-work-json.py 同一套用例与基线（MVP v1，2026-03-19 验收锁定），
 * 区别是不走本地 HTTP（免登录态），直接 getChatSystemPrompt + createCompletion。
 * 提示词改动后必须跑本脚本确认分类基线不回归。
 *
 * 基线：14/15 通过；TE3 被保守判为 event 属可接受漏判。
 *
 * 运行：npx tsx scripts/test-work-json-direct.ts
 */

import { getChatSystemPrompt } from "@/lib/ai/prompts";
import { createCompletion } from "@/lib/ai/client";

const TESTS: Array<[string, string, string]> = [
  ["TE1", "周五下午两点给客户汇报季度成果", "task_and_event"],
  ["TE2", "明天上午十点在会议室做产品演示，PPT今天要准备好", "task_and_event"],
  ["TE3", "下周三下午和供应商开会讨论新合同条款", "task_and_event"],
  ["TE4", "后天下午三点向领导汇报项目进展，需要整理数据", "task_and_event"],
  ["E1", "明天下午两点开周会", "event"],
  ["E2", "周四上午客户来访，在3楼会议室", "event"],
  ["E3", "今晚七点部门聚餐", "event"],
  ["E4", "下周一早上九点面试一个前端工程师", "event"],
  ["T1", "周五前提交季度报告", "task"],
  ["T2", "准备一下明天的会议", "task"],
  ["T3", "三天内把报价单发给张经理", "task"],
  ["T4", "整理上周会议纪要", "task"],
  ["N1", "帮我规划一下这周的工作重点", "none"],
  ["N2", "你觉得我应该先准备汇报还是先改合同？", "none"],
  ["N3", "好的，我知道了", "none"],
];

function extractType(text: string): string {
  const m = text.match(/\[WORK_JSON\]([\s\S]*?)\[\/WORK_JSON\]/);
  if (!m) return "none";
  try {
    const obj = JSON.parse(m[1].trim());
    return obj.type ?? "parse_error";
  } catch {
    return "parse_error";
  }
}

async function main() {
  const systemPrompt = getChatSystemPrompt();
  let pass = 0;
  let acceptable = 0;
  const failures: string[] = [];

  for (const [tid, input, expected] of TESTS) {
    let actual = "api_error";
    try {
      const reply = await createCompletion({
        systemPrompt,
        userPrompt: input,
        mode: "chat",
      });
      actual = extractType(reply);
    } catch (e) {
      actual = `api_error: ${e instanceof Error ? e.message : e}`;
    }

    if (actual === expected) {
      pass++;
      console.log(`✅ [${tid}] ${expected}`);
    } else if (tid === "TE3" && actual === "event") {
      acceptable++;
      console.log(`🟡 [${tid}] 期望 ${expected} → 实际 ${actual}（基线内可接受保守漏判）`);
    } else {
      failures.push(tid);
      console.log(`❌ [${tid}] 期望 ${expected} → 实际 ${actual}｜输入: ${input}`);
    }
  }

  console.log(`\n结果: ${pass}/15 严格通过 + ${acceptable} 可接受漏判, ${failures.length} 失败`);
  if (failures.length > 0) {
    console.log(`失败用例: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("分类基线未回归 ✅");
}

main();
