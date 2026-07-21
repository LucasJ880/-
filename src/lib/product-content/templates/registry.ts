import type { VisualTemplateSuite } from "./types";
import { AMAZON_REALISM_BATHROBE_V1 } from "./amazon-realism-bathrobe-v1";
import { MINT_PALACE_BEDDING_V1 } from "./mint-palace-bedding-v1";
import { loadImportedTemplateSuites } from "./load-imported";

const suites = new Map<string, VisualTemplateSuite>();
let importedLoaded = false;

export function registerVisualTemplateSuite(
  suite: VisualTemplateSuite,
  opts?: { overwrite?: boolean },
): void {
  if (suites.has(suite.id) && !opts?.overwrite) {
    throw new Error(`套图模板已注册: ${suite.id}`);
  }
  if (suite.shots.length !== suite.shotCount) {
    throw new Error(
      `套图模板 ${suite.id} shotCount=${suite.shotCount} 与 shots.length=${suite.shots.length} 不一致`,
    );
  }
  suites.set(suite.id, suite);
}

export function listVisualTemplateSuites(): VisualTemplateSuite[] {
  ensureBuiltinTemplateSuitesRegistered();
  return [...suites.values()];
}

export function getVisualTemplateSuite(id: string): VisualTemplateSuite | null {
  ensureBuiltinTemplateSuitesRegistered();
  return suites.get(id) ?? null;
}

function loadImportedOnce(): void {
  if (importedLoaded) return;
  importedLoaded = true;
  for (const suite of loadImportedTemplateSuites()) {
    if (suites.has(suite.id)) {
      console.warn(`[templates] 导入套图 id 与内置冲突，跳过: ${suite.id}`);
      continue;
    }
    suites.set(suite.id, suite);
  }
}

const BUILTIN_SUITES = [AMAZON_REALISM_BATHROBE_V1, MINT_PALACE_BEDDING_V1];

/** 启动时注册内置 + 已导入模版 */
export function ensureBuiltinTemplateSuitesRegistered(): void {
  for (const suite of BUILTIN_SUITES) {
    if (!suites.has(suite.id)) {
      registerVisualTemplateSuite(suite);
    }
  }
  loadImportedOnce();
}

/** 测试/导入脚本用：清空后重载 */
export function resetTemplateSuiteRegistryForTests(): void {
  suites.clear();
  importedLoaded = false;
}

ensureBuiltinTemplateSuitesRegistered();
