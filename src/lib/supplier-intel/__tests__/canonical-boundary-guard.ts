/**
 * BL-3（S2 Final Remediation）：canonical requirement 边界的 AST 守卫（测试辅助模块）
 *
 * 取代 governance.test.ts 里的源码切片/indexOf 守卫：不再靠注释或 import 的首次出现划定检查范围，
 * 不再靠字符串存在性断言权限/数据流，不再让 indexOf 的 -1 制造顺序假阳性。
 *
 * 基于 TypeScript 编译器 API 对真实源文件做结构检查；每条违规返回稳定 code，
 * governance.test.ts 用负向 fixture（__tests__/fixtures/canonical-boundary-negative/*.txt）
 * 证明本守卫确实会对违规结构报错（非空断言）。
 */
import ts from "typescript";

export interface BoundarySources {
  /** src/app/api/supplier-intel/runs/route.ts */
  runsRoute: string;
  /** src/lib/supplier-intel/project-run-service.ts */
  projectRunService: string;
  /** src/lib/supplier-intel/discovery-service.ts */
  discoveryService: string;
  /** src/app/api/supplier-intel/signals/[id]/resolve/route.ts */
  resolveRoute: string;
}

export interface BoundaryViolation {
  code: string;
  detail: string;
}

/** runs POST 允许传给 createProjectSearchRun 的输入键（HTTP 契约白名单，不含 requirements） */
export const RUN_CREATE_ALLOWED_KEYS = ["projectId", "allowLlm", "hints"] as const;

function parse(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function contains(node: ts.Node, pred: (n: ts.Node) => boolean): boolean {
  let found = false;
  walk(node, (n) => {
    if (!found && pred(n)) found = true;
  });
  return found;
}

function findFunction(sf: ts.SourceFile, name: string): ts.FunctionDeclaration | null {
  let out: ts.FunctionDeclaration | null = null;
  walk(sf, (n) => {
    if (!out && ts.isFunctionDeclaration(n) && n.name?.text === name) out = n;
  });
  return out;
}

function findInterface(sf: ts.SourceFile, name: string): ts.InterfaceDeclaration | null {
  let out: ts.InterfaceDeclaration | null = null;
  walk(sf, (n) => {
    if (!out && ts.isInterfaceDeclaration(n) && n.name.text === name) out = n;
  });
  return out;
}

function findTypeAlias(sf: ts.SourceFile, name: string): ts.TypeAliasDeclaration | null {
  let out: ts.TypeAliasDeclaration | null = null;
  walk(sf, (n) => {
    if (!out && ts.isTypeAliasDeclaration(n) && n.name.text === name) out = n;
  });
  return out;
}

function propName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function typeLiteralMemberNames(sf: ts.SourceFile, typeNode: ts.TypeNode | undefined): string[] | null {
  if (!typeNode) return null;
  if (ts.isTypeLiteralNode(typeNode)) {
    return typeNode.members
      .map((m) => (m.name ? propName(m.name) : null))
      .filter((v): v is string => v !== null);
  }
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const iface = findInterface(sf, typeNode.typeName.text);
    if (iface) {
      return iface.members.map((m) => (m.name ? propName(m.name) : null)).filter((v): v is string => v !== null);
    }
    const alias = findTypeAlias(sf, typeNode.typeName.text);
    if (alias) return typeLiteralMemberNames(sf, alias.type);
  }
  return null; // 无法在本文件内解析 → 调用方按 fail-closed 记违规
}

function isCallTo(n: ts.Node, calleeName: string): n is ts.CallExpression {
  if (!ts.isCallExpression(n)) return false;
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text === calleeName;
  if (ts.isPropertyAccessExpression(e)) return e.name.text === calleeName;
  return false;
}

function statementIndexContaining(body: ts.Block, pred: (n: ts.Node) => boolean): number {
  for (let i = 0; i < body.statements.length; i++) {
    if (contains(body.statements[i], pred)) return i;
  }
  return -1;
}

function accessesProperty(n: ts.Node, property: string): boolean {
  if (ts.isPropertyAccessExpression(n)) return n.name.text === property;
  if (ts.isElementAccessExpression(n)) {
    const arg = n.argumentExpression;
    return ts.isStringLiteralLike(arg) && arg.text === property;
  }
  return false;
}

function objectLiteralKeys(obj: ts.ObjectLiteralExpression): string[] {
  const keys: string[] = [];
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) {
      keys.push("...spread");
      continue;
    }
    if (p.name) {
      const n = propName(p.name);
      keys.push(n ?? "<computed>");
    }
  }
  return keys;
}

