/**
 * FIX-21 目录守卫：src/app/api/projects/[id]/ 下每个路由文件的每个处理函数都先过项目级权限检查（无 DB，CI 里跑）
 *   npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts
 *
 * 这个目录下曾有 8 个处理函数只查「已登录」（FIX-17 补了 files/ 下 2 个，FIX-21 补了情报与一键投标方案 6 个）。
 * 每次运行都现场枚举目录下全部 route.ts / route.tsx，不维护路由清单：以后新加的接口写法合规就通过，
 * 不用改这里的任何名单；漏了检查或检查写得不牢就失败，并点名文件、方法与缺的是什么。
 *
 * 用 TypeScript 编译器按语法树判断（注释里的字不算数，守卫按导入它的模块与原始导出名认定）。规则见
 * openspec/changes/project-intel-bidpackage-access/design.md D9：
 *   1. 认不出处理函数正文的导出写法判失败（export { … } / export * from / export const GET = 变量 / withAuth(函数名)）；
 *   2. 处理函数里必须调用 GUARDS 名单里的一个守卫；
 *   3. 第一次调用守卫之前不得出现 db. / 文件存储 / 解析 / 模型 / 建任务 / 入队 / 发通知 / 写审计；
 *   4. 第一次调用守卫之前，await 只能是取路由参数与读请求体（含 .catch(…)）；
 *   5. 守卫的返回值赋给一个变量并被检查（instanceof NextResponse / isAccessError / 布尔守卫 if (!x)）；
 *   6. 第一次调用守卫的语句是处理函数正文的顶层语句 const x = await 守卫(…)；
 *   7. 紧接着的下一条语句就是第 5 条的检查；
 *   8. 守卫的项目参数（第二个参数）是解构路由参数里 id 这个键得到的变量；
 *   9. 例外名单里的接口按「已下线」检查；例外文件不存在也判失败；
 *  10. 防空跑：至少 170 个路由文件、240 个处理函数，FIX-21 的 4 个文件都在。
 * 它只证明「先调了守卫」；被拒时不改数据、不调模型、不发通知由 intel-bidpackage-access-db.isolated.test.ts 证明。
 * FIX-17 的 files-route-guard.test.ts 对 files/ 更严（守卫必须是取参数后的第一个 await），两份并存。
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

const ROUTES_DIR = "src/app/api/projects/[id]";
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/**
 * 守卫名单：每一个都读过代码，确认里面包含项目可见性判断（直接调读 / 写守卫，或按同样的规则自己判）。
 * 按「来源模块 + 原始导出名」认定；同名但从别处导入的函数不算。
 * 新接口用了名单以外的守卫时，在同一个 PR 里把它连同出处加进来。
 */
type GuardKind = "response" | "boolean";
type Guard = { module: string; name: string; kind: GuardKind; ref: string; note: string };
export const GUARDS: readonly Guard[] = [
  { module: "@/lib/projects/access", name: "requireProjectReadAccess", kind: "response", ref: "src/lib/projects/access.ts:116", note: "项目读权限：super_admin、负责人、组织所有者 / 管理员、active 项目成员；未分发项目只给 super_admin" },
  { module: "@/lib/projects/access", name: "requireProjectWriteAccess", kind: "response", ref: "src/lib/projects/access.ts:54", note: "项目写权限：super_admin、负责人、组织所有者 / 管理员；项目有组织时加项目管理员" },
  { module: "@/lib/projects/access", name: "requireProjectManageAccess", kind: "response", ref: "src/lib/projects/access.ts:168", note: "就是写权限" },
  { module: "@/lib/projects/diagnostic-access", name: "requireDiagnosticProjectReadAccess", kind: "response", ref: "src/lib/projects/diagnostic-access.ts:15", note: "先判平台管理员，再转调项目读权限" },
  { module: "@/lib/projects/diagnostic-access", name: "requireDiagnosticProjectManageAccess", kind: "response", ref: "src/lib/projects/diagnostic-access.ts:24", note: "先判平台管理员，再转调项目管理（写）权限" },
  { module: "@/lib/tender-auto-analysis/api-access", name: "requireTenderAnalysisRead", kind: "response", ref: "src/lib/tender-auto-analysis/api-access.ts:19", note: "直接转调项目读权限" },
  { module: "@/lib/tender-auto-analysis/api-access", name: "requireTenderAnalysisWrite", kind: "response", ref: "src/lib/tender-auto-analysis/api-access.ts:27", note: "直接转调项目写权限" },
  { module: "@/lib/quote-engine/access", name: "requireQuoteAccess", kind: "response", ref: "src/lib/quote-engine/access.ts:34", note: "先判开关，再判项目读权限，再判报价能力" },
  { module: "@/lib/project-finance/access", name: "requireCostAccess", kind: "response", ref: "src/lib/project-finance/access.ts:117", note: "先判开关，再判项目读权限；读权限 403 时只给本组织、已分发、持财务键的人另开只读入口（:99-115）" },
  { module: "@/lib/tender-import-leads/api-access", name: "requireImportLeadsRead", kind: "response", ref: "src/lib/tender-import-leads/api-access.ts:17", note: "先项目读权限，再判组织成员与开关" },
  { module: "@/lib/tender-import-leads/api-access", name: "requireImportLeadsWrite", kind: "response", ref: "src/lib/tender-import-leads/api-access.ts:27", note: "在 requireImportLeadsRead 之上再判项目写权限" },
  { module: "@/lib/project-discussion/access", name: "canViewProjectDiscussion", kind: "boolean", ref: "src/lib/project-discussion/access.ts:68", note: "返回布尔：项目存在、未分发只给 super_admin、负责人 / active 成员 / 组织管理员" },
  { module: "@/lib/project-discussion/access", name: "canPostProjectMessage", kind: "boolean", ref: "src/lib/project-discussion/access.ts:83", note: "返回布尔：在查看条件上再判项目是否只读" },
];

