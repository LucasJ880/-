#!/usr/bin/env node
/**
 * ESLint 历史债务基线门禁
 *
 * 用法：
 *   node scripts/check-eslint-baseline.mjs              # 检查（CI）
 *   node scripts/check-eslint-baseline.mjs --generate    # 从当前树生成基线（仅维护用）
 *
 * 指纹：repoRelativePath + ruleId + normalizedMessage
 * 行号/列号不参与身份。
 *
 * 退出码：0 通过；1 失败；2 ESLint/配置无法执行
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = join(ROOT, "ci/eslint-error-baseline.json");
const SOURCE_COMMIT = "2255f8da919c883bc9e2f210209782c40ee5eaae";

const mode = process.argv.includes("--generate") ? "generate" : "check";

function normalizeMessage(message) {
  return String(message || "")
    .replace(/\s+/g, " ")
    .trim();
}

function toRepoPath(absPath) {
  const rel = relative(ROOT, absPath);
  return rel.split(sep).join("/");
}

function fingerprint(filePath, ruleId, message) {
  return `${filePath}\u0000${ruleId || "no-rule"}\u0000${normalizeMessage(message)}`;
}

function runEslintJson() {
  const outDir = mkdtempSync(join(tmpdir(), "qy-eslint-"));
  const jsonPath = join(outDir, "eslint.json");
  // 完整扫描；错误时 ESLint 仍写 JSON（exit 1）
  const r = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["eslint", ".", "-f", "json", "-o", jsonPath],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    },
  );

  if (r.error) {
    console.error("[eslint-baseline] ESLint 无法启动:", r.error.message);
    process.exit(2);
  }

  // 配置失败等：无输出文件
  if (!existsSync(jsonPath)) {
    console.error("[eslint-baseline] ESLint 未写出 JSON（配置加载失败？）");
    if (r.stderr) console.error(r.stderr);
    if (r.stdout) console.error(r.stdout);
    process.exit(2);
  }

  let results;
  try {
    results = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (e) {
    console.error("[eslint-baseline] ESLint JSON 解析失败:", e.message);
    process.exit(2);
  }

  if (!Array.isArray(results)) {
    console.error("[eslint-baseline] ESLint JSON 格式异常（期望数组）");
    process.exit(2);
  }

  return { results, eslintStatus: r.status ?? 1 };
}

function collect(results) {
  /** @type {Map<string, { filePath: string, ruleId: string, message: string, count: number }>} */
  const errors = new Map();
  let errorCount = 0;
  let warningCount = 0;

  for (const file of results) {
    const filePath = toRepoPath(file.filePath);
    for (const m of file.messages || []) {
      if (m.severity === 1) {
        warningCount += 1;
        continue;
      }
      if (m.severity !== 2) continue;
      errorCount += 1;
      const fp = fingerprint(filePath, m.ruleId, m.message);
      const prev = errors.get(fp);
      if (prev) prev.count += 1;
      else {
        errors.set(fp, {
          filePath,
          ruleId: m.ruleId || "no-rule",
          message: normalizeMessage(m.message),
          count: 1,
        });
      }
    }
  }

  return { errors, errorCount, warningCount };
}