function checkProjectRunService(text: string, out: BoundaryViolation[]): void {
  const sf = parse("project-run-service.ts", text);

  const hints = findInterface(sf, "ProjectSearchRunHints");
  if (!hints) {
    out.push({ code: "HINTS_INTERFACE_MISSING", detail: "找不到 interface ProjectSearchRunHints" });
  } else {
    const names = hints.members.map((m) => (m.name ? propName(m.name) : null));
    if (names.includes("requirements")) {
      out.push({ code: "HINTS_HAS_REQUIREMENTS", detail: "ProjectSearchRunHints 出现 requirements 成员" });
    }
  }

  const fn = findFunction(sf, "createProjectSearchRun");
  if (!fn || !fn.body) {
    out.push({ code: "CREATE_FN_MISSING", detail: "找不到 createProjectSearchRun 函数" });
    return;
  }
  const inputParam = fn.parameters[1];
  const inputKeys = typeLiteralMemberNames(sf, inputParam?.type);
  if (inputKeys === null) {
    out.push({ code: "CREATE_INPUT_TYPE_UNRESOLVED", detail: "createProjectSearchRun 第二参数类型无法在文件内解析（fail-closed）" });
  } else if (inputKeys.includes("requirements")) {
    out.push({ code: "CREATE_INPUT_HAS_REQUIREMENTS", detail: "createProjectSearchRun 输入类型出现 requirements" });
  }

  // 顺序：项目 ACL 断言先于 canonical 需求读取
  const aclIdx = statementIndexContaining(fn.body, (n) => isCallTo(n, "assertProjectAccessForActor"));
  const loaderIdx = statementIndexContaining(fn.body, (n) => isCallTo(n, "loadCanonicalSupplierRequirementSnapshot"));
  if (aclIdx < 0) out.push({ code: "ORDER_ANCHOR_MISSING:assertProjectAccessForActor", detail: "createProjectSearchRun 未调用项目 ACL 断言" });
  if (loaderIdx < 0) out.push({ code: "ORDER_ANCHOR_MISSING:loadCanonicalSupplierRequirementSnapshot", detail: "createProjectSearchRun 未调用 canonical loader" });
  if (aclIdx >= 0 && loaderIdx >= 0 && !(aclIdx < loaderIdx)) {
    out.push({ code: "ORDER_ACL_AFTER_CANONICAL", detail: `ACL 语句序号 ${aclIdx} 不早于 canonical 读取 ${loaderIdx}` });
  }

  // 快照来源：createSearchRun({ requirements: <canonicalVar>.entries }) 且 canonicalVar 来自 loader
  const canonicalVars = new Set<string>();
  walk(fn.body, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = ts.isAwaitExpression(n.initializer) ? n.initializer.expression : n.initializer;
      if (isCallTo(init, "loadCanonicalSupplierRequirementSnapshot")) canonicalVars.add(n.name.text);
    }
  });
  let createSearchRunCall: ts.CallExpression | null = null;
  walk(fn.body, (n) => {
    if (!createSearchRunCall && isCallTo(n, "createSearchRun")) createSearchRunCall = n;
  });
  if (!createSearchRunCall) {
    out.push({ code: "SNAPSHOT_CALL_MISSING", detail: "createProjectSearchRun 未调用 createSearchRun" });
    return;
  }
  const arg = (createSearchRunCall as ts.CallExpression).arguments[1];
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    out.push({ code: "SNAPSHOT_NOT_FROM_CANONICAL", detail: "createSearchRun 第二参数不是对象字面量，无法证明 requirements 来源" });
    return;
  }
  const reqProp = arg.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && propName(p.name) === "requirements",
  );
  if (!reqProp) {
    out.push({ code: "SNAPSHOT_NOT_FROM_CANONICAL", detail: "createSearchRun 调用缺少 requirements 属性" });
    return;
  }
  const init = reqProp.initializer;
  const fromCanonical =
    ts.isPropertyAccessExpression(init) &&
    ts.isIdentifier(init.expression) &&
    canonicalVars.has(init.expression.text) &&
    init.name.text === "entries";
  if (!fromCanonical) {
    out.push({
      code: "SNAPSHOT_NOT_FROM_CANONICAL",
      detail: `requirements 初始化表达式「${init.getText(sf)}」不是 canonical loader 结果的 .entries`,
    });
  }
}