/**
 * 例外名单：固定返回 410、不读写任何数据的已下线接口。
 * 按「已下线」检查：只导入 next/server，不出现 db，不出现 await，正文里返回 410。
 */
type Exemption = { file: string; method: string; reason: string };
export const EXEMPTIONS: readonly Exemption[] = [
  {
    file: `${ROUTES_DIR}/inquiries/batch-followup/route.ts`,
    method: "POST",
    reason: "T-2 已下线（文件头注释：Evan 2026-11-07 拍板，原调用方已被 W-1 删除）：只返回 410，不鉴权、不调模型、不读写库",
  },
];

/** 第 3 条：守卫之前不得出现的调用（按被调用的函数名或方法名认） */
const TOUCH_CALLS: ReadonlyArray<[RegExp, string]> = [
  [/^(?:putPrivateBlob|readBlobBuffer|readBlobStream|deleteBlob)$/, "文件存储"],
  [/^(?:parseAndStoreContent|parseDocumentPagesAndStore)$/, "文件解析"],
  [/^(?:createCompletion\w*|generate\w*|runStaticSkill)$/, "模型调用"],
  [/^create\w*Task$/, "建任务"],
  [/^(?:enqueue|maybeEnqueue|maybeAutoEnqueue)\w*$/, "入队"],
  [/^(?:notify\w*|createNotification\w*|deliver\w*Notification\w*)$/, "发通知"],
  [/audit/i, "写审计"],
];
/** 第 4 条：守卫之前允许 await 的读请求体方法 */
const BODY_READERS = new Set(["json", "formData", "text"]);

export type HandlerFinding = { method: string; problem: string | null; exempt?: boolean };

type HandlerFn = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** 去掉括号、类型断言、非空断言，看里面的表达式 */
function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression;
    else return cur;
  }
}

/** export const GET = … 的右边：函数字面量，或包装函数调用里的函数字面量（withAuth(async (…) => {…})，可多层） */
function handlerFromInitializer(init: ts.Expression): HandlerFn | null {
  const e = unwrap(init);
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e;
  if (ts.isCallExpression(e)) {
    for (const arg of e.arguments) {
      const inner = handlerFromInitializer(arg);
      if (inner) return inner;
    }
  }
  return null;
}

/** 被调用的函数名：foo(…) → foo；a.b.foo(…) → foo */
function calleeName(call: ts.CallExpression): string | null {
  const c = unwrap(call.expression);
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return null;
}

function paramName(fn: HandlerFn, index: number): string | null {
  const p = fn.parameters[index];
  return p && ts.isIdentifier(p.name) ? p.name.text : null;
}

/** 第二个参数是 { params } 这样的解构时，params 绑定到的本地名 */
function destructuredParamsName(fn: HandlerFn): string | null {
  const p = fn.parameters[1];
  if (!p || !ts.isObjectBindingPattern(p.name)) return null;
  for (const el of p.name.elements) {
    const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
    if (key === "params" && ts.isIdentifier(el.name)) return el.name.text;
  }
  return null;
}

/** 取路由参数：await ctx.params（ctx 是处理函数第二个参数）或 await params（第二个参数解构出的 params） */
function isRouteParamsExpr(e: ts.Expression, fn: HandlerFn): boolean {
  const x = unwrap(e);
  const ctxName = paramName(fn, 1);
  if (ts.isPropertyAccessExpression(x) && x.name.text === "params") {
    const obj = unwrap(x.expression);
    return ctxName !== null && ts.isIdentifier(obj) && obj.text === ctxName;
  }
  const destructured = destructuredParamsName(fn);
  return destructured !== null && ts.isIdentifier(x) && x.text === destructured;
}

