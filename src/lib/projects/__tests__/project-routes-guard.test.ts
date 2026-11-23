/**
 * FIX-21 目录守卫：src/app/api/projects/[id]/ 下每个路由文件的每个处理函数都先过项目级权限检查（无 DB，CI 里跑）
 *   npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts
 *
 * 这个目录下曾有 8 个处理函数只查「已登录」（FIX-17 补了 files/ 下 2 个，FIX-21 补了情报与一键投标方案 6 个）。
 * 每次运行都现场枚举目录下全部 route.ts / route.tsx，不维护路由清单：以后新加的接口写法合规就通过，
 * 不用改这里的任何名单；漏了检查或检查写得不牢就失败，并点名文件、方法与缺的是什么。
 *
 * 用 TypeScript 编译器按语法树判断（注释里的字不算数，守卫按导入它的模块与原始导出名认定）。规则见
 * openspec/changes/project-intel-bidpackage-access/design.md D9（多维审查后收紧）：
 *   1. 认不出处理函数正文的导出写法判失败（export { … } / export * from / export const { … } = … /
 *      export const GET = 变量 / withAuth(函数名) / withAuth 以外的包装函数）；
 *   2. 处理函数里必须调用 GUARDS 名单里的一个守卫；守卫、isAccessError、NextResponse 都按导入来源认，
 *      处理函数里同名的局部声明（遮蔽）判失败；
 *   3. 取路由参数、读请求体之后的第一步就是守卫：守卫之前只允许取路由参数、读请求体、取文件常量的别名，
 *      任何表达式语句、提前 return、if、await 别的调用都不行（db 及其别名导入出现即点名「碰了数据库」）；
 *   5. 守卫的返回值赋给一个变量并被检查（instanceof NextResponse / isAccessError / 布尔守卫 if (!x)），
 *      拒绝分支只能返回守卫结果或 401 / 403 / 404 的常量响应；
 *   6. 第一次调用守卫的语句是处理函数正文的顶层语句 const x = await 守卫(…)；
 *   7. 紧接着的下一条语句就是第 5 条的检查；
 *   8. 守卫的项目参数是 const 解构路由参数里 id 得到的变量（或 const p = await params 的 p.id），之后不改写、
 *      守卫之后不再取路由参数；返回响应的守卫第一个参数是处理函数收到的请求；
 *   9. 例外名单里的接口按「已下线」检查；例外文件不存在也判失败；
 *  10. 防空跑：至少 170 个路由文件、240 个处理函数，FIX-21 的 4 个文件都在；
 *  11. 守卫前预处理名单（3 个既有处理函数，只减不增）；
 *  13. 一键投标方案两个路由照抄的固定提示与 src/lib/agent-tasks/dto.ts 一字不差（按源码文本比较）。
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

/**
 * 守卫前预处理名单：目录里既有的 3 个处理函数在守卫之前先做了不碰数据、不 await 的预处理（运行环境闸、
 * 按请求体选守卫要的权限级别）。名单只减不增：这几个处理函数改成守卫第一步之后，这里的对应条目必须删掉
 * （测试会提示）；新接口不进这个名单，一律「取路由参数、读请求体之后的第一步就是项目守卫」。
 * 名单里的处理函数在守卫之前额外允许：不含 await、不碰数据的 const 声明，与 if (…) return …（同样不含 await、不碰数据）。
 */
type PrepEntry = { file: string; method: string; reason: string };
export const PRE_GUARD_PREP: readonly PrepEntry[] = [
  {
    file: `${ROUTES_DIR}/route.ts`,
    method: "PATCH",
    reason: "鉴权前先过运行环境隔离闸 assertNonProdSideEffectsAllowed(\"write\")（非生产环境禁写时直接返回它的响应，与项目无关）",
  },
  {
    file: `${ROUTES_DIR}/finance/expenses/[expenseId]/route.ts`,
    method: "PATCH",
    reason: "按请求体里的 action 选 requireCostAccess 要的权限（审核动作要 PROJECT_COST_REVIEW，其余 PROJECT_EXPENSE_SUBMIT），纯计算",
  },
  {
    file: `${ROUTES_DIR}/quote-engine/[quoteId]/status/route.ts`,
    method: "POST",
    reason: "先校验请求体里的目标状态（无效回 400「无效状态」，与项目无关），再按目标状态选 requireQuoteAccess 的级别",
  },
];

/** 第 9 条：例外名单里已经不存在的路由文件（不在了就要删掉那条例外） */
export function missingExemptionFiles(list: readonly Exemption[], exists: (absPath: string) => boolean = existsSync): string[] {
  return list.filter((e) => !exists(join(process.cwd(), e.file))).map((e) => e.file);
}

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

export type HandlerFinding = { method: string; problem: string | null; exempt?: boolean; prep?: boolean };

type HandlerFn = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

/** 守卫结果的判定函数：也按「来源模块 + 原始导出名」认，文件里自己定义的同名函数不算 */
const RESULT_CHECKERS: ReadonlyArray<{ module: string; name: string; ref: string }> = [
  { module: "@/lib/tender-auto-analysis/api-access", name: "isAccessError", ref: "src/lib/tender-auto-analysis/api-access.ts:12" },
];
/** 包装函数只认 withAuth（统一异常兜底与 x-request-id；src/lib/common/api-helpers.ts） */
const WRAPPERS: ReadonlyArray<{ module: string; name: string }> = [{ module: "@/lib/common/api-helpers", name: "withAuth" }];
/** 拒绝分支允许返回的状态码 */
const REJECT_STATUSES = new Set(["401", "403", "404"]);

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

function short(n: ts.Node): string {
  return n.getText().replace(/\s+/g, " ").slice(0, 80);
}

/** 被调用的函数名：foo(…) → foo；a.b.foo(…) → foo */
function calleeName(call: ts.CallExpression): string | null {
  const c = unwrap(call.expression);
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return null;
}