function checkRunsRoute(text: string, out: BoundaryViolation[]): void {
  const sf = parse("runs-route.ts", text);

  walk(sf, (n) => {
    if (accessesProperty(n, "requirements")) {
      out.push({ code: "ROUTE_READS_BODY_REQUIREMENTS", detail: `路由读取 requirements：${n.getText(sf).slice(0, 80)}` });
    }
  });

  let createCall: ts.CallExpression | null = null;
  walk(sf, (n) => {
    if (!createCall && isCallTo(n, "createProjectSearchRun")) createCall = n;
  });
  if (!createCall) {
    out.push({ code: "ROUTE_CREATE_CALL_MISSING", detail: "runs 路由未调用 createProjectSearchRun" });
  } else {
    const input = (createCall as ts.CallExpression).arguments[1];
    if (!input || !ts.isObjectLiteralExpression(input)) {
      out.push({ code: "ROUTE_CREATE_INPUT_NOT_LITERAL", detail: "createProjectSearchRun 第二参数必须是对象字面量（可审计的 HTTP→服务输入白名单）" });
    } else {
      for (const k of objectLiteralKeys(input)) {
        if (!(RUN_CREATE_ALLOWED_KEYS as readonly string[]).includes(k)) {
          out.push({ code: `ROUTE_PASSES_UNKNOWN_KEY:${k}`, detail: `HTTP 面向服务传入非白名单键 ${k}` });
        }
      }
    }
  }

  const post = findFunction(sf, "POST");
  if (!post || !post.body) {
    out.push({ code: "ROUTE_POST_MISSING", detail: "runs 路由缺 POST" });
  } else {
    const gateIdx = statementIndexContaining(post.body, (n) => isCallTo(n, "requireProjectWriteAccess"));
    const svcIdx = statementIndexContaining(post.body, (n) => isCallTo(n, "createProjectSearchRun"));
    if (gateIdx < 0) out.push({ code: "ROUTE_MISSING_WRITE_GATE", detail: "POST 未调用 requireProjectWriteAccess" });
    if (svcIdx < 0) out.push({ code: "ORDER_ANCHOR_MISSING:createProjectSearchRun", detail: "POST 未调用 createProjectSearchRun" });
    if (gateIdx >= 0 && svcIdx >= 0 && !(gateIdx < svcIdx)) {
      out.push({ code: "ROUTE_GATE_AFTER_SERVICE", detail: `写门语句序号 ${gateIdx} 不早于服务调用 ${svcIdx}` });
    }
  }
  const get = findFunction(sf, "GET");
  if (!get || !get.body) {
    out.push({ code: "ROUTE_GET_MISSING", detail: "runs 路由缺 GET" });
  } else if (!contains(get.body, (n) => isCallTo(n, "requireProjectReadAccess"))) {
    out.push({ code: "ROUTE_MISSING_READ_GATE", detail: "GET 未调用 requireProjectReadAccess" });
  }
}

function checkDiscoveryService(text: string, out: BoundaryViolation[]): void {
  const sf = parse("discovery-service.ts", text);
  const fn = findFunction(sf, "executeSupplierSearchRun");
  if (!fn || !fn.body) {
    out.push({ code: "EXECUTE_FN_MISSING", detail: "找不到 executeSupplierSearchRun" });
    return;
  }
  const aclIdx = statementIndexContaining(fn.body, (n) => isCallTo(n, "assertProjectAccessForActor"));
  const planIdx = statementIndexContaining(fn.body, (n) => isCallTo(n, "buildExternalQueryPlan"));
  const egressIdx = statementIndexContaining(fn.body, (n) => isCallTo(n, "discover"));
  if (aclIdx < 0) out.push({ code: "ORDER_ANCHOR_MISSING:assertProjectAccessForActor", detail: "执行器未调用项目 ACL 断言" });
  if (planIdx < 0) out.push({ code: "ORDER_ANCHOR_MISSING:buildExternalQueryPlan", detail: "执行器未调用查询计划构建" });
  if (egressIdx < 0) out.push({ code: "ORDER_ANCHOR_MISSING:discover", detail: "执行器未调用 adapter.discover（外呼点）" });
  if (aclIdx >= 0 && planIdx >= 0 && !(aclIdx < planIdx)) {
    out.push({ code: "ORDER_ACL_AFTER_PLAN", detail: `ACL 语句序号 ${aclIdx} 不早于查询计划 ${planIdx}` });
  }
  if (planIdx >= 0 && egressIdx >= 0 && !(planIdx < egressIdx)) {
    out.push({ code: "ORDER_PLAN_AFTER_EGRESS", detail: `查询计划语句序号 ${planIdx} 不早于外呼 ${egressIdx}` });
  }
  if (aclIdx >= 0 && egressIdx >= 0 && !(aclIdx < egressIdx)) {
    out.push({ code: "ORDER_ACL_AFTER_EGRESS", detail: `ACL 语句序号 ${aclIdx} 不早于外呼 ${egressIdx}` });
  }
}

function checkResolveRoute(text: string, out: BoundaryViolation[]): void {
  const sf = parse("resolve-route.ts", text);
  let usesInjection = false;
  let usesCanonical = false;
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && n.text === "resolveSignalEntityWithPagination") usesInjection = true;
    if (isCallTo(n, "resolveSignalEntity")) usesCanonical = true;
  });
  if (usesInjection) {
    out.push({ code: "RESOLVE_ROUTE_USES_PAGINATION_INJECTION", detail: "HTTP 路由引用了测试注入点 resolveSignalEntityWithPagination（分页参数不得暴露为 HTTP 参数）" });
  }
  if (!usesCanonical) {
    out.push({ code: "RESOLVE_ROUTE_MISSING_CANONICAL_CALL", detail: "resolve 路由未调用生产入口 resolveSignalEntity" });
  }
}

export function checkCanonicalRequirementBoundary(src: BoundarySources): BoundaryViolation[] {
  const out: BoundaryViolation[] = [];
  checkProjectRunService(src.projectRunService, out);
  checkRunsRoute(src.runsRoute, out);
  checkDiscoveryService(src.discoveryService, out);
  checkResolveRoute(src.resolveRoute, out);
  return out;
}

export function violationCodes(violations: BoundaryViolation[]): string[] {
  return violations.map((v) => v.code);
}