/** 读请求体：request.json() / formData() / text()（request 是处理函数第一个参数），可接 .catch(…) */
function isBodyRead(e: ts.Expression, fn: HandlerFn): boolean {
  let x = unwrap(e);
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "catch") {
    x = unwrap(x.expression.expression);
  }
  if (!ts.isCallExpression(x) || !ts.isPropertyAccessExpression(x.expression)) return false;
  const reqName = paramName(fn, 0);
  const recv = unwrap(x.expression.expression);
  return reqName !== null && ts.isIdentifier(recv) && recv.text === reqName && BODY_READERS.has(x.expression.name.text);
}

/** 本文件里哪些本地名是名单里的守卫（按导入的模块与原始导出名认） */
function importedGuards(sf: ts.SourceFile): Map<string, Guard> {
  const out = new Map<string, Guard>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.importClause?.isTypeOnly) continue;
    const mod = st.moduleSpecifier.text;
    const nb = st.importClause?.namedBindings;
    if (!nb || !ts.isNamedImports(nb)) continue;
    for (const el of nb.elements) {
      if (el.isTypeOnly) continue;
      const original = (el.propertyName ?? el.name).text;
      const guard = GUARDS.find((g) => g.module === mod && g.name === original);
      if (guard) out.set(el.name.text, guard);
    }
  }
  return out;
}

/** 一段代码里第一次碰数据（db. / 名单里的调用）的位置说明；没有就是 null */
function firstTouch(node: ts.Node): string | null {
  let problem: string | null = null;
  walk(node, (n) => {
    if (problem) return;
    if (ts.isIdentifier(n) && n.text === "db" && n.parent && (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) && n.parent.expression === n) {
      problem = "数据库（db.）";
    } else if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      const hit = name ? TOUCH_CALLS.find(([re]) => re.test(name)) : undefined;
      if (hit) problem = `${hit[1]}（${name}）`;
    }
  });
  return problem;
}

/**
 * 第 5 条：守卫结果被检查，不通过就直接返回拒绝响应，中间不做别的事。
 *   - 返回响应的守卫：if (x instanceof NextResponse) return …; 或 if (isAccessError(x)) return …;
 *     返回的通常就是 x；也可以是把 x 换成另一个拒绝响应（如 tender-intel/sourcing 把 403 换成 404），
 *     但返回语句里不得 await、不得碰数据。
 *   - 返回布尔的守卫：if (!x) return …;
 * then 分支只能是这一条 return（可带花括号）。
 */
function isResultCheck(st: ts.Statement | undefined, varName: string, kind: GuardKind): boolean {
  if (!st || !ts.isIfStatement(st)) return false;
  let then: ts.Statement = st.thenStatement;
  if (ts.isBlock(then)) {
    if (then.statements.length !== 1) return false;
    then = then.statements[0];
  }
  if (!ts.isReturnStatement(then) || !then.expression) return false;
  let awaits = false;
  walk(then.expression, (n) => { if (ts.isAwaitExpression(n)) awaits = true; });
  if (awaits || firstTouch(then.expression)) return false;
  const cond = unwrap(st.expression);
  const isVar = (e: ts.Expression) => { const u = unwrap(e); return ts.isIdentifier(u) && u.text === varName; };
  if (kind === "boolean") {
    return ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken && isVar(cond.operand);
  }
  if (ts.isBinaryExpression(cond) && cond.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    const right = unwrap(cond.right);
    return isVar(cond.left) && ts.isIdentifier(right) && right.text === "NextResponse";
  }
  if (ts.isCallExpression(cond) && calleeName(cond) === "isAccessError" && cond.arguments.length === 1) {
    return isVar(cond.arguments[0]);
  }
  return false;
}

/** 第 9 条：已下线接口仍然只返回 410、不导入数据库、不做异步调用 */
function checkExempt(sf: ts.SourceFile, fn: HandlerFn): string | null {
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text !== "next/server") {
      return `例外接口导入了 next/server 以外的模块（${st.moduleSpecifier.text}），不能再按「已下线」放过`;
    }
  }
  let usesDb = false;
  let usesAwait = false;
  let returns410 = false;
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && n.text === "db") usesDb = true;
    if (ts.isAwaitExpression(n)) usesAwait = true;
  });
  if (fn.body) {
    walk(fn.body, (n) => {
      if (ts.isReturnStatement(n) && n.expression) {
        walk(n.expression, (m) => { if (ts.isNumericLiteral(m) && m.text === "410") returns410 = true; });
      }
    });
  }
  if (usesDb) return "例外接口出现了 db，不能再按「已下线」放过";
  if (usesAwait) return "例外接口出现了 await，不能再按「已下线」放过";
  if (!returns410) return "例外接口不再固定返回 410，不能再按「已下线」放过";
  return null;
}