/** 本文件里每个本地名对应的导入（来源模块 + 原始导出名；type-only 导入不算） */
type FileCtx = {
  guards: Map<string, Guard>;
  resultCheckers: Set<string>;
  nextResponse: Set<string>;
  dbNames: Set<string>;
  wrappers: Set<string>;
  /** 文件顶层的函数（拒绝分支里允许调用的「由常量构造拒绝页」的辅助函数只能是这些） */
  localFns: Map<string, ts.FunctionLikeDeclaration>;
  /** 文件顶层 const 声明的名字（常量表达式可以引用它们） */
  topConsts: Set<string>;
};

function fileContext(sf: ts.SourceFile): FileCtx {
  const ctx: FileCtx = {
    guards: new Map(), resultCheckers: new Set(), nextResponse: new Set(), dbNames: new Set(["db"]),
    wrappers: new Set(), localFns: new Map(), topConsts: new Set(),
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && !st.importClause?.isTypeOnly) {
      const mod = st.moduleSpecifier.text;
      const nb = st.importClause?.namedBindings;
      if (!nb || !ts.isNamedImports(nb)) continue;
      for (const el of nb.elements) {
        if (el.isTypeOnly) continue;
        const original = (el.propertyName ?? el.name).text;
        const local = el.name.text;
        const guard = GUARDS.find((g) => g.module === mod && g.name === original);
        if (guard) ctx.guards.set(local, guard);
        if (RESULT_CHECKERS.some((c) => c.module === mod && c.name === original)) ctx.resultCheckers.add(local);
        if (WRAPPERS.some((w) => w.module === mod && w.name === original)) ctx.wrappers.add(local);
        if (mod === "next/server" && original === "NextResponse") ctx.nextResponse.add(local);
        if (mod === "@/lib/db" && original === "db") ctx.dbNames.add(local);
      }
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      ctx.localFns.set(st.name.text, st);
    } else if (ts.isVariableStatement(st)) {
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        if (isConst) ctx.topConsts.add(d.name.text);
        const init = d.initializer ? unwrap(d.initializer) : null;
        if (isConst && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) ctx.localFns.set(d.name.text, init);
      }
    }
  }
  return ctx;
}

/** export const GET = … 的右边：函数字面量，或 withAuth(函数字面量) */
function handlerFromInitializer(init: ts.Expression, ctx: FileCtx): { fn: HandlerFn } | { problem: string } {
  const e = unwrap(init);
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return { fn: e };
  if (ts.isCallExpression(e)) {
    const callee = unwrap(e.expression);
    if (!ts.isIdentifier(callee) || !ctx.wrappers.has(callee.text)) {
      return { problem: `包装函数只认从 @/lib/common/api-helpers 导入的 withAuth（这里是 ${short(callee)}），守卫测试认不出它的第一步` };
    }
    const arg = e.arguments[0] ? unwrap(e.arguments[0]) : null;
    if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) return { fn: arg };
  }
  return { problem: "处理函数正文不在导出语句里（export const 方法 = 变量 / withAuth(函数名)），守卫测试认不出它的第一步" };
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

/** 取路由参数：ctx.params（ctx 是处理函数第二个参数）或 params（第二个参数解构出的 params） */
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

/** 常量表达式：字面量、文件顶层常量（或守卫前声明的常量别名）及其属性、由常量组成的对象 / 数组；没有调用、await、new、赋值 */
function isConstantExpr(e: ts.Expression, ids: ReadonlySet<string>): boolean {
  const x = unwrap(e);
  if (ts.isStringLiteral(x) || ts.isNumericLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return true;
  if (x.kind === ts.SyntaxKind.TrueKeyword || x.kind === ts.SyntaxKind.FalseKeyword || x.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(x)) return x.text === "undefined" || ids.has(x.text);
  if (ts.isPropertyAccessExpression(x)) return isConstantExpr(x.expression, ids);
  if (ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.MinusToken) return isConstantExpr(x.operand, ids);
  if (ts.isArrayLiteralExpression(x)) return x.elements.every((el) => !ts.isSpreadElement(el) && isConstantExpr(el, ids));
  if (ts.isObjectLiteralExpression(x)) {
    return x.properties.every((p) =>
      (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && isConstantExpr(p.initializer, ids)) ||
      (ts.isShorthandPropertyAssignment(p) && ids.has(p.name.text)) ||
      (ts.isSpreadAssignment(p) && isConstantExpr(p.expression, ids)));
  }
  return false;
}

/** 读请求体：request.json() / formData() / text()（request 是处理函数第一个参数），可接 .catch(() => 常量) */
function isBodyRead(e: ts.Expression, fn: HandlerFn, ids: ReadonlySet<string>): boolean {
  let x = unwrap(e);
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "catch") {
    const handler = x.arguments.length === 1 ? unwrap(x.arguments[0]) : null;
    const returnsConstant = !!handler && ts.isArrowFunction(handler) && !ts.isBlock(handler.body) && isConstantExpr(handler.body, ids);
    if (!returnsConstant) return false;
    x = unwrap(x.expression.expression);
  }
  if (!ts.isCallExpression(x) || x.arguments.length !== 0 || !ts.isPropertyAccessExpression(x.expression)) return false;
  const reqName = paramName(fn, 0);
  const recv = unwrap(x.expression.expression);
  return reqName !== null && ts.isIdentifier(recv) && recv.text === reqName && BODY_READERS.has(x.expression.name.text);
}

/** 一段代码里第一次碰数据（数据库 / 名单里的调用）的位置说明；没有就是 null */
function firstTouch(node: ts.Node, ctx: FileCtx): string | null {
  let problem: string | null = null;
  walk(node, (n) => {
    if (problem) return;
    if (ts.isIdentifier(n) && ctx.dbNames.has(n.text) && !(n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      problem = `数据库（${n.text}）`;
    } else if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      const hit = name ? TOUCH_CALLS.find(([re]) => re.test(name)) : undefined;
      if (hit) problem = `${hit[1]}（${name}）`;
    }
  });
  return problem;
}

