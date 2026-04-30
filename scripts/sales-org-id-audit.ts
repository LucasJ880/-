/**
 * 销售核心表 orgId 加固 — 静态扫描 + 轻量运行时检查
 * pnpm exec tsx scripts/sales-org-id-audit.ts
 *
 * FAIL：生产 API（src/app/api/sales/**）与 Agent 写路径、外贸 convert 中 create 未写 orgId（启发式）。
 * WARN：脚本 / seed / 无法静态判定。
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { spawnSync } from "child_process";
import { db } from "@/lib/db";

const ROOT = process.cwd();

let failed = 0;
let warned = 0;

const CREATE_PATTERNS = [
  { re: /\bdb\.salesCustomer\.create\s*\(/g, label: "salesCustomer.create" },
  { re: /\bdb\.salesOpportunity\.create\s*\(/g, label: "salesOpportunity.create" },
  { re: /\bdb\.salesQuote\.create\s*\(/g, label: "salesQuote.create" },
  { re: /\bdb\.customerInteraction\.create\s*\(/g, label: "customerInteraction.create" },
];

function ok(name: string) {
  console.log(`OK  ${name}`);
}

function fail(name: string, detail?: string) {
  console.error(`FAIL ${name}`, detail ?? "");
  failed++;
}

function warn(name: string, detail?: string) {
  console.warn(`WARN ${name}`, detail ?? "");
  warned++;
}

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) ok(name);
  else fail(name, detail);
}

function readSchema(): string {
  const p = join(ROOT, "prisma", "schema.prisma");
  return readFileSync(p, "utf8");
}

function extractPrismaModel(schema: string, name: string): string | null {
  const re = new RegExp(`^model\\s+${name}\\s*\\{`, "m");
  const m = schema.match(re);
  if (!m || m.index === undefined) return null;
  const open = schema.indexOf("{", m.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < schema.length; i++) {
    const c = schema[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return schema.slice(m.index, i + 1);
    }
  }
  return null;
}

function fileHasModelOrgId(schema: string, model: string): boolean {
  const block = extractPrismaModel(schema, model);
  if (!block) return false;
  return /\borgId\s+String\?/.test(block);
}

function fileHasIndexOrgId(schema: string, model: string): boolean {
  const block = extractPrismaModel(schema, model);
  if (!block) return false;
  return /@@index\(\[orgId\]\)/.test(block);
}

function walkTsFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTsFiles(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
}

function sliceAfterIndex(content: string, idx: number, maxLen: number): string {
  return content.slice(idx, Math.min(content.length, idx + maxLen));
}

function snippetHasOrgId(snippet: string): boolean {
  return /\borgId\s*:/.test(snippet);
}

function classifyPath(rel: string): "api_sales" | "agent" | "lib_trade_conversion" | "warn" {
  const n = rel.replace(/\\/g, "/");
  if (n.includes("src/app/api/sales/")) return "api_sales";
  if (n.includes("src/lib/agent-core/")) return "agent";
  if (n.includes("src/lib/trade/sales-conversion.ts")) return "lib_trade_conversion";
  if (
    n.includes("/scripts/") ||
    n.includes("prisma/seed") ||
    n.includes("visualizer-smoke") ||
    n.includes(".test.") ||
    n.includes("__tests__")
  )
    return "warn";
  return "warn";
}

function relPath(abs: string): string {
  return relative(ROOT, abs).replace(/\\/g, "/");
}

async function main() {
  console.log("=== audit:sales-org ===\n");

  const schema = readSchema();
  for (const m of ["SalesCustomer", "SalesOpportunity", "SalesQuote", "CustomerInteraction"]) {
    assert(`schema_${m}_orgId_optional_string`, fileHasModelOrgId(schema, m), m);
    assert(`schema_${m}_index_orgId`, fileHasIndexOrgId(schema, m), m);
  }

  const scanRoots = [
    join(ROOT, "src"),
  ];
  const allFiles: string[] = [];
  for (const r of scanRoots) walkTsFiles(r, allFiles);

  const failList: { file: string; label: string; reason: string }[] = [];
  const warnList: { file: string; label: string; reason: string }[] = [];

  for (const abs of allFiles) {
    const rel = relPath(abs);
    const cls = classifyPath(rel);
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    for (const { re, label } of CREATE_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const idx = m.index;
        const snippet = sliceAfterIndex(content, idx, 1200);
        const hasOrg = snippetHasOrgId(snippet);
        if (hasOrg) continue;

        if (cls === "warn") {
          warnList.push({ file: rel, label, reason: "create 未检测到 orgId（或非生产路径）" });
        } else {
          failList.push({
            file: rel,
            label,
            reason: "生产路径 create 未检测到 orgId（启发式；若为变量展开请人工复核）",
          });
        }
      }
    }
  }

  if (warnList.length) {
    console.log("\n--- WARN 清单（不导致退出失败）---");
    for (const w of warnList.slice(0, 60)) {
      console.warn(`WARN ${w.file} :: ${w.label} — ${w.reason}`);
    }
    if (warnList.length > 60) console.warn(`... 另有 ${warnList.length - 60} 条 WARN`);
    warned = warnList.length;
  }

  if (failList.length) {
    console.error("\n--- FAIL 清单 ---");
    for (const f of failList) {
      fail(`${f.file} :: ${f.label}`, f.reason);
    }
  } else {
    ok("scan_no_fail_paths_for_sales_creates_without_orgId");
  }

  const orgCtx = readFileSync(join(ROOT, "src", "lib", "sales", "org-context.ts"), "utf8");
  assert("helper_resolveSalesOrgIdForRequest", /resolveSalesOrgIdForRequest/.test(orgCtx));
  assert("helper_assertSalesCustomerInOrgForMutation", /assertSalesCustomerInOrgForMutation/.test(orgCtx));

  try {
    await db.salesCustomer.findFirst({ select: { orgId: true } });
    await db.salesOpportunity.findFirst({ select: { orgId: true } });
    await db.salesQuote.findFirst({ select: { orgId: true } });
    await db.customerInteraction.findFirst({ select: { orgId: true } });
    ok("prisma_runtime_orgId_select");
  } catch (e) {
    fail("prisma_runtime_orgId_select", e instanceof Error ? e.message : String(e));
  }

  const tsxBin = join(ROOT, "node_modules", ".bin", "tsx");
  const useLocalTsx = existsSync(tsxBin);
  const bf = useLocalTsx
    ? spawnSync(tsxBin, ["scripts/backfill-sales-org-id.ts"], {
        encoding: "utf8",
        cwd: ROOT,
      })
    : spawnSync("npx", ["tsx", "scripts/backfill-sales-org-id.ts"], {
        encoding: "utf8",
        cwd: ROOT,
        shell: true,
      });
  if (bf.status === 0) {
    ok("backfill_dry_run_spawn");
    const out = (bf.stdout || "").trim();
    if (out) console.log("\n--- backfill dry-run stdout（摘要）---\n" + out.slice(0, 2000));
  } else {
    warn("backfill_dry_run_spawn", `exit=${bf.status} stderr=${(bf.stderr || "").slice(0, 400)}`);
  }

  console.log("");
  if (warned) console.warn(`共 ${warned} 条 WARN`);
  if (failed) {
    console.error(`共 ${failed} 项失败`);
    process.exit(1);
  }
  console.log("sales-org 审计通过（WARN 为启发式局限）");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