/** 逐个处理函数按第 2–8 条检查 */
function checkHandler(fn: HandlerFn, guards: Map<string, Guard>): string | null {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return "处理函数正文不是语句块，认不出第一步是不是项目权限守卫";

  // 第一次调用名单里的守卫（按源码先后，注释不在语法树里）
  let first: { call: ts.CallExpression; guard: Guard } | null = null;
  walk(body, (n) => {
    if (first || !ts.isCallExpression(n)) return;
    const c = unwrap(n.expression);
    if (ts.isIdentifier(c) && guards.has(c.text)) first = { call: n, guard: guards.get(c.text)! };
  });
  if (!first) return "没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）";
  const { call, guard } = first as { call: ts.CallExpression; guard: Guard };

  // 第 6 条：第一次调用守卫的语句是正文顶层的 const x = await 守卫(…)
  const idx = body.statements.findIndex((st) => st.pos <= call.pos && call.end <= st.end);
  const st = body.statements[idx];
  let varName: string | null = null;
  if (st && ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
    const d = st.declarationList.declarations[0];
    const init = d.initializer ? unwrap(d.initializer) : null;
    if (ts.isIdentifier(d.name) && init && ts.isAwaitExpression(init) && unwrap(init.expression) === call) varName = d.name.text;
  }
  if (!varName) {
    return `第一次调用守卫 ${guard.name} 不是处理函数正文里不带条件的一步（要写成顶层语句 const x = await ${guard.name}(…)，不能在 if / try / 循环 / 三元 / && / || / ?? / 内层函数里，也不能不赋值）`;
  }

  // 第 3、4 条：守卫之前（前面的顶层语句与守卫调用的参数）只取路由参数、读请求体，不碰数据
  const before: ts.Node[] = [...body.statements.slice(0, idx), ...call.arguments];
  for (const node of before) {
    const touched = firstTouch(node);
    if (touched) return `在项目权限守卫之前就碰了${touched}`;
  }
  for (const node of before) {
    let problem: string | null = null;
    walk(node, (n) => {
      if (problem || !ts.isAwaitExpression(n)) return;
      if (!isRouteParamsExpr(n.expression, fn) && !isBodyRead(n.expression, fn)) {
        problem = `在项目权限守卫之前 await 了取路由参数、读请求体以外的调用（${n.getText().replace(/\s+/g, " ").slice(0, 80)}）`;
      }
    });
    if (problem) return problem;
  }

  // 第 5、7 条：紧接着的下一条语句就是对守卫返回值的检查
  if (!isResultCheck(body.statements[idx + 1], varName, guard.kind)) {
    return guard.kind === "boolean"
      ? `调用了守卫 ${guard.name}，但下一条语句不是 if (!${varName}) return …（守卫结果要紧接着检查，中间不做别的事）`
      : `调用了守卫 ${guard.name}，但下一条语句不是 if (${varName} instanceof NextResponse) return ${varName}（守卫结果要紧接着检查，不通过就直接返回拒绝响应，中间不做别的事）`;
  }

  // 第 8 条：守卫的项目参数是解构路由参数里 id 这个键得到的变量
  const projectArg = call.arguments[1] ? unwrap(call.arguments[1]) : null;
  if (!projectArg || !ts.isIdentifier(projectArg)) {
    return `守卫 ${guard.name} 的项目参数不是解构路由参数里 id 得到的变量（检查的不是地址里的项目）`;
  }
  const fromRouteId = body.statements.slice(0, idx).some((s) => {
    if (!ts.isVariableStatement(s)) return false;
    return s.declarationList.declarations.some((d) => {
      if (!ts.isObjectBindingPattern(d.name) || !d.initializer) return false;
      const init = unwrap(d.initializer);
      if (!ts.isAwaitExpression(init) || !isRouteParamsExpr(init.expression, fn)) return false;
      return d.name.elements.some((el) => {
        const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
        return key === "id" && ts.isIdentifier(el.name) && el.name.text === projectArg.text && !el.dotDotDotToken;
      });
    });
  });
  if (!fromRouteId) {
    return `守卫 ${guard.name} 的项目参数 ${projectArg.text} 不是解构路由参数里 id 得到的变量（检查的不是地址里的项目）`;
  }
  return null;
}

/** 检查一个路由文件；exempt 是这个文件在例外名单里的方法 */
export function checkRouteSource(source: string, exemptMethods: ReadonlySet<string> = new Set()): HandlerFinding[] {
  const sf = parse(source);
  const guards = importedGuards(sf);
  const findings: HandlerFinding[] = [];
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      const text = st.getText().replace(/\s+/g, " ").slice(0, 60);
      findings.push({ method: "(export)", problem: `用了 ${text} 的导出写法，守卫测试认不出其中的处理函数（改成 export async function / export const GET = withAuth(async …)）` });
      continue;
    }
    if (ts.isFunctionDeclaration(st) && hasExportModifier(st) && st.name && HTTP_METHODS.has(st.name.text)) {
      const method = st.name.text;
      findings.push(exemptMethods.has(method)
        ? { method, problem: checkExempt(sf, st), exempt: true }
        : { method, problem: checkHandler(st, guards) });
      continue;
    }
    if (ts.isVariableStatement(st) && hasExportModifier(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !HTTP_METHODS.has(d.name.text)) continue;
        const method = d.name.text;
        const fn = d.initializer ? handlerFromInitializer(d.initializer) : null;
        if (!fn) {
          findings.push({ method, problem: "处理函数正文不在导出语句里（export const 方法 = 变量 / 包装函数(函数名)），守卫测试认不出它的第一步" });
          continue;
        }
        findings.push(exemptMethods.has(method)
          ? { method, problem: checkExempt(sf, fn), exempt: true }
          : { method, problem: checkHandler(fn, guards) });
      }
    }
  }
  for (const m of exemptMethods) {
    if (!findings.some((f) => f.method === m)) findings.push({ method: m, problem: `例外名单里的 ${m} 在文件里找不到了，删掉这条例外`, exempt: true });
  }
  return findings;
}

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === "route.ts" || entry.name === "route.tsx") out.push(full);
  }
  return out.sort();
}