/** 拒绝分支返回的东西：守卫结果本身、401 / 403 / 404 的 NextResponse.json(常量, …)、或文件里由常量构造拒绝页的辅助函数；三元两边各自满足 */
function isRejectExpr(e: ts.Expression, varName: string | null, ctx: FileCtx, ids: ReadonlySet<string>, depth = 0): boolean {
  const x = unwrap(e);
  if (varName && ts.isIdentifier(x) && x.text === varName) return true;
  if (ts.isConditionalExpression(x)) {
    let impure = false;
    walk(x.condition, (n) => { if (ts.isCallExpression(n) || ts.isAwaitExpression(n) || ts.isNewExpression(n) || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken)) impure = true; });
    return !impure && isRejectExpr(x.whenTrue, varName, ctx, ids, depth) && isRejectExpr(x.whenFalse, varName, ctx, ids, depth);
  }
  const statusOk = (opts: ts.Expression | undefined) => {
    if (!opts) return false;
    const o = unwrap(opts);
    if (!ts.isObjectLiteralExpression(o) || !isConstantExpr(o, ids)) return false;
    return o.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "status" && ts.isNumericLiteral(unwrap(p.initializer)) && REJECT_STATUSES.has((unwrap(p.initializer) as ts.NumericLiteral).text));
  };
  if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "json") {
    const recv = unwrap(x.expression.expression);
    return ts.isIdentifier(recv) && ctx.nextResponse.has(recv.text) && x.arguments.length === 2 && isConstantExpr(x.arguments[0], ids) && statusOk(x.arguments[1]);
  }
  if (ts.isCallExpression(x) && ts.isIdentifier(unwrap(x.expression)) && depth === 0) {
    const helper = ctx.localFns.get((unwrap(x.expression) as ts.Identifier).text);
    if (!helper || !x.arguments.every((a) => isConstantExpr(a, ids))) return false;
    // 第一个参数就是 401 / 403 / 404（如 tender-rfq/attachment 的 messagePage(404, M.notFound)）
    const first = x.arguments[0] ? unwrap(x.arguments[0]) : null;
    if (first && ts.isNumericLiteral(first) && REJECT_STATUSES.has(first.text)) return true;
    // 没有参数、正文直接返回一个拒绝响应（如 const notFound = () => NextResponse.json({…}, { status: 404 })）
    if (x.arguments.length === 0 && helper.parameters.length === 0 && helper.body) {
      const ret = ts.isBlock(helper.body)
        ? (helper.body.statements.length === 1 && ts.isReturnStatement(helper.body.statements[0]) ? helper.body.statements[0].expression : undefined)
        : helper.body;
      return !!ret && isRejectExpr(ret, null, ctx, ctx.topConsts, depth + 1);
    }
  }
  return false;
}

/**
 * 第 5、7 条：守卫结果紧接着被检查，不通过就直接返回拒绝响应，中间不做别的事。
 *   - 返回响应的守卫：if (x instanceof NextResponse) return …; 或 if (isAccessError(x)) return …;
 *   - 返回布尔的守卫：if (!x) return …;
 * then 分支只能是这一条 return（可带花括号），没有 else；返回的要满足 isRejectExpr。
 */
function isResultCheck(st: ts.Statement | undefined, varName: string, kind: GuardKind, ctx: FileCtx, ids: ReadonlySet<string>): boolean {
  if (!st || !ts.isIfStatement(st) || st.elseStatement) return false;
  let then: ts.Statement = st.thenStatement;
  if (ts.isBlock(then)) {
    if (then.statements.length !== 1) return false;
    then = then.statements[0];
  }
  if (!ts.isReturnStatement(then) || !then.expression) return false;
  const cond = unwrap(st.expression);
  const isVar = (e: ts.Expression) => { const u = unwrap(e); return ts.isIdentifier(u) && u.text === varName; };
  let condOk = false;
  if (kind === "boolean") {
    condOk = ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken && isVar(cond.operand);
  } else if (ts.isBinaryExpression(cond) && cond.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    const right = unwrap(cond.right);
    condOk = isVar(cond.left) && ts.isIdentifier(right) && ctx.nextResponse.has(right.text);
  } else if (ts.isCallExpression(cond) && ts.isIdentifier(unwrap(cond.expression)) && cond.arguments.length === 1) {
    condOk = ctx.resultCheckers.has((unwrap(cond.expression) as ts.Identifier).text) && isVar(cond.arguments[0]);
  }
  return condOk && isRejectExpr(then.expression, kind === "response" ? varName : null, ctx, ids);
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

/** 处理函数里（含参数与内层函数）声明的全部名字：用来查有没有遮蔽导入的守卫 / 判定函数 / NextResponse */
function declaredNames(fn: HandlerFn): Set<string> {
  const out = new Set<string>();
  const addBinding = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) out.add(name.text);
    else for (const el of name.elements) if (!ts.isOmittedExpression(el)) addBinding(el.name);
  };
  for (const p of fn.parameters) addBinding(p.name);
  if (fn.body) {
    walk(fn.body, (n) => {
      if (ts.isVariableDeclaration(n) || ts.isParameter(n)) addBinding(n.name);
      else if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassExpression(n)) && n.name) out.add(n.name.text);
      else if (ts.isCatchClause(n) && n.variableDeclaration) addBinding(n.variableDeclaration.name);
    });
  }
  return out;
}

