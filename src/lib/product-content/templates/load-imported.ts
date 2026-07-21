/**
 * 运行时加载已导入的授权模版（public/product-content-templates/<id>/suite.json）
 */

import fs from "fs";
import path from "path";
import type { VisualTemplateSuite } from "./types";

const PUBLIC_ROOT = path.join(process.cwd(), "public", "product-content-templates");

/** 仍由 TS 内置注册的目录，避免与 suite.json 重复 */
const BUILTIN_DIR_SKIP = new Set(["amazon-realism-bathrobe-v1"]);

function isSuiteJson(value: unknown): value is VisualTemplateSuite {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<VisualTemplateSuite>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.shots) &&
    typeof v.shotCount === "number"
  );
}

export function listImportedSuiteJsonPaths(): string[] {
  if (!fs.existsSync(PUBLIC_ROOT)) return [];
  const entries = fs.readdirSync(PUBLIC_ROOT, { withFileTypes: true });
  const paths: string[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith("_")) continue;
    if (BUILTIN_DIR_SKIP.has(ent.name)) continue;
    const suitePath = path.join(PUBLIC_ROOT, ent.name, "suite.json");
    if (fs.existsSync(suitePath)) paths.push(suitePath);
  }
  return paths;
}

export function loadImportedTemplateSuites(): VisualTemplateSuite[] {
  const out: VisualTemplateSuite[] = [];
  for (const file of listImportedSuiteJsonPaths()) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (!isSuiteJson(raw)) {
        console.warn(`[templates] 跳过非法 suite.json: ${file}`);
        continue;
      }
      if (raw.shots.length !== raw.shotCount) {
        raw.shotCount = raw.shots.length;
      }
      out.push(raw);
    } catch (err) {
      console.warn(`[templates] 读取失败 ${file}:`, err);
    }
  }
  return out;
}