/* ═════════════ 检查器自测：反例都被指出 ═════════════ */
console.log("检查器自测：反例");
const IMPORTS = `import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectReadAccess, requireProjectWriteAccess } from "@/lib/projects/access";
`;
const only = (src: string) => checkRouteSource(IMPORTS + src);
const flagged = (r: HandlerFinding[], method: string, re: RegExp) => r.length === 1 && r[0].method === method && re.test(r[0].problem ?? "");

const unguarded = only(`
export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  await db.projectDocument.updateMany({ where: { projectId: id }, data: {} });
  return NextResponse.json({ ok: true });
});`);
ok(flagged(unguarded, "POST", /没有调用名单里的项目权限守卫/), "检查器：完全不调守卫的处理函数被指出", unguarded);

const late = only(`
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id, fileId } = await ctx.params;
  const doc = await db.projectDocument.findFirst({ where: { id: fileId, projectId: id } });
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ ok: !!doc });
}`);
ok(flagged(late, "DELETE", /之前就碰了数据库/), "检查器：先读库、后调守卫的处理函数被指出", late);

const unchecked = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  await requireProjectReadAccess(request, id);
  await db.projectDocument.deleteMany({ where: { projectId: id } });
  return NextResponse.json({ ok: true });
}`);
ok(flagged(unchecked, "POST", /不是处理函数正文里不带条件的一步|不能不赋值/), "检查器：调了守卫不看结果（不赋值）的处理函数被指出", unchecked);

const uncheckedAssigned = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  return NextResponse.json({ ok: !!access });
}`);
ok(flagged(uncheckedAssigned, "POST", /下一条语句不是 if \(access instanceof NextResponse\)/), "检查器：赋了值却不检查守卫结果的处理函数被指出", uncheckedAssigned);

const wrongVar = only(`
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  const r = NextResponse.json({});
  if (r instanceof NextResponse) return r;
  await db.projectDocument.deleteMany({ where: { projectId: id } });
  return NextResponse.json({ ok: !!access });
}`);
ok(flagged(wrongVar, "DELETE", /下一条语句不是/), "检查器：检查的不是守卫的返回值（另一个变量）被指出", wrongVar);

const wrongVarSameLine = only(`
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  const other = NextResponse.json({});
  if (other instanceof NextResponse) return access;
  return NextResponse.json({});
}`);
ok(flagged(wrongVarSameLine, "DELETE", /下一条语句不是/), "检查器：if 里判断的是另一个变量（即便返回守卫结果）也被指出", wrongVarSameLine);

const commentedOut = only(`
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  // const access = await requireProjectReadAccess(request, id);
  // if (access instanceof NextResponse) return access;
  /* const access = await requireProjectReadAccess(request, id); */
  return NextResponse.json(await db.projectDocument.findMany({ where: { projectId: id } }));
}`);
ok(flagged(commentedOut, "GET", /没有调用名单里的项目权限守卫/), "检查器：被注释掉的守卫不算数", commentedOut);

const helperFirst = only(`
async function resetAll(id: string) { return db.projectDocument.updateMany({ where: { projectId: id }, data: {} }); }
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  await resetAll(id);
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ ok: true });
}`);
ok(flagged(helperFirst, "POST", /await 了取路由参数、读请求体以外的调用（await resetAll/), "检查器：守卫之前先 await 一个本地函数（里面写库）被指出", helperFirst);

const impostor = checkRouteSource(`
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/somewhere-else/access";
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.project.findUnique({ where: { id } }));
}`);
ok(flagged(impostor, "GET", /没有调用名单里的项目权限守卫/), "检查器：冒名守卫（同名、从别处导入）不算数", impostor);

const localImpostor = checkRouteSource(`
import { NextRequest, NextResponse } from "next/server";
async function requireProjectReadAccess(_r: NextRequest, _id: string) { return { ok: true }; }
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({});
}`);
ok(flagged(localImpostor, "GET", /没有调用名单里的项目权限守卫/), "检查器：冒名守卫（同名、文件里自己定义）不算数", localImpostor);