/** 一个表达式（赋值左边）里出现的被赋值的名字 */
function assignedNames(target: ts.Expression, out: Set<string>): void {
  const x = unwrap(target);
  if (ts.isIdentifier(x)) out.add(x.text);
  else if (ts.isObjectLiteralExpression(x)) {
    for (const p of x.properties) {
      if (ts.isShorthandPropertyAssignment(p)) out.add(p.name.text);
      else if (ts.isPropertyAssignment(p)) assignedNames(p.initializer, out);
      else if (ts.isSpreadAssignment(p)) assignedNames(p.expression, out);
    }
  } else if (ts.isArrayLiteralExpression(x)) {
    for (const el of x.elements) assignedNames(ts.isSpreadElement(el) ? el.expression : el, out);
  } else if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    assignedNames(x.left, out);
  }
}

function isAssignmentOperator(k: ts.SyntaxKind): boolean {
  return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
}

/**
 * 守卫之前允许的一条顶层语句（第 3、4 条）：
 *   - 取路由参数：const { id } = await ctx.params / const p = await params；
 *   - 读请求体：const body = await request.json()（可接 .catch(() => 常量)）、body = await request.json()、
 *     先 let body; 再 try { body = await request.json(); } catch { return 400 }（join-brief 的写法）；
 *   - 常量别名：const M = 文件顶层常量（tender-rfq/attachment 的写法）。
 * 其余（任何表达式语句、提前 return、if、不 await 的调用）一律不允许；返回 null 表示允许，否则返回说明。
 */
function preGuardProblem(st: ts.Statement, fn: HandlerFn, ctx: FileCtx, ids: Set<string>, lenient: boolean): string | null {
  const touched = firstTouch(st, ctx);
  if (lenient && !touched) {
    // 守卫前预处理名单里的处理函数：不含 await、不碰数据的 const 声明与 if (…) return …
    let awaits = false;
    walk(st, (n) => { if (ts.isAwaitExpression(n)) awaits = true; });
    if (!awaits) {
      if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.Const) !== 0) return null;
      if (ts.isIfStatement(st) && !st.elseStatement) {
        const t = ts.isBlock(st.thenStatement) && st.thenStatement.statements.length === 1 ? st.thenStatement.statements[0] : st.thenStatement;
        if (ts.isReturnStatement(t) && t.expression) return null;
      }
    }
  }
  const describe = () => {
    if (touched) return `在项目权限守卫之前就碰了${touched}`;
    let awaited: ts.AwaitExpression | null = null;
    walk(st, (n) => { if (!awaited && ts.isAwaitExpression(n) && !isRouteParamsExpr(n.expression, fn) && !isBodyRead(n.expression, fn, ids)) awaited = n; });
    if (awaited) return `在项目权限守卫之前 await 了取路由参数、读请求体以外的调用（${short(awaited)}）`;
    let returned: ts.ReturnStatement | null = null;
    walk(st, (n) => { if (!returned && ts.isReturnStatement(n)) returned = n; });
    if (returned) return `在项目权限守卫之前就提前 return 了（${short(st)}）：取路由参数、读请求体之后的第一步必须是项目权限守卫`;
    return `在项目权限守卫之前做了取路由参数、读请求体以外的事（${short(st)}）`;
  };
  const isBodyAssign = (s: ts.Statement) => {
    if (!ts.isExpressionStatement(s)) return false;
    const e = unwrap(s.expression);
    if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(unwrap(e.left))) return false;
    const r = unwrap(e.right);
    return ts.isAwaitExpression(r) && isBodyRead(r.expression, fn, ids);
  };
  if (ts.isVariableStatement(st)) {
    const flags = st.declarationList.flags;
    const isConst = (flags & ts.NodeFlags.Const) !== 0;
    const isLet = (flags & ts.NodeFlags.Let) !== 0;
    const allowed = st.declarationList.declarations.every((d) => {
      if (!d.initializer) return isLet;
      const init = unwrap(d.initializer);
      if (ts.isAwaitExpression(init) && (isRouteParamsExpr(init.expression, fn) || isBodyRead(init.expression, fn, ids))) return true;
      return isConst && ts.isIdentifier(d.name) && isConstantExpr(init, ids);
    });
    if (allowed) {
      for (const d of st.declarationList.declarations) {
        if (isConst && ts.isIdentifier(d.name) && d.initializer && isConstantExpr(d.initializer, ids)) ids.add(d.name.text);
      }
      return null;
    }
    return describe();
  }
  if (isBodyAssign(st)) return null;
  if (ts.isTryStatement(st) && !st.finallyBlock && st.catchClause) {
    const tryOk = st.tryBlock.statements.length > 0 && st.tryBlock.statements.every(isBodyAssign);
    const c = st.catchClause.block.statements;
    const ret = c.length === 1 && ts.isReturnStatement(c[0]) ? c[0].expression : undefined;
    const r = ret ? unwrap(ret) : null;
    const catchOk = !!r && ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression) && r.expression.name.text === "json" &&
      ts.isIdentifier(unwrap(r.expression.expression)) && ctx.nextResponse.has((unwrap(r.expression.expression) as ts.Identifier).text) &&
      r.arguments.length === 2 && isConstantExpr(r.arguments[0], ids) && /\bstatus\s*:\s*400\b/.test(r.arguments[1].getText()) && isConstantExpr(r.arguments[1], ids);
    if (tryOk && catchOk) return null;
  }
  return describe();
}

