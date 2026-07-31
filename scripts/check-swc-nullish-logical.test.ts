/**
 * 防止 SWC / TypeScript 拒绝的「空值合并 ?? 与逻辑运算 && / || 混用且无括号」。
 *
 * 非法示例（须被检出）：
 *   a ?? b || c
 *   a || b ?? c
 *   a ?? b && c
 *   a && b ?? c
 *
 * 合法示例（须放行）：
 *   (a ?? b) || c
 *   a ?? (b || c)
 *   (a || b) ?? c
 *
 * 实现边界（非完整 AST）：
 * - 行级扫描：跨行拆开的表达式可能漏检
 * - 先剥离注释/字符串，再按括号层级递归检查：某一层同时出现 ?? 与 &&/|| 即违规
 * - 不等同 TypeScript/ESLint 完整语法分析；目标是低误报回归防护
 *
 * 运行：npx tsx scripts/check-swc-nullish-logical.test.ts
 */
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  rmdirSync,
} from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "out",
]);

function shouldSkipFile(abs: string): boolean {
  const rel = relative(root, abs).replace(/\\/g, "/");
  if (rel.startsWith("..")) return true;
  if (/\.md$/i.test(rel)) return true;
  if (/(?:^|\/)package-lock\.json$|(?:^|\/)pnpm-lock\.yaml$|(?:^|\/)yarn\.lock$/.test(rel)) {
    return true;
  }
  if (/(?:^|\/)ci\/eslint-error-baseline\.json$/.test(rel)) return true;
  if (/\.min\.(?:js|mjs|cjs)$/.test(rel)) return true;
  return false;
}

/** 去掉行注释、块注释、字符串与模板字符串内容，降低误报。 */
function stripNoise(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];

    if (c === "/" && n === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i + 1 < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += " ";
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      out += " ";
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

/** 同一层级片段是否同时含 ?? 与 &&/||（已排除括号与三元分隔）。 */
function fragmentHasNullishLogicalMix(fragment: string): boolean {
  return /\?\?/.test(fragment) && /&&|\|\|/.test(fragment);
}

/**
 * 按本层三元 ? : 切段（忽略 ?? 与 ?.），避免 `cond && x ? a ?? b : c` 误报。
 */
function ternarySegments(flat: string): string[] {
  const PH = "\uE000";
  let s = flat.replace(/\?\?/g, PH + PH);
  s = s.replace(/\?\./g, ".");
  return s.split(/[?:]/).map((part) => part.split(PH).join("?"));
}

/**
 * 在同一括号层级上，若同一三元分支内同时出现 ?? 与 &&/||，则属未加括号混用。
 * 先递归检查子括号内容；再把子括号替换为占位符后检查本层。
 */
function hasUngroupedNullishLogicalMix(expr: string): boolean {
  let i = 0;
  let flat = "";
  while (i < expr.length) {
    if (expr[i] === "(") {
      let depth = 1;
      const start = i + 1;
      i += 1;
      while (i < expr.length && depth > 0) {
        if (expr[i] === "(") depth += 1;
        else if (expr[i] === ")") depth -= 1;
        i += 1;
      }
      const inner = expr.slice(start, i - 1);
      if (hasUngroupedNullishLogicalMix(inner)) return true;
      flat += " ";
      continue;
    }
    if (expr[i] === ")") {
      i += 1;
      continue;
    }
    flat += expr[i];
    i += 1;
  }

  return ternarySegments(flat).some(fragmentHasNullishLogicalMix);
}

type Hit = { file: string; line: number; text: string };

function scanFile(abs: string): Hit[] {
  const rel = relative(root, abs).replace(/\\/g, "/");
  const cleaned = stripNoise(readFileSync(abs, "utf8"));
  const hits: Hit[] = [];
  cleaned.split("\n").forEach((line, idx) => {
    if (hasUngroupedNullishLogicalMix(line)) {
      hits.push({ file: rel, line: idx + 1, text: line.trim().slice(0, 200) });
    }
  });
  return hits;
}

function walk(dir: string, files: string[]) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      walk(abs, files);
      continue;
    }
    if (!CODE_EXT.test(name)) continue;
    if (shouldSkipFile(abs)) continue;
    files.push(abs);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL self-check: ${msg}`);
    process.exit(1);
  }
}

function selfCheck() {
  const illegal = [
    "a ?? b || c",
    "a || b ?? c",
    "a ?? b && c",
    "a && b ?? c",
    "title: String(preview.question ?? preview.contextSnapshot && (preview.contextSnapshot as { title?: string }).title ?? r.actionType),",
  ];
  const legal = [
    "(a ?? b) || c",
    "a ?? (b || c)",
    "(a || b) ?? c",
    "a ?? (b && c)",
    "(a && b) ?? c",
    "const x = a ?? (b && c) ?? d;",
    'const s = "a ?? b || c";',
    "// a ?? b || c",
    "leadingVariantKey: enoughExposure && enoughOutcome ? ranked[0]?.variantKey ?? null : null,",
  ];

  for (const sample of illegal) {
    assert(hasUngroupedNullishLogicalMix(stripNoise(sample)), `must flag: ${sample}`);
  }
  for (const sample of legal) {
    assert(!hasUngroupedNullishLogicalMix(stripNoise(sample)), `must allow: ${sample}`);
  }
}

function probeMustFailThenClean() {
  const probeDir = join(root, "scripts", ".swc-nullish-probe");
  const probeFile = join(probeDir, "probe-bad.ts");
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(probeFile, "export const bad = a ?? b || c;\n", "utf8");
  try {
    const hits = scanFile(probeFile);
    assert(hits.length > 0, "probe file with a ?? b || c must fail detection");
    console.log("  ✓ probe inject → detected");
  } finally {
    if (existsSync(probeFile)) unlinkSync(probeFile);
    try {
      rmdirSync(probeDir);
    } catch {
      /* ignore */
    }
  }
}

function main() {
  console.log("\ncheck-swc-nullish-logical");
  selfCheck();
  console.log("  ✓ self-check samples");
  probeMustFailThenClean();

  const files: string[] = [];
  walk(root, files);

  let hits: Hit[] = [];
  for (const abs of files) {
    hits = hits.concat(scanFile(abs));
  }

  console.log(`  scanned_files=${files.length}`);
  if (hits.length > 0) {
    for (const h of hits) {
      console.error(`FAIL ${h.file}:${h.line}`);
      console.error(`  ${h.text}`);
    }
    console.error(`结果: ${hits.length} dangerous line(s)`);
    process.exit(1);
  }

  console.log("结果: PASS（仓库无未加括号的 ??/&&/|| 混用；回归探测器已启用）");
}

main();