const reexported = only(`
async function del(request: NextRequest) { await db.projectDocument.deleteMany({}); return NextResponse.json({}); }
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({});
}
export { del as DELETE };`);
ok(reexported.length === 2 && reexported.some((f) => f.method === "(export)" && /导出写法/.test(f.problem ?? "")) && reexported.some((f) => f.method === "GET" && f.problem === null),
  "检查器：export { … as DELETE } 判失败（同文件里合规的 GET 仍通过）", reexported);

const starExport = checkRouteSource(`export * from "./other-route";`);
ok(flagged(starExport, "(export)", /导出写法/), "检查器：export * from 判失败", starExport);

const namedRef = only(`
const handler = withAuth(async (request, ctx) => { return NextResponse.json({}); });
export const GET = handler;
async function impl(request: NextRequest) { return NextResponse.json({}); }
export const POST = withAuth(impl);`);
ok(namedRef.length === 2 && namedRef.every((f) => /正文不在导出语句里/.test(f.problem ?? "")), "检查器：export const GET = 变量、withAuth(函数名) 判失败", namedRef);

const inIf = only(`
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json();
  if (body.mode === "write") {
    const access = await requireProjectWriteAccess(request, id);
    if (access instanceof NextResponse) return access;
  }
  await db.project.update({ where: { id }, data: body });
  return NextResponse.json({ ok: true });
}`);
ok(flagged(inIf, "PATCH", /不是处理函数正文里不带条件的一步/), "检查器：守卫只在 if 分支里调用被指出", inIf);

const inTry = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const access = await requireProjectReadAccess(request, id);
    if (access instanceof NextResponse) return access;
  } catch {}
  return NextResponse.json({});
}`);
ok(flagged(inTry, "POST", /不是处理函数正文里不带条件的一步/), "检查器：守卫在 try 里调用被指出", inTry);

const shortCircuit = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = request.headers.get("x-skip") ? null : await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({});
}`);
ok(flagged(shortCircuit, "POST", /不是处理函数正文里不带条件的一步/), "检查器：守卫在三元表达式里调用被指出", shortCircuit);

const checkAfterRead = only(`
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  const rows = await db.projectIntelligence.findUnique({ where: { projectId: id } });
  if (access instanceof NextResponse) return access;
  return NextResponse.json(rows);
}`);
ok(flagged(checkAfterRead, "GET", /下一条语句不是/), "检查器：调了守卫、先读库、再检查结果被指出", checkAfterRead);

const busyReject = only(`
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) {
    await db.auditLog.create({ data: { projectId: id } });
    return access;
  }
  return NextResponse.json({});
}
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return NextResponse.json(await db.project.findUnique({ where: { id } }), { status: 403 });
  return NextResponse.json({});
}`);
ok(busyReject.length === 2 && busyReject.every((f) => /下一条语句不是/.test(f.problem ?? "")), "检查器：拒绝分支里先做别的事（读写库）再返回被指出", busyReject);

const bodyProject = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json();
  const access = await requireProjectWriteAccess(request, body.projectId);
  if (access instanceof NextResponse) return access;
  await db.project.update({ where: { id }, data: {} });
  return NextResponse.json({});
}`);
ok(flagged(bodyProject, "POST", /项目参数不是解构路由参数里 id 得到的变量/), "检查器：守卫查的是请求体里的另一个项目 ID 被指出", bodyProject);

const bodyProjectVar = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { projectId } = await request.json();
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ id });
}`);
ok(flagged(bodyProjectVar, "POST", /项目参数 projectId 不是解构路由参数里 id 得到的变量/), "检查器：守卫查的是从请求体解构出的项目 ID 被指出", bodyProjectVar);

const nestedParam = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireProjectReadAccess(request, quoteId);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ id });
}`);
ok(flagged(nestedParam, "POST", /项目参数 quoteId 不是/), "检查器：守卫查的是嵌套路由的另一个参数（quoteId）被指出", nestedParam);

const beforeNotify = only(`
import { notifyProjectMembers } from "@/lib/notifications/create";
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  notifyProjectMembers(id, "x", {}).catch(() => {});
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({});
}`);
ok(flagged(beforeNotify, "POST", /之前就碰了发通知（notifyProjectMembers）/), "检查器：守卫之前发通知（不 await）也被指出", beforeNotify);

const beforeModel = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  void runStaticSkill("quote", { projectId: id });
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({});
}`);
ok(flagged(beforeModel, "POST", /之前就碰了模型调用（runStaticSkill）/), "检查器：守卫之前调技能 / 模型被指出", beforeModel);