/** 逐个处理函数按第 2–8 条检查 */
function checkHandler(fn: HandlerFn, ctx: FileCtx, lenient = false): string | null {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return "处理函数正文不是语句块，认不出第一步是不是项目权限守卫";

  // 遮蔽：处理函数里有与导入的守卫 / 判定函数 / NextResponse 同名的局部声明（函数声明会提升，能冒名顶替）
  const declared = declaredNames(fn);
  for (const name of [...ctx.guards.keys(), ...ctx.resultCheckers, ...ctx.nextResponse]) {
    if (declared.has(name)) return `处理函数里有同名的局部声明 ${name}，遮蔽了导入的守卫 / 判定函数（守卫按导入来源认，不按名字认）`;
  }

  // 第一次调用名单里的守卫（按源码先后，注释不在语法树里）
  let first: { call: ts.CallExpression; guard: Guard } | null = null;
  walk(body, (n) => {
    if (first || !ts.isCallExpression(n)) return;
    const c = unwrap(n.expression);
    if (ts.isIdentifier(c) && ctx.guards.has(c.text)) first = { call: n, guard: ctx.guards.get(c.text)! };
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

  // 第 3、4 条：守卫之前只取路由参数、读请求体（任何别的语句都不行，包括不 await 的调用与提前 return）
  const ids = new Set(ctx.topConsts);
  for (const pre of body.statements.slice(0, Math.max(idx, 0))) {
    const problem = preGuardProblem(pre, fn, ctx, ids, lenient);
    if (problem) return problem;
  }
  if (!varName) {
    return `第一次调用守卫 ${guard.name} 不是处理函数正文里不带条件的一步（要写成顶层语句 const x = await ${guard.name}(…)，不能在 if / try / 循环 / 三元 / && / || / ?? / 内层函数里，也不能不赋值）`;
  }

  // 第 5、7 条：紧接着的下一条语句就是对守卫返回值的检查
  if (!isResultCheck(body.statements[idx + 1], varName, guard.kind, ctx, ids)) {
    return guard.kind === "boolean"
      ? `调用了守卫 ${guard.name}，但下一条语句不是 if (!${varName}) return 401 / 403 / 404（守卫结果要紧接着检查，中间不做别的事）`
      : `调用了守卫 ${guard.name}，但下一条语句不是 if (${varName} instanceof NextResponse) return ${varName}（守卫结果要紧接着检查；拒绝分支只能返回守卫结果或 401 / 403 / 404，中间不做别的事）`;
  }

  // 伪造第一个参数：返回响应的守卫第一个参数必须是处理函数收到的请求
  const firstArg = call.arguments[0] ? unwrap(call.arguments[0]) : null;
  const reqName = paramName(fn, 0);
  if (guard.kind === "response" && !(firstArg && ts.isIdentifier(firstArg) && firstArg.text === reqName)) {
    return `守卫 ${guard.name} 的第一个参数不是处理函数收到的请求 ${reqName ?? "(无名)"}（这里是 ${firstArg ? short(firstArg) : "空"}）`;
  }

  // 第 8 条：守卫的项目参数是 const 解构路由参数里 id 得到的变量（或 const p = await params 的 p.id），之后不得改写
  const projectArg = call.arguments[1] ? unwrap(call.arguments[1]) : null;
  const before = body.statements.slice(0, idx);
  const constRouteDecl = (pred: (d: ts.VariableDeclaration) => boolean) =>
    before.some((s) => ts.isVariableStatement(s) && (s.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
      s.declarationList.declarations.some((d) => {
        const init = d.initializer ? unwrap(d.initializer) : null;
        return !!init && ts.isAwaitExpression(init) && isRouteParamsExpr(init.expression, fn) && pred(d);
      }));
  let boundName: string | null = null;
  if (projectArg && ts.isIdentifier(projectArg)) {
    const name = projectArg.text;
    const ok = constRouteDecl((d) => ts.isObjectBindingPattern(d.name) && d.name.elements.some((el) => {
      const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
      return key === "id" && ts.isIdentifier(el.name) && el.name.text === name && !el.dotDotDotToken && !el.initializer;
    }));
    if (ok) boundName = name;
  } else if (projectArg && ts.isPropertyAccessExpression(projectArg) && projectArg.name.text === "id" && ts.isIdentifier(unwrap(projectArg.expression))) {
    const name = (unwrap(projectArg.expression) as ts.Identifier).text;
    if (constRouteDecl((d) => ts.isIdentifier(d.name) && d.name.text === name)) boundName = name;
  }
  if (!boundName) {
    return `守卫 ${guard.name} 的项目参数${projectArg ? ` ${short(projectArg)}` : ""} 不是 const 解构路由参数里 id 得到的变量（检查的不是地址里的项目）`;
  }
  const reassigned = new Set<string>();
  walk(body, (n) => {
    if (ts.isBinaryExpression(n) && isAssignmentOperator(n.operatorToken.kind)) assignedNames(n.left, reassigned);
    else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) assignedNames(n.operand, reassigned);
  });
  if (reassigned.has(boundName)) return `守卫检查的项目参数 ${boundName} 在处理函数里被重新赋值（检查的可能不是地址里的项目）`;

  // 守卫之后不再取一次路由参数（防止守卫查一个、后面用另一个）
  let refetch: ts.Node | null = null;
  for (const s of body.statements.slice(idx + 1)) {
    walk(s, (n) => { if (!refetch && ts.isAwaitExpression(n) && isRouteParamsExpr(n.expression, fn)) refetch = n; });
  }
  if (refetch) return `守卫之后又取了一次路由参数（${short(refetch)}）：项目 ID 只在守卫之前取一次`;
  return null;
}

/** 检查一个路由文件；exempt 是这个文件在例外名单里的方法 */
export function checkRouteSource(source: string, exemptMethods: ReadonlySet<string> = new Set(), prepMethods: ReadonlySet<string> = new Set()): HandlerFinding[] {
  const sf = parse(source);
  const ctx = fileContext(sf);
  const findings: HandlerFinding[] = [];
  const judge = (method: string, fn: HandlerFn): HandlerFinding => {
    if (exemptMethods.has(method)) return { method, problem: checkExempt(sf, fn), exempt: true };
    if (prepMethods.has(method)) {
      if (checkHandler(fn, ctx) === null) return { method, problem: `守卫前预处理名单里的 ${method} 已经是守卫第一步了，删掉这一条（名单只减不增）`, prep: true };
      return { method, problem: checkHandler(fn, ctx, true), prep: true };
    }
    return { method, problem: checkHandler(fn, ctx) };
  };
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      const text = st.getText().replace(/\s+/g, " ").slice(0, 60);
      findings.push({ method: "(export)", problem: `用了 ${text} 的导出写法，守卫测试认不出其中的处理函数（改成 export async function / export const GET = withAuth(async …)）` });
      continue;
    }
    if (ts.isFunctionDeclaration(st) && hasExportModifier(st) && st.name && HTTP_METHODS.has(st.name.text)) {
      findings.push(judge(st.name.text, st));
      continue;
    }
    if (ts.isVariableStatement(st) && hasExportModifier(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) {
          findings.push({ method: "(export)", problem: `用了解构的导出写法（${short(d.name)}），守卫测试认不出其中的处理函数` });
          continue;
        }
        if (!HTTP_METHODS.has(d.name.text)) continue;
        const method = d.name.text;
        const found = d.initializer ? handlerFromInitializer(d.initializer, ctx) : { problem: "处理函数正文不在导出语句里，守卫测试认不出它的第一步" };
        if ("problem" in found) {
          findings.push({ method, problem: found.problem });
          continue;
        }
        findings.push(judge(method, found.fn));
      }
    }
  }
  for (const m of exemptMethods) {
    if (!findings.some((f) => f.method === m)) findings.push({ method: m, problem: `例外名单里的 ${m} 在文件里找不到了，删掉这条例外`, exempt: true });
  }
  for (const m of prepMethods) {
    if (!findings.some((f) => f.method === m)) findings.push({ method: m, problem: `守卫前预处理名单里的 ${m} 在文件里找不到了，删掉这一条`, prep: true });
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
ok(flagged(bodyProject, "POST", /项目参数 body\.projectId 不是 const 解构路由参数里 id 得到的变量/), "检查器：守卫查的是请求体里的另一个项目 ID 被指出", bodyProject);

const bodyProjectVar = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { projectId } = await request.json();
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ id });
}`);
ok(flagged(bodyProjectVar, "POST", /项目参数 projectId 不是 const 解构路由参数里 id 得到的变量/), "检查器：守卫查的是从请求体解构出的项目 ID 被指出", bodyProjectVar);

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

const earlyReturn = checkRouteSource(`
import { NextResponse, type NextRequest } from "next/server";
import { isFeatureEnabled } from "@/lib/some-feature/flags";
import { requireProjectReadAccess } from "@/lib/projects/access";
const notEnabled = () => NextResponse.json({ error: "未启用" }, { status: 404 });
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isFeatureEnabled()) return notEnabled();
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ ok: true });
}`);
ok(flagged(earlyReturn, "GET", /之前就提前 return 了/), "检查器：守卫之前提前 return（先判开关再调守卫）被指出", earlyReturn);

const unawaitedWrite = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  db.project.update({ where: { id }, data: { name: "x" } });
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ ok: true });
}`);
ok(flagged(unawaitedWrite, "POST", /之前就碰了数据库（db）/), "检查器：守卫之前不 await 的写库调用被指出", unawaitedWrite);

