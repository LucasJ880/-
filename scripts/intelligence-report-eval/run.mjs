#!/usr/bin/env node

/**
 * intelligence_report 批量评估脚本
 *
 * 读取 sample-input-*.json → 调用 OpenAI → 保存结果 → 生成评估汇总
 *
 * 用法：
 *   OPENAI_API_KEY=sk-xxx node scripts/intelligence-report-eval/run.mjs
 *
 * 可选环境变量：
 *   OPENAI_BASE_URL               默认 https://api.openai.com/v1
 *   OPENAI_MODEL_INTELLIGENCE_REPORT   默认 gpt-5.2
 *   OPENAI_MAX_TOKENS_INTELLIGENCE_REPORT  默认 16384
 *   OPENAI_TEMPERATURE_INTELLIGENCE_REPORT 默认 0.3
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = __dirname;
const ARTIFACTS_DIR = join(dirname(dirname(__dirname)), "artifacts", "intelligence-report-eval");

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("ERROR: OPENAI_API_KEY 未设置");
  process.exit(1);
}

const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const MODEL = process.env.OPENAI_MODEL_INTELLIGENCE_REPORT || process.env.OPENAI_MODEL || "gpt-5.2";
const MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS_INTELLIGENCE_REPORT || "16384");
const TEMPERATURE = parseFloat(process.env.OPENAI_TEMPERATURE_INTELLIGENCE_REPORT || "0.3");
const PROMPT_VERSION = "intelligence_report_v2";

// ── SYSTEM_PROMPT（与 ai-intelligence.ts 保持一致）──────────

const SYSTEM_PROMPT = readSystemPrompt();

function readSystemPrompt() {
  // 从 ai-intelligence.ts 同步的核心 prompt
  return `你是"青砚"的投标情报分析助手。

你的任务不是像普通聊天机器人一样解释文件内容，而是基于用户提供的招标文件、附件、项目说明和平台信息，生成一份可用于决策和执行的"投标深度情报分析报告"。

## 核心目标
1. 帮助用户快速判断该项目是否值得继续跟进；
2. 帮助用户识别技术、合规、商务、供应链和执行层面的关键风险；
3. 帮助用户形成下一步行动方案，而不是停留在泛泛分析；
4. 让输出结果尽量接近专业投标顾问或情报经理交付的完成品。

## 分析原则（必须严格遵守）
1. 不要只复述原文，要做提炼、归纳、比较、判断。
2. 对关键条款尽量引用原始信息并说明其影响。
3. 对每个重要判断，区分"已知事实 / 推断 / 待确认项"。
4. 若资料不完整，也要给出阶段性分析，不要只说"信息不足"。
5. 优先输出可执行结果，包括风险、建议、行动项、负责人建议、截止建议。
6. 分析必须贴合中国供应链 / 北美项目落地的现实，而不是纯理论判断。
7. 输出应专业、清晰、结构化，避免空话、套话、泛泛而谈。
8. 如果发现致命红线、重大合规障碍、明显不适合投标，应明确指出，而不是模糊表达。
9. 如果项目可做，也不能只说"建议参与"，必须说明为什么、难点在哪、先做什么。
10. 你的输出必须是一份"报告"，不是聊天回复。

## 输出格式
返回纯 JSON，不要包含 markdown 代码块或其他文本。

{
  "recommendation": "pursue | review_carefully | low_probability | skip",
  "riskLevel": "low | medium | high",
  "fitScore": 0-100,
  "summary": "执行摘要的浓缩版，2-3句话，以'建议投标/审慎评估/建议放弃'开头",
  "reportMarkdown": "完整的12章节分析报告（Markdown格式）",
  "fullReport": { "title": "投标深度情报分析报告", "description": "项目概述", "strengths": [], "weaknesses": [], "requirements_met": [], "requirements_gap": [], "competitive_landscape": "", "pricing_guidance": "", "timeline_notes": "" }
}

## reportMarkdown 必须包含以下 12 个章节
一、项目概览 / 二、执行摘要 / 三、原始需求提炼 / 四、技术要求评估 / 五、商务与投标条件评估 / 六、合规与致命红线 / 七、中国供应链与采购可行性分析 / 八、竞争力判断 / 九、GO/NO-GO 决策矩阵 / 十、待确认问题清单 / 十一、建议下一步行动 / 十二、最终结论`;
}

// ── 章节验证 ─────────────────────────────────────────────────

const CHAPTER_PATTERNS = [
  /一、|项目概览/,
  /二、|执行摘要/,
  /三、|需求提炼/,
  /四、|技术要求/,
  /五、|商务/,
  /六、|合规|致命红线/,
  /七、|供应链|采购可行性/,
  /八、|竞争力/,
  /九、|GO.*NO-GO|决策矩阵/,
  /十、|待确认/,
  /十一|行动/,
  /十二|最终结论/,
];

function countChapters(markdown) {
  let count = 0;
  for (const p of CHAPTER_PATTERNS) {
    if (p.test(markdown)) count++;
  }
  return count;
}

// ── OpenAI 调用 ──────────────────────────────────────────────

async function callOpenAI(userPrompt) {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "developer", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
    }),
  });

  const elapsedMs = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  const finishReason = data.choices?.[0]?.finish_reason ?? null;

  return { content, finishReason, elapsedMs };
}

// ── JSON 解析 ────────────────────────────────────────────────

function tryParseJson(raw) {
  let cleaned = raw.trim();
  const fenceStart = cleaned.indexOf("```");
  if (fenceStart !== -1) {
    const afterFence = cleaned.indexOf("\n", fenceStart);
    const fenceEnd = cleaned.lastIndexOf("```");
    if (afterFence !== -1 && fenceEnd > afterFence) {
      cleaned = cleaned.slice(afterFence + 1, fenceEnd).trim();
    }
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ── 构建 user prompt ────────────────────────────────────────

function buildUserPrompt(sample) {
  const lines = [`项目名称: ${sample.projectName}`];
  if (sample.projectDesc) lines.push(`项目描述: ${sample.projectDesc}`);
  lines.push("", "以下是项目相关文档的内容：", "");

  for (const doc of sample.documents) {
    lines.push(`### 文档: ${doc.title}`);
    if (doc.aiSummaryJson) {
      lines.push("AI 结构化摘要:");
      lines.push(doc.aiSummaryJson);
    }
    if (doc.contentText) {
      lines.push("原文摘录:");
      lines.push(doc.contentText);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("请基于以上全部文档内容，生成完整的 12 章节投标深度情报分析报告。返回纯 JSON。");
  return lines.join("\n");
}

// ── 主流程 ───────────────────────────────────────────────────

async function main() {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const sampleFiles = readdirSync(SAMPLES_DIR).filter((f) => f.startsWith("sample-input-") && f.endsWith(".json"));

  if (sampleFiles.length === 0) {
    console.error("未找到 sample-input-*.json 文件");
    process.exit(1);
  }

  console.log(`找到 ${sampleFiles.length} 个样例，开始评估...\n`);
  console.log(`模型: ${MODEL} | 温度: ${TEMPERATURE} | maxTokens: ${MAX_TOKENS}\n`);

  const summaryRows = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  for (const file of sampleFiles) {
    const sampleName = file.replace(".json", "");
    console.log(`▶ ${sampleName}`);

    const sample = JSON.parse(readFileSync(join(SAMPLES_DIR, file), "utf-8"));
    const userPrompt = buildUserPrompt(sample);

    let result;
    try {
      result = await callOpenAI(userPrompt);
    } catch (err) {
      console.error(`  ✗ API 调用失败: ${err.message}`);
      summaryRows.push({
        sample_name: sampleName,
        description: sample.description,
        status: "api_error",
        error: err.message,
        prompt_version: PROMPT_VERSION,
        model_used: MODEL,
      });
      continue;
    }

    console.log(`  耗时: ${result.elapsedMs}ms | finishReason: ${result.finishReason}`);

    const parsed = tryParseJson(result.content);
    const chapterCount = parsed?.reportMarkdown ? countChapters(parsed.reportMarkdown) : 0;
    const structurePass = chapterCount >= 8;

    // 保存完整输出
    const outputFile = `${sampleName}_${timestamp}.json`;
    writeFileSync(
      join(ARTIFACTS_DIR, outputFile),
      JSON.stringify(
        {
          sample_name: sampleName,
          description: sample.description,
          meta: {
            prompt_version: PROMPT_VERSION,
            model_used: MODEL,
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
            generation_time_ms: result.elapsedMs,
            finish_reason: result.finishReason,
            chapter_count: chapterCount,
            structure_pass: structurePass,
          },
          parsed,
          raw: result.content,
        },
        null,
        2,
      ),
    );

    // 保存 markdown 报告
    if (parsed?.reportMarkdown) {
      const mdFile = `${sampleName}_${timestamp}.md`;
      writeFileSync(join(ARTIFACTS_DIR, mdFile), parsed.reportMarkdown);
    }

    const row = {
      sample_name: sampleName,
      description: sample.description,
      status: parsed ? "success" : "json_parse_error",
      prompt_version: PROMPT_VERSION,
      model_used: MODEL,
      used_fallback: false,
      generation_time_ms: result.elapsedMs,
      finish_reason: result.finishReason,
      recommendation: parsed?.recommendation ?? null,
      fitScore: parsed?.fitScore ?? null,
      riskLevel: parsed?.riskLevel ?? null,
      chapter_count: chapterCount,
      structure_pass: structurePass,
      report_length: parsed?.reportMarkdown?.length ?? 0,
      suggest_human_pass: structurePass && parsed?.recommendation != null,
    };

    summaryRows.push(row);

    console.log(`  recommendation: ${row.recommendation} | fitScore: ${row.fitScore} | 章节: ${chapterCount}/12 ${structurePass ? "✓" : "✗"}`);
    console.log(`  输出: ${outputFile}\n`);
  }

  // 写入汇总 JSON
  const summaryJsonFile = `summary_${timestamp}.json`;
  writeFileSync(join(ARTIFACTS_DIR, summaryJsonFile), JSON.stringify(summaryRows, null, 2));

  // 写入汇总 Markdown
  const summaryMdFile = `summary_${timestamp}.md`;
  let md = `# Intelligence Report 评估汇总\n\n`;
  md += `- 时间: ${new Date().toLocaleString("zh-CN")}\n`;
  md += `- 模型: ${MODEL}\n`;
  md += `- Prompt版本: ${PROMPT_VERSION}\n`;
  md += `- 温度: ${TEMPERATURE} | maxTokens: ${MAX_TOKENS}\n\n`;
  md += `| 样例 | 状态 | 推荐 | fitScore | 风险 | 章节 | 耗时(s) | 建议通过 |\n`;
  md += `|------|------|------|----------|------|------|---------|----------|\n`;

  for (const r of summaryRows) {
    md += `| ${r.sample_name} | ${r.status} | ${r.recommendation ?? "-"} | ${r.fitScore ?? "-"} | ${r.riskLevel ?? "-"} | ${r.chapter_count ?? "-"}/12 | ${r.generation_time_ms ? (r.generation_time_ms / 1000).toFixed(1) : "-"} | ${r.suggest_human_pass ? "是" : "否"} |\n`;
  }

  writeFileSync(join(ARTIFACTS_DIR, summaryMdFile), md);

  console.log("═".repeat(60));
  console.log(`评估完成。结果保存在: artifacts/intelligence-report-eval/`);
  console.log(`汇总: ${summaryJsonFile}`);
  console.log(`报告: ${summaryMdFile}`);
}

main().catch((err) => {
  console.error("评估脚本异常:", err);
  process.exit(1);
});