const beforeAudit = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  logAudit({ action: "x", projectId: id });
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({});
}`);
ok(flagged(beforeAudit, "POST", /之前就碰了写审计（logAudit）/), "检查器：守卫之前写审计被指出", beforeAudit);

console.log("检查器自测：例外名单");
const EXEMPT_POST = new Set(["POST"]);
const goneOk = checkRouteSource(`
import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json({ error: "下线了", code: "GONE" }, { status: 410 });
}`, EXEMPT_POST);
ok(goneOk.length === 1 && goneOk[0].problem === null && goneOk[0].exempt === true, "检查器：例外接口只返回 410、不读写库时按例外通过", goneOk);

const goneDb = checkRouteSource(`
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function POST() {
  await db.inquiry.findMany({});
  return NextResponse.json({ error: "下线了" }, { status: 410 });
}`, EXEMPT_POST);
ok(goneDb.length === 1 && /不能再按「已下线」放过/.test(goneDb[0].problem ?? ""), "检查器：例外接口改回读库被指出", goneDb);

const goneAwait = checkRouteSource(`
import { NextResponse } from "next/server";
export async function POST(request: Request) {
  await request.json();
  return NextResponse.json({ error: "下线了" }, { status: 410 });
}`, EXEMPT_POST);
ok(goneAwait.length === 1 && /出现了 await/.test(goneAwait[0].problem ?? ""), "检查器：例外接口里出现 await 被指出", goneAwait);

const goneNot410 = checkRouteSource(`
import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json({ ok: true });
}`, EXEMPT_POST);
ok(goneNot410.length === 1 && /不再固定返回 410/.test(goneNot410[0].problem ?? ""), "检查器：例外接口不再返回 410 被指出", goneNot410);

const goneMissingMethod = checkRouteSource(`
import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({}, { status: 410 }); }`, EXEMPT_POST);
ok(goneMissingMethod.some((f) => f.method === "POST" && /找不到了，删掉这条例外/.test(f.problem ?? "")), "检查器：例外名单里的方法在文件里不存在被指出", goneMissingMethod);

/* ═════════════ 检查器自测：正例都通过（合成源码，不在任何名单里，等于「新加的接口不用登记」） ═════════════ */
console.log("检查器自测：正例（新加的接口写法合规就通过，不用登记）");
const good = only(`
/** 这里的注释提到 db.projectDocument 与 requireProjectReadAccess 都不算数 */
export const GET = withAuth(async (request, ctx) => {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.projectDocument.findMany({ where: { projectId: id } }));
});
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) {
    return access;
  }
  const body = await request.json();
  return NextResponse.json(await db.project.update({ where: { id: projectId }, data: body }));
}`);
ok(good.length === 2 && good.every((h) => h.problem === null), "检查器：先过守卫再碰数据的 withAuth 写法与 export async function 写法都通过", good);

const destructuredParams = only(`
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.project.findUnique({ where: { id } }));
}
export const DELETE = withAuth(async (request, { params }: Ctx, user) => {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ user: user.id });
});`);
ok(destructuredParams.length === 2 && destructuredParams.every((h) => h.problem === null), "检查器：第二个参数解构出 { params } 再 await params 的写法通过（src/app/api/projects/[id]/route.ts 的写法）", destructuredParams);

const flagThenGuard = checkRouteSource(`
import { NextResponse, type NextRequest } from "next/server";
import { isFeatureEnabled } from "@/lib/some-feature/flags";
import { loadView } from "@/lib/some-feature/service";
import { requireProjectReadAccess } from "@/lib/projects/access";
const notEnabled = () => NextResponse.json({ error: "未启用" }, { status: 404 });
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 总闸关着：在任何鉴权与取数之前返回
  if (!isFeatureEnabled()) return notEnabled();
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const view = await loadView({ projectId, userId: access.user.id });
  return NextResponse.json({ enabled: true, view });
}`);
ok(flagThenGuard.length === 1 && flagThenGuard[0].problem === null, "检查器：先判开关（不 await、不碰数据）再解构 params、再不带条件地调守卫并紧接着检查的新接口通过", flagThenGuard);

const bodyFirst = only(`
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.project.update({ where: { id }, data: body }));
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const readAccess = await requireProjectReadAccess(req, id);
  if (readAccess instanceof NextResponse) return readAccess;
  if (body.userId !== readAccess.user.id) {
    const writeAccess = await requireProjectWriteAccess(req, id);
    if (writeAccess instanceof NextResponse) return writeAccess;
  }
  return NextResponse.json({});
}`);
ok(bodyFirst.length === 2 && bodyFirst.every((h) => h.problem === null), "检查器：先 await request.json().catch(…) / try 里读请求体再调守卫通过；按内容在分支里再调写权限守卫不受约束", bodyFirst);

const aliasDiagnostic = checkRouteSource(`
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDiagnosticProjectReadAccess as requireProjectReadAccess } from "@/lib/projects/diagnostic-access";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.prompt.findMany({ where: { projectId } }));
}`);
ok(aliasDiagnostic.length === 1 && aliasDiagnostic[0].problem === null, "检查器：别名导入的调试面守卫按 diagnostic-access 认，通过", aliasDiagnostic);

const booleanGuard = checkRouteSource(`
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { canViewProjectDiscussion } from "@/lib/project-discussion/access";
export const GET = withAuth(async (_request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const allowed = await canViewProjectDiscussion(user, projectId);
  if (!allowed) return NextResponse.json({ error: "无权查看" }, { status: 403 });
  return NextResponse.json(await db.projectMessage.findMany({ where: { projectId } }));
});`);
ok(booleanGuard.length === 1 && booleanGuard[0].problem === null, "检查器：返回布尔的讨论区守卫（if (!x) return …）通过", booleanGuard);

const isAccessErrorStyle = checkRouteSource(`
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAccessError, requireTenderAnalysisWrite } from "@/lib/tender-auto-analysis/api-access";
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireTenderAnalysisWrite(request, id);
  if (isAccessError(access)) return access;
  return NextResponse.json(await db.tenderAnalysisRun.findMany({ where: { projectId: id } }));
}`);
ok(isAccessErrorStyle.length === 1 && isAccessErrorStyle[0].problem === null, "检查器：isAccessError(x)) return x 的写法通过", isAccessErrorStyle);

const remappedReject = only(`
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access.status === 401 ? access : NextResponse.json({ error: "项目不存在" }, { status: 404 });
  return NextResponse.json(await db.project.findUnique({ where: { id: projectId } }));
}`);
ok(remappedReject.length === 1 && remappedReject[0].problem === null, "检查器：拒绝时把守卫的响应换成另一个拒绝响应（不 await、不碰数据）通过（tender-intel/sourcing 的写法）", remappedReject);

const booleanWrongCheck = checkRouteSource(`
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { canViewProjectDiscussion } from "@/lib/project-discussion/access";
export const GET = withAuth(async (_request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const allowed = await canViewProjectDiscussion(user, projectId);
  if (allowed instanceof NextResponse) return allowed;
  return NextResponse.json({});
});`);
ok(flagged(booleanWrongCheck, "GET", /下一条语句不是 if \(!allowed\) return/), "检查器：布尔守卫按 instanceof 检查被指出（布尔守卫要 if (!x) return …）", booleanWrongCheck);

/* ═════════════ 目录下的真实路由 ═════════════ */
console.log("目录下的真实路由");
const root = join(process.cwd(), ROUTES_DIR);
const routeFiles = listRouteFiles(root).map((f) => relative(process.cwd(), f).split("\\").join("/"));
const FIX21_FILES = [
  `${ROUTES_DIR}/ai-bid-package/route.ts`,
  `${ROUTES_DIR}/ai-bid-package/run-step/route.ts`,
  `${ROUTES_DIR}/intelligence/regenerate/route.ts`,
  `${ROUTES_DIR}/intelligence/review/route.ts`,
];
ok(routeFiles.length >= 170, `目录下至少找到 170 个路由文件（实际 ${routeFiles.length} 个）`, routeFiles.length);
ok(FIX21_FILES.every((f) => routeFiles.includes(f)), "FIX-21 的 4 个路由文件都在枚举结果里", FIX21_FILES.filter((f) => !routeFiles.includes(f)));
for (const e of EXEMPTIONS) {
  ok(existsSync(join(process.cwd(), e.file)), `例外名单里的 ${e.file} 还在（不在了就删掉这条例外）`, e.file);
}

const offenders: Array<{ file: string; method: string; problem: string }> = [];
let handlerCount = 0;
let passedCount = 0;
let exemptCount = 0;
for (const file of routeFiles) {
  const exempt = new Set(EXEMPTIONS.filter((e) => e.file === file).map((e) => e.method));
  const findings = checkRouteSource(readFileSync(join(process.cwd(), file), "utf8"), exempt);
  if (findings.length === 0) offenders.push({ file, method: "(none)", problem: "没有导出任何 HTTP 处理函数" });
  for (const f of findings) {
    handlerCount++;
    if (f.problem) offenders.push({ file, method: f.method, problem: f.problem });
    else if (f.exempt) exemptCount++;
    else passedCount++;
  }
}
ok(handlerCount >= 240, `目录下至少找到 240 个处理函数（实际 ${handlerCount} 个）`, handlerCount);
ok(exemptCount === EXEMPTIONS.length, `例外名单里的 ${EXEMPTIONS.length} 个接口都按「已下线」通过`, { exemptCount });
ok(offenders.length === 0, `每个处理函数都先过项目级权限检查（通过 ${passedCount} 个，例外 ${exemptCount} 个，不过 ${offenders.length} 个）`, offenders.length);
if (offenders.length > 0) {
  console.error("\n漏了项目权限检查（或检查写得不牢）的处理函数：");
  for (const o of offenders) console.error(`  - ${o.file} ${o.method}：${o.problem}`);
}

console.log(`\nFIX-21 project routes guard: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