const unawaitedImported = only(`
import { markViewed } from "@/lib/projects/views";
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  void markViewed(id);
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ ok: true });
}`);
ok(flagged(unawaitedImported, "GET", /之前做了取路由参数、读请求体以外的事/), "检查器：守卫之前不 await 地调用一个导入的函数（名字看不出写库）也被指出", unawaitedImported);

const catchWrites = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => db.auditLog.create({ data: {} }));
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ body });
}`);
ok(flagged(catchWrites, "POST", /之前就碰了数据库/), "检查器：读请求体的 .catch(…) 里写库被指出（.catch 只能返回常量）", catchWrites);

const letProjectId = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  let { id } = await ctx.params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ id });
}`);
ok(flagged(letProjectId, "POST", /项目参数 id 不是 const 解构路由参数里 id 得到的变量/), "检查器：守卫检查的项目 ID 用 let 绑定被指出", letProjectId);

const reassignedId = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const body = await request.json();
  id = body.projectId;
  await db.project.update({ where: { id }, data: {} });
  return NextResponse.json({ ok: true });
}`);
ok(flagged(reassignedId, "POST", /项目参数 id 在处理函数里被重新赋值/), "检查器：守卫检查的项目 ID 之后被重新赋值被指出", reassignedId);

const refetchedId = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { id: realId } = await ctx.params;
  await db.project.update({ where: { id: realId }, data: {} });
  return NextResponse.json({ ok: true });
}`);
ok(flagged(refetchedId, "POST", /守卫之后又取了一次路由参数/), "检查器：守卫之后又从 ctx.params 取一次 id 被指出", refetchedId);

const destructuredExport = only(`
const handlers = { GET: withAuth(async () => NextResponse.json({})), POST: withAuth(async () => NextResponse.json({})) };
export const { GET, POST } = handlers;`);
ok(destructuredExport.length === 1 && destructuredExport[0].method === "(export)" && /解构的导出写法/.test(destructuredExport[0].problem ?? ""), "检查器：export const { GET, POST } = handlers 判失败", destructuredExport);

const localIsAccessError = checkRouteSource(`
import { NextRequest, NextResponse } from "next/server";
import { requireTenderAnalysisRead } from "@/lib/tender-auto-analysis/api-access";
function isAccessError(_v: unknown): boolean { return false; }
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireTenderAnalysisRead(request, id);
  if (isAccessError(access)) return access;
  return NextResponse.json({});
}`);
ok(flagged(localIsAccessError, "GET", /下一条语句不是/), "检查器：文件里自己定义的同名 isAccessError 不算检查", localIsAccessError);

const foreignIsAccessError = checkRouteSource(`
import { NextRequest, NextResponse } from "next/server";
import { requireTenderAnalysisRead } from "@/lib/tender-auto-analysis/api-access";
import { isAccessError } from "@/lib/somewhere-else/errors";
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireTenderAnalysisRead(request, id);
  if (isAccessError(access)) return access;
  return NextResponse.json({});
}`);
ok(flagged(foreignIsAccessError, "GET", /下一条语句不是/), "检查器：从别处导入的同名 isAccessError 不算检查", foreignIsAccessError);

