/**
 * QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 repo scanner for architecture guards.
 *
 * Pure I/O helper: walks the repository and returns file text keyed by
 * posix-relative path. All guard logic lives in guards.ts as pure functions
 * over this structure, so negative tests can feed synthetic scans.
 *
 * Scope rules (deterministic):
 * - includes src/(any).ts|tsx plus prisma/schema.prisma
 * - excludes __tests__ directories and *.test.ts files (tests are not
 *   runtime surface)
 * - excludes src/lib/runtime-architecture/** (governance metadata itself;
 *   its sources quote the guarded tokens)
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

export interface RepoScan {
  /** posix relative path -> file text */
  files: Map<string, string>;
}

const EXCLUDED_DIR_NAMES = new Set(["__tests__", "node_modules", ".next"]);
const EXCLUDED_PREFIXES = ["src/lib/runtime-architecture/"];

export function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function shouldIncludeFile(rel: string): boolean {
  if (!(rel.endsWith(".ts") || rel.endsWith(".tsx"))) return false;
  if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
  if (rel.endsWith(".d.ts")) return false;
  for (const prefix of EXCLUDED_PREFIXES) {
    if (rel.startsWith(prefix)) return false;
  }
  return true;
}

function walk(absDir: string, root: string, out: Map<string, string>): void {
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const entry of entries.sort()) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const abs = join(absDir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(abs, root, out);
    } else if (st.isFile()) {
      const rel = toPosix(relative(root, abs));
      if (shouldIncludeFile(rel)) {
        out.set(rel, readFileSync(abs, "utf8"));
      }
    }
  }
}

export function scanRepo(root: string = process.cwd()): RepoScan {
  const files = new Map<string, string>();
  walk(join(root, "src"), root, files);
  try {
    files.set(
      "prisma/schema.prisma",
      readFileSync(join(root, "prisma", "schema.prisma"), "utf8"),
    );
  } catch {
    // schema absent: guards over prisma simply see no models
  }
  return { files };
}

/** Extract every static/dynamic import + require specifier from a TS source. */
export function extractImportSpecifiers(text: string): string[] {
  const out: string[] = [];
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/**
 * Resolve an import specifier to a top-level `src/lib/<module>` name.
 * Returns null when the target is not under src/lib.
 */
export function resolveTopLibModule(
  specifier: string,
  fromFile: string,
): string | null {
  if (specifier.startsWith("@/lib/")) {
    return specifier.slice("@/lib/".length).split("/")[0] || null;
  }
  if (specifier.startsWith(".")) {
    const fromDir = fromFile.split("/").slice(0, -1);
    const parts = specifier.split("/");
    const stack = [...fromDir];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    const resolved = stack.join("/");
    if (resolved.startsWith("src/lib/")) {
      return resolved.slice("src/lib/".length).split("/")[0] || null;
    }
    return null;
  }
  return null;
}

/** Basename without extension, e.g. "src/lib/x/plan-compile.ts" -> "plan-compile". */
export function baseNameNoExt(rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  return base.replace(/\.(ts|tsx)$/, "");
}

/** Hyphen/underscore/dot-separated whole-token match on a basename. */
export function basenameHasToken(basename: string, token: string): boolean {
  return basename.split(/[-_.]/).includes(token);
}