function baselineObject(collected) {
  const fingerprints = {};
  for (const [fp, meta] of [...collected.errors.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    fingerprints[fp] = {
      filePath: meta.filePath,
      ruleId: meta.ruleId,
      message: meta.message,
      count: meta.count,
    };
  }
  return {
    version: 1,
    sourceCommit: SOURCE_COMMIT,
    generatedAt: new Date().toISOString(),
    fingerprintRule:
      "repoRelativePath + NUL + ruleId + NUL + whitespace-normalized message (line/column excluded)",
    errorCount: collected.errorCount,
    warningCount: collected.warningCount,
    fingerprintCount: Object.keys(fingerprints).length,
    fingerprints,
  };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`[eslint-baseline] 缺少基线文件: ${BASELINE_PATH}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function changedFilesVsSourceCommit() {
  const r = spawnSync(
    "git",
    ["diff", "--name-only", `${SOURCE_COMMIT}...HEAD`],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.warn(
      "[eslint-baseline] 无法列出相对 sourceCommit 的变更文件，跳过「PR 改动文件」附加检查",
    );
    return new Set();
  }
  return new Set(
    r.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function loadBaselineFromGit(ref) {
  const r = spawnSync("git", ["show", `${ref}:${"ci/eslint-error-baseline.json"}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function checkBaselineExpansion(currentBaselineFile) {
  // 相对 origin/main（或 main）若基线指纹被扩大且无批准 env，则失败
  const parent =
    process.env.ESLINT_BASELINE_PARENT_REF ||
    (spawnSync("git", ["rev-parse", "--verify", "origin/main"], {
      cwd: ROOT,
      encoding: "utf8",
    }).status === 0
      ? "origin/main"
      : "main");

  const old = loadBaselineFromGit(parent);
  if (!old || !old.fingerprints) {
    console.log(
      `[eslint-baseline] 父引用 ${parent} 无旧基线（首次引入），跳过扩大检查`,
    );
    return [];
  }

  const failures = [];
  const allow = process.env.ALLOW_ESLINT_BASELINE_UPDATE === "true";
  for (const [fp, meta] of Object.entries(currentBaselineFile.fingerprints)) {
    const prev = old.fingerprints[fp];
    if (!prev) {
      failures.push(`基线新增 fingerprint: ${meta.filePath} | ${meta.ruleId}`);
      continue;
    }
    if ((meta.count || 0) > (prev.count || 0)) {
      failures.push(
        `基线扩大 count ${prev.count}→${meta.count}: ${meta.filePath} | ${meta.ruleId}`,
      );
    }
  }
  if (failures.length && !allow) {
    console.error(
      "[eslint-baseline] 基线文件被扩大，但未设置 ALLOW_ESLINT_BASELINE_UPDATE=true",
    );
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "更新基线需产品/工程批准，并在文档中记录原因；批准后以该 env 重跑。",
    );
    process.exit(1);
  }
  if (failures.length && allow) {
    console.warn(
      "[eslint-baseline] ALLOW_ESLINT_BASELINE_UPDATE=true：允许基线扩大",
    );
  }
  return failures;
}

function main() {
  console.log(`[eslint-baseline] mode=${mode}`);
  console.log(`[eslint-baseline] sourceCommit=${SOURCE_COMMIT}`);

  const { results } = runEslintJson();
  const collected = collect(results);

  if (mode === "generate") {
    // 生成前确认相对 sourceCommit 无 src 业务漂移（可复核）
    const srcDiff = spawnSync(
      "git",
      ["diff", "--name-only", SOURCE_COMMIT, "--", "src"],
      { cwd: ROOT, encoding: "utf8" },
    );
    const srcFiles = (srcDiff.stdout || "").trim();
    if (srcFiles) {
      console.error(
        "[eslint-baseline] 拒绝生成：工作树相对 sourceCommit 仍有 src/ 差异",
      );
      console.error(srcFiles);
      process.exit(1);
    }

    const obj = baselineObject(collected);
    mkdirSync(join(ROOT, "ci"), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(obj, null, 2) + "\n", "utf8");
    console.log(`[eslint-baseline] wrote ${BASELINE_PATH}`);
    console.log(
      `[eslint-baseline] errors=${obj.errorCount} warnings=${obj.warningCount} fingerprints=${obj.fingerprintCount}`,
    );
    process.exit(0);
  }

  // check mode
  const baseline = loadBaseline();
  if (baseline.sourceCommit !== SOURCE_COMMIT) {
    console.warn(
      `[eslint-baseline] 警告：基线 sourceCommit=${baseline.sourceCommit} 与脚本常量不一致`,
    );
  }

  // 若本 PR 改了基线文件，检查是否非法扩大（相对 main）
  const changed = changedFilesVsSourceCommit();
  if (changed.has("ci/eslint-error-baseline.json")) {
    checkBaselineExpansion(baseline);
  }

  /** @type {Map<string, number>} */
  const baseCounts = new Map();
  for (const [fp, meta] of Object.entries(baseline.fingerprints || {})) {
    baseCounts.set(fp, meta.count || 0);
  }

  const newFingerprints = [];
  const increased = [];
  const prFileNew = [];

  for (const [fp, meta] of collected.errors.entries()) {
    const baseCount = baseCounts.get(fp);
    if (baseCount == null) {
      newFingerprints.push(meta);
      if (changed.has(meta.filePath)) prFileNew.push(meta);
      continue;
    }
    if (meta.count > baseCount) {
      increased.push({ ...meta, baseCount });
      if (changed.has(meta.filePath)) prFileNew.push(meta);
    }
  }

  console.log(
    `[eslint-baseline] current errors=${collected.errorCount} warnings=${collected.warningCount} fingerprints=${collected.errors.size}`,
  );
  console.log(
    `[eslint-baseline] baseline errors=${baseline.errorCount} warnings=${baseline.warningCount} fingerprints=${baseline.fingerprintCount}`,
  );

  let failed = false;

  if (newFingerprints.length) {
    failed = true;
    console.error(
      `\n[eslint-baseline] FAIL: ${newFingerprints.length} 个基线中不存在的新 error fingerprint`,
    );
    for (const m of newFingerprints.slice(0, 50)) {
      console.error(`  NEW ${m.filePath} | ${m.ruleId} | ${m.message}`);
    }
    if (newFingerprints.length > 50) {
      console.error(`  … 另有 ${newFingerprints.length - 50} 条`);
    }
  }

  if (increased.length) {
    failed = true;
    console.error(
      `\n[eslint-baseline] FAIL: ${increased.length} 个 fingerprint 出现次数超过基线`,
    );
    for (const m of increased.slice(0, 50)) {
      console.error(
        `  INC ${m.filePath} | ${m.ruleId} | count ${m.baseCount}→${m.count} | ${m.message}`,
      );
    }
  }

  if (prFileNew.length) {
    failed = true;
    console.error(
      `\n[eslint-baseline] FAIL: PR 相对 ${SOURCE_COMMIT.slice(0, 7)} 改动的文件出现新增/增多 lint error`,
    );
    for (const m of prFileNew.slice(0, 50)) {
      console.error(`  PRFILE ${m.filePath} | ${m.ruleId} | ${m.message}`);
    }
  }

  // 旧债减少：允许（仅信息）
  let resolved = 0;
  for (const [fp, baseCount] of baseCounts.entries()) {
    const cur = collected.errors.get(fp)?.count || 0;
    if (cur < baseCount) resolved += baseCount - cur;
  }
  if (resolved > 0) {
    console.log(
      `[eslint-baseline] 信息：相对基线减少了 ${resolved} 处 error 出现（允许）`,
    );
  }

  if (failed) {
    console.error("\n[eslint-baseline] 门禁失败。完整 ESLint 日志见上一「Lint」步骤。");
    process.exit(1);
  }

  console.log("[eslint-baseline] PASS（无新增 error fingerprint / 无 count 上升）");
  process.exit(0);
}

main();