const shadowedGuard = only(`
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.project.findUnique({ where: { id } }));
  async function requireProjectReadAccess(_r: NextRequest, _id: string) { return { ok: true }; }
}`);
ok(flagged(shadowedGuard, "GET", /同名的局部声明 requireProjectReadAccess/), "检查器：处理函数里同名局部函数遮蔽导入的守卫被指出", shadowedGuard);

const reject200 = only(`
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return NextResponse.json({ ok: true });
  return NextResponse.json({});
}
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return NextResponse.json({ ok: true }, { status: 200 });
  return NextResponse.json({});
}`);
ok(reject200.length === 2 && reject200.every((f) => /下一条语句不是/.test(f.problem ?? "")), "检查器：拒绝分支返回 200 被指出", reject200);

const rejectViaCall = only(`
import { logAndReturn } from "@/lib/common/log";
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return logAndReturn(access);
  return NextResponse.json({});
}`);
ok(flagged(rejectViaCall, "GET", /下一条语句不是/), "检查器：拒绝分支调用别的函数再返回被指出", rejectViaCall);

const dbAlias = checkRouteSource(`
import { NextRequest, NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await prisma.projectDocument.findMany({ where: { projectId: id } });
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(rows);
}
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { projectDocument } = db;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await projectDocument.findMany({ where: { projectId: id } }));
}`);
ok(dbAlias.length === 2 && /之前就碰了数据库（prisma）/.test(dbAlias[0].problem ?? "") && /之前就碰了数据库（db）/.test(dbAlias[1].problem ?? ""), "检查器：db 的别名导入、const { projectDocument } = db 在守卫之前都当作碰数据库", dbAlias);

const otherWrapper = checkRouteSource(`
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/common/rate-limit";
import { requireProjectReadAccess } from "@/lib/projects/access";
export const GET = withRateLimit(async (request, ctx) => {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({});
});`);
ok(flagged(otherWrapper, "GET", /包装函数只认/), "检查器：withAuth 以外的包装函数判失败", otherWrapper);

