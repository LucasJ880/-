/**
 * FIX-17 守卫：src/app/api/projects/[id]/files/ 下每个路由的每个处理函数都先过项目权限检查（无 DB，CI 里跑）
 *   npx tsx src/lib/projects/__tests__/files-route-guard.test.ts
 *
 * 这个目录下的删除与逐步处理接口曾经只查「已登录」：别的组织的账号拿到项目 ID 就能重置 / 删除文件、
 * 触发解析与模型调用。按目录枚举而不是写死文件清单，这样以后在这里新加路由漏了检查也会失败。
 * 它只证明「先调了守卫」；被拒时数据库与原文件没动由 files-access-db.isolated.test.ts 证明。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

const FILES_ROUTES_DIR = "src/app/api/projects/[id]/files";

/** 现成的三个项目守卫（src/lib/projects/access.ts）；调用了任何一个都算过了权限 */
const GUARD_CALL = /\brequireProject(?:Read|Write|Manage)Access\s*\(/;
/** 守卫的返回值必须被检查：是响应就原样返回 */
const GUARD_RESULT_RETURNED = /instanceof\s+NextResponse\s*\)\s*(?:\{\s*)?return\b/;
/** 「碰数据」的标记：数据库、文件存储、解析、摘要 / 情报（模型）、自动入队、读请求体 */
const TOUCH: ReadonlyArray<[RegExp, string]> = [
  [/\bdb\s*\.\s*\$?\w+/, "数据库"],
  [/\b(?:deleteBlob|putPrivateBlob|readBlobBuffer|readBlobStream)\s*\(/, "文件存储"],
  [/\b(?:parseAndStoreContent|parseDocumentPagesAndStore)\s*\(/, "文件解析"],
  [/\b(?:generateDocumentSummary|generateProjectIntelligence)\s*\(/, "模型调用"],
  [/\b(?:enqueueTenderPackageIfReady|maybeAutoEnqueueOnReady|maybeEnqueueTenderAnalysisAfterUpload)\s*\(/, "自动入队"],
  [/\brequest\s*\.\s*(?:formData|json|text|arrayBuffer|blob)\s*\(/, "读请求体"],
];
const HANDLER_EXPORT = /^export\s+(?:async\s+function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm;

/** 去掉注释，注释里提到 db. 或守卫名都不算数 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

export type HandlerFinding = { method: string; problem: string | null };

/** 逐个处理函数检查：有守卫、检查了守卫结果、守卫在第一次碰数据之前 */
export function checkRouteSource(source: string): HandlerFinding[] {
  const src = stripComments(source);
  const starts: Array<{ method: string; index: number }> = [];
  for (const m of src.matchAll(HANDLER_EXPORT)) starts.push({ method: m[1], index: m.index });
  return starts.map((h, i) => {
    // 处理函数的范围：从它的 export 到下一个顶层 export（或文件末尾）
    const rest = src.slice(h.index + 1);
    const nextExport = rest.search(/^export\s/m);
    const end = Math.min(
      i + 1 < starts.length ? starts[i + 1].index : src.length,
      nextExport >= 0 ? h.index + 1 + nextExport : src.length,
    );
    const body = src.slice(h.index, end);
    const guard = GUARD_CALL.exec(body);
    if (!guard) return { method: h.method, problem: "没有调用项目权限守卫" };
    if (!GUARD_RESULT_RETURNED.test(body.slice(guard.index))) {
      return { method: h.method, problem: "调用了守卫，但没有在它返回响应时原样返回" };
    }
    for (const [re, label] of TOUCH) {
      const t = re.exec(body);
      if (t && t.index < guard.index) {
        return { method: h.method, problem: `在项目权限守卫之前就碰了${label}（${t[0].trim()}）` };
      }
    }
    return { method: h.method, problem: null };
  });
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

/* ---------- 检查器本身认得出漏检查的写法 ---------- */
const unguarded = checkRouteSource(`
export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  await db.projectDocument.updateMany({ where: { projectId: id }, data: {} });
  return NextResponse.json({ ok: true });
});`);
ok(unguarded.length === 1 && unguarded[0].method === "POST" && /没有调用项目权限守卫/.test(unguarded[0].problem ?? ""),
  "检查器：完全不做项目权限检查的处理函数被指出", unguarded);

const late = checkRouteSource(`
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id, fileId } = await ctx.params;
  const doc = await db.projectDocument.findFirst({ where: { id: fileId, projectId: id } });
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ ok: !!doc });
}`);
ok(late.length === 1 && late[0].method === "DELETE" && /之前就碰了数据库/.test(late[0].problem ?? ""),
  "检查器：先读数据库、后做权限检查的处理函数被指出", late);

const unchecked = checkRouteSource(`
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  await requireProjectReadAccess(request, id);
  await db.projectDocument.deleteMany({ where: { projectId: id } });
  return NextResponse.json({ ok: true });
}`);
ok(unchecked.length === 1 && /没有在它返回响应时原样返回/.test(unchecked[0].problem ?? ""),
  "检查器：调了守卫却不看结果的处理函数被指出", unchecked);

const commentedOut = checkRouteSource(`
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  // const access = await requireProjectReadAccess(request, id);
  // if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.projectDocument.findMany({ where: { projectId: id } }));
}`);
ok(commentedOut.length === 1 && /没有调用项目权限守卫/.test(commentedOut[0].problem ?? ""),
  "检查器：被注释掉的守卫不算数", commentedOut);

const good = checkRouteSource(`
/** 这里的注释提到 db.projectDocument 不算碰数据 */
export const GET = withAuth(async (request, ctx) => {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json(await db.projectDocument.findMany({ where: { projectId: id } }));
});
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }
  const body = await request.json();
  return NextResponse.json(await db.project.update({ where: { id }, data: body }));
}`);
ok(good.length === 2 && good.every((h) => h.problem === null), "检查器：先过守卫再碰数据的两种写法都通过", good);

/* ---------- 目录下的真实路由 ---------- */
const root = join(process.cwd(), FILES_ROUTES_DIR);
const routeFiles = listRouteFiles(root).map((f) => relative(process.cwd(), f).split("\\").join("/"));
const EXPECTED = [
  `${FILES_ROUTES_DIR}/[fileId]/route.ts`,
  `${FILES_ROUTES_DIR}/process-next/route.ts`,
  `${FILES_ROUTES_DIR}/route.ts`,
];
ok(EXPECTED.every((f) => routeFiles.includes(f)), "目录下找到已知的三个路由文件（列表与上传、删除、逐步处理）", routeFiles);

const offenders: Array<{ file: string; method: string; problem: string }> = [];
let handlerCount = 0;
for (const file of routeFiles) {
  const findings = checkRouteSource(readFileSync(join(process.cwd(), file), "utf8"));
  ok(findings.length > 0, `${file}：至少导出一个 HTTP 处理函数`);
  for (const f of findings) {
    handlerCount++;
    if (f.problem) offenders.push({ file, method: f.method, problem: f.problem });
    ok(f.problem === null, `${file} ${f.method}：先过项目权限检查，再碰数据库 / 文件存储 / 解析 / 模型 / 入队`, f.problem ?? undefined);
  }
}
ok(handlerCount >= 4, "目录下一共至少四个处理函数（列表、上传、删除、逐步处理）", handlerCount);
if (offenders.length > 0) {
  console.error("\n漏了项目权限检查的处理函数：");
  for (const o of offenders) console.error(`  - ${o.file} ${o.method}：${o.problem}`);
}

console.log(`\nFIX-17 project files route guard: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