const forgedRequest = only(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json();
  const access = await requireProjectWriteAccess(body.fakeRequest, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({});
}`);
ok(flagged(forgedRequest, "POST", /第一个参数不是处理函数收到的请求/), "检查器：守卫的第一个参数不是处理函数收到的请求被指出", forgedRequest);

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

const goneMissingFile = missingExemptionFiles([{ file: `${ROUTES_DIR}/no-such-retired-route-${Date.now()}/route.ts`, method: "POST", reason: "自测" }]);
ok(goneMissingFile.length === 1, "检查器：例外名单里的路由文件不存在被指出（提示删掉这条例外）", goneMissingFile);

const goneMissingMethod = checkRouteSource(`
import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({}, { status: 410 }); }`, EXEMPT_POST);
ok(goneMissingMethod.some((f) => f.method === "POST" && /找不到了，删掉这条例外/.test(f.problem ?? "")), "检查器：例外名单里的方法在文件里不存在被指出", goneMissingMethod);

console.log("检查器自测：守卫前预处理名单");
const PREP_SRC = `
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { assertNonProdSideEffectsAllowed } from "@/lib/env/runtime-isolation";
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isolationBlock = assertNonProdSideEffectsAllowed("write");
  if (isolationBlock) return isolationBlock;
  const { id } = await params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.project.update({ where: { id }, data: {} }));
}`;
const PATCH_ONLY = new Set(["PATCH"]);
const prepStrict = checkRouteSource(PREP_SRC);
ok(flagged(prepStrict, "PATCH", /之前就提前 return 了|之前做了取路由参数、读请求体以外的事/), "检查器：守卫前先判环境闸再 return 的写法，不在预处理名单里就判失败", prepStrict);
const prepListed = checkRouteSource(PREP_SRC, new Set(), PATCH_ONLY);
ok(prepListed.length === 1 && prepListed[0].problem === null && prepListed[0].prep === true, "检查器：同一写法列在守卫前预处理名单里按名单通过", prepListed);
const prepAwait = checkRouteSource(PREP_SRC.replace('const isolationBlock = assertNonProdSideEffectsAllowed("write");', 'const isolationBlock = await assertNonProdSideEffectsAllowed("write");'), new Set(), PATCH_ONLY);
ok(flagged(prepAwait, "PATCH", /await 了取路由参数、读请求体以外的调用/), "检查器：预处理名单里的处理函数在守卫之前 await 别的调用仍被指出", prepAwait);
const prepDb = checkRouteSource(PREP_SRC.replace('if (isolationBlock) return isolationBlock;', 'if (isolationBlock) return NextResponse.json(db.project, { status: 503 });'), new Set(), PATCH_ONLY);
ok(flagged(prepDb, "PATCH", /之前就碰了数据库/), "检查器：预处理名单里的处理函数在守卫之前碰数据库仍被指出", prepDb);
const prepStale = checkRouteSource(PREP_SRC.replace('const isolationBlock = assertNonProdSideEffectsAllowed("write");\n  if (isolationBlock) return isolationBlock;\n', ''), new Set(), PATCH_ONLY);
ok(flagged(prepStale, "PATCH", /已经是守卫第一步了，删掉这一条/), "检查器：预处理名单里的处理函数改成守卫第一步后，提示删掉这一条（名单只减不增）", prepStale);
const prepMissing = checkRouteSource(PREP_SRC, new Set(), new Set(["POST"]));
ok(prepMissing.some((f) => f.method === "POST" && /守卫前预处理名单里的 POST 在文件里找不到了/.test(f.problem ?? "")), "检查器：预处理名单里的方法在文件里不存在被指出", prepMissing);

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

const guardThenFlag = checkRouteSource(`
import { NextResponse, type NextRequest } from "next/server";
import { isFeatureEnabledForOrg } from "@/lib/some-feature/flags";
import { loadView } from "@/lib/some-feature/service";
import { requireProjectReadAccess } from "@/lib/projects/access";
const notEnabled = () => NextResponse.json({ error: "未启用" }, { status: 404 });
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  if (!access.project.orgId || !isFeatureEnabledForOrg(access.project.orgId)) return notEnabled();
  const view = await loadView({ projectId, userId: access.user.id });
  return NextResponse.json({ enabled: true, view });
}`);
ok(guardThenFlag.length === 1 && guardThenFlag[0].problem === null, "检查器：守卫第一步、之后才判开关的新接口通过（BIDPAGE bid-page-summary 现行写法，不用登记）", guardThenFlag);

const paramsObject = only(`
export async function GET(request: NextRequest, ctx: Ctx) {
  const p = await ctx.params;
  const access = await requireProjectReadAccess(request, p.id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.project.findUnique({ where: { id: p.id } }));
}`);
ok(paramsObject.length === 1 && paramsObject[0].problem === null, "检查器：const p = await ctx.params 再传 p.id 给守卫的写法通过", paramsObject);

const constPage = checkRouteSource(`
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
export const MESSAGES = { notLoggedIn: "请先登录", notFound: "没有找到" } as const;
function messagePage(status: number, message: string): NextResponse {
  return new NextResponse(\`<p>\${message}</p>\`, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const M = MESSAGES;
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access.status === 401 ? messagePage(401, M.notLoggedIn) : messagePage(404, M.notFound);
  return NextResponse.json(await db.project.findUnique({ where: { id: projectId } }));
}`);
ok(constPage.length === 1 && constPage[0].problem === null, "检查器：守卫前取文件常量的别名、拒绝时返回由常量构造的 401 / 404 页通过（tender-rfq/attachment 的写法）", constPage);

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
const missingExempt = missingExemptionFiles(EXEMPTIONS);
ok(missingExempt.length === 0, `例外名单里的 ${EXEMPTIONS.length} 个路由文件都还在（不在了就删掉那条例外）`, missingExempt);
const missingPrep = missingExemptionFiles(PRE_GUARD_PREP);
ok(missingPrep.length === 0, `守卫前预处理名单里的 ${PRE_GUARD_PREP.length} 个路由文件都还在（不在了就删掉那一条）`, missingPrep);

const offenders: Array<{ file: string; method: string; problem: string }> = [];
let handlerCount = 0;
let passedCount = 0;
let exemptCount = 0;
let prepCount = 0;
for (const file of routeFiles) {
  const exempt = new Set(EXEMPTIONS.filter((e) => e.file === file).map((e) => e.method));
  const prep = new Set(PRE_GUARD_PREP.filter((e) => e.file === file).map((e) => e.method));
  const findings = checkRouteSource(readFileSync(join(process.cwd(), file), "utf8"), exempt, prep);
  if (findings.length === 0) offenders.push({ file, method: "(none)", problem: "没有导出任何 HTTP 处理函数" });
  for (const f of findings) {
    handlerCount++;
    if (f.problem) offenders.push({ file, method: f.method, problem: f.problem });
    else if (f.exempt) exemptCount++;
    else if (f.prep) prepCount++;
    else passedCount++;
  }
}
ok(handlerCount >= 240, `目录下至少找到 240 个处理函数（实际 ${handlerCount} 个）`, handlerCount);
ok(exemptCount === EXEMPTIONS.length, `例外名单里的 ${EXEMPTIONS.length} 个接口都按「已下线」通过`, { exemptCount });
ok(prepCount === PRE_GUARD_PREP.length, `守卫前预处理名单里的 ${PRE_GUARD_PREP.length} 个接口都按名单通过`, { prepCount });
ok(offenders.length === 0, `每个处理函数都先过项目级权限检查（严格通过 ${passedCount} 个，守卫前预处理名单 ${prepCount} 个，例外 ${exemptCount} 个，不过 ${offenders.length} 个）`, offenders.length);
if (offenders.length > 0) {
  console.error("\n漏了项目权限检查（或检查写得不牢）的处理函数：");
  for (const o of offenders) console.error(`  - ${o.file} ${o.method}：${o.problem}`);
}

/* ═════════════ 一键投标方案两个路由照抄的固定提示与 dto.ts 一字不差 ═════════════ */
// src/lib/agent-tasks 是 runtime-architecture 冻结面，路由不能导入它，只能照抄 SAFE_STEP_ERROR_MESSAGE；
// 这里按源码文本比较（读文件、解析语法树，不 import 冻结面），任何一处改了另一处没跟上就失败。
console.log("照抄的固定提示与 src/lib/agent-tasks/dto.ts 一字不差");
function constStringIn(file: string, name: string): string | null {
  const sf = parse(readFileSync(join(process.cwd(), file), "utf8"));
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && ts.isStringLiteral(unwrap(d.initializer))) return (unwrap(d.initializer) as ts.StringLiteral).text;
    }
  }
  return null;
}
const dtoMessage = constStringIn("src/lib/agent-tasks/dto.ts", "SAFE_STEP_ERROR_MESSAGE");
ok(typeof dtoMessage === "string" && dtoMessage.length > 0, `src/lib/agent-tasks/dto.ts 里找到 SAFE_STEP_ERROR_MESSAGE（「${dtoMessage}」）`, dtoMessage);
for (const file of [`${ROUTES_DIR}/ai-bid-package/route.ts`, `${ROUTES_DIR}/ai-bid-package/run-step/route.ts`]) {
  const copied = constStringIn(file, "SAFE_STEP_ERROR_MESSAGE");
  ok(copied !== null && copied === dtoMessage, `${file} 照抄的 SAFE_STEP_ERROR_MESSAGE 与 dto.ts 一字不差`, { copied, dtoMessage });
}

console.log(`\nFIX-21 project routes guard: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
