/**
 * FIX-17 项目文件接口的项目权限检查 — DB + HTTP（隔离库执行，否则跳过）
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx src/lib/projects/__tests__/files-access-db.isolated.test.ts
 *
 * 直接调路由导出的处理函数（带 createSession 签的会话 cookie），对应
 * openspec/specs/projects/files-access 的每条 Scenario：
 *   - 未登录 / 已停用账号 401；别的组织、同组织非成员、inactive 成员 403；不存在与未分发项目 404；
 *   - 被拒之后文件行逐字段不变、存储里的原文件还在、响应不带文件 ID / 标题 / 解析报错；
 *   - 成员、负责人、组织管理员、super_admin 照常可用；成员重试重置失败文件；成员删除后行与原文件都没了。
 *
 * 原文件用 blob-access 的本地存储开关（PRODUCT_CONTENT_LOCAL_STORE=1 + 临时目录）放真文件来观察。
 * 有权限的路径不触发解析与模型：失败的文件用不进解析队列的类型（png），项目里没有已完成的摘要，
 * 所以成员调 process-next 走到 step = none；测试不配任何模型密钥。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 FIX-17 项目文件权限 DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 FIX-17 项目文件权限 DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.log("⏭  跳过 FIX-17 项目文件权限 DB 测试（需 DATABASE_ENVIRONMENT=isolated）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "fix-17 project files access" });
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
  }
}

async function main() {
  requireIsolatedTestDb();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "fix17-project-files-access-test-secret";
  const blobDir = fs.mkdtempSync(path.join(os.tmpdir(), "fix17-blobs-"));
  process.env.PRODUCT_CONTENT_LOCAL_STORE = "1";
  process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR = blobDir;

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { putPrivateBlob } = await import("@/lib/files/blob-access");
  const filesRoute = await import("@/app/api/projects/[id]/files/route");
  const fileItemRoute = await import("@/app/api/projects/[id]/files/[fileId]/route");
  const processNextRoute = await import("@/app/api/projects/[id]/files/process-next/route");

  const tag = `fix17_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const SECRET_TITLE = `SECRET_TITLE_${tag}.pdf`;
  const SECRET_PARSE_ERROR = `SECRET_PARSE_ERROR_${tag}`;
  const SECRET_TEXT = `SECRET_EXTRACTED_TEXT_${tag}`;
  const SECRET_SUMMARY = JSON.stringify({ summary: `SECRET_SUMMARY_${tag}` });

  // ───────────────────────── 夹具 ─────────────────────────
  const mkUser = (slug: string, opts: { status?: string; role?: string } = {}) =>
    db.user.create({
      data: {
        email: `${slug}_${tag}@test.qingyan.local`,
        name: slug,
        role: opts.role ?? "user",
        status: opts.status ?? "active",
      },
    });

  const uOwner = await mkUser("f17_owner");
  const uOrgAdmin = await mkUser("f17_org_admin"); // 组织管理员，不是项目成员
  const uMember = await mkUser("f17_member"); // 项目成员（viewer）
  const uSameOrg = await mkUser("f17_same_org"); // 同组织普通成员，不是项目成员
  const uInactiveMember = await mkUser("f17_inactive_member"); // 项目成员身份 inactive
  const uSuspended = await mkUser("f17_suspended", { status: "suspended" }); // 账号已停用（曾是项目成员）
  const uOutsider = await mkUser("f17_outsider"); // 另一个组织的用户
  const uSuper = await mkUser("f17_super", { role: "super_admin" }); // 不属于任何一个组织

  const orgA = await db.organization.create({
    data: { name: `F17 OrgA ${tag}`, code: `f17a_${tag}`, ownerId: uOwner.id, status: "active" },
  });
  const orgB = await db.organization.create({
    data: { name: `F17 OrgB ${tag}`, code: `f17b_${tag}`, ownerId: uOutsider.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: uOwner.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uOrgAdmin.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: uMember.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uSameOrg.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uInactiveMember.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uSuspended.id, role: "org_member", status: "active" },
      { orgId: orgB.id, userId: uOutsider.id, role: "org_admin", status: "active" },
    ],
  });

  const mkProject = (orgId: string, ownerId: string, slug: string, intakeStatus = "dispatched") =>
    db.project.create({
      data: { orgId, name: `F17 ${slug} ${tag}`, ownerId, intakeStatus },
    });
  const projA = await mkProject(orgA.id, uOwner.id, "ProjA"); // 主项目：没有待解析的可解析文件
  const projProbe = await mkProject(orgA.id, uOwner.id, "ProjProbe"); // 放一份待解析的 pdf，专门给被拒的逐步处理用
  const projPending = await mkProject(orgA.id, uOwner.id, "ProjPending", "pending_dispatch"); // 未分发
  const projB = await mkProject(orgB.id, uOutsider.id, "ProjB"); // 组织乙的项目
  await db.projectMember.createMany({
    data: [
      { projectId: projA.id, userId: uMember.id, role: "viewer", status: "active" },
      { projectId: projA.id, userId: uInactiveMember.id, role: "viewer", status: "inactive" },
      { projectId: projA.id, userId: uSuspended.id, role: "viewer", status: "active" },
      { projectId: projProbe.id, userId: uMember.id, role: "viewer", status: "active" },
      { projectId: projPending.id, userId: uMember.id, role: "viewer", status: "active" },
    ],
  });

  let docSeq = 0;
  /** 解析失败的文件：png 不进解析队列，重置后也不会触发解析 */
  const mkFailedDoc = (projectId: string) =>
    db.projectDocument.create({
      data: {
        projectId,
        title: `${SECRET_TITLE}.failed.${(docSeq += 1)}.png`,
        url: `https://example.invalid/${tag}/failed-${docSeq}.png`,
        fileType: "png",
        source: "upload",
        parseStatus: "failed",
        parseError: SECRET_PARSE_ERROR,
        contentText: SECRET_TEXT,
        aiSummaryStatus: "failed",
        aiSummaryJson: SECRET_SUMMARY,
      },
    });
  /** 带真实原文件的文件：存储里放一个真文件 */
  const mkBlobDoc = async (projectId: string) => {
    docSeq += 1;
    const pathname = `projects/${projectId}/${tag}_${docSeq}.png`;
    const blob = await putPrivateBlob({ pathname, body: Buffer.from(`blob-${tag}-${docSeq}`), contentType: "image/png" });
    const doc = await db.projectDocument.create({
      data: {
        projectId,
        title: `${SECRET_TITLE}.blob.${docSeq}.png`,
        url: blob.proxyUrl,
        blobUrl: blob.proxyUrl,
        fileType: "png",
        source: "upload",
        parseStatus: "done",
        aiSummaryStatus: "pending",
      },
    });
    return { doc, absPath: path.join(blobDir, pathname) };
  };
  const SNAPSHOT_SELECT = {
    id: true, projectId: true, title: true, url: true, blobUrl: true, fileType: true,
    parseStatus: true, parseError: true, contentText: true, aiSummaryStatus: true, aiSummaryJson: true,
  } as const;
  const snapshot = async (docId: string) =>
    JSON.stringify(await db.projectDocument.findUnique({ where: { id: docId }, select: SNAPSHOT_SELECT }));

  // ───────────────────────── 请求 ─────────────────────────
  type TestUser = { id: string; email: string; role: string };
  const cookieFor = async (user: TestUser | null) =>
    user ? `qy_session=${await createSession({ sub: user.id, email: user.email, role: user.role })}` : "";
  const mkRequest = async (user: TestUser | null, method: string, url: string) => {
    const cookie = await cookieFor(user);
    return new NextRequest(`http://localhost${url}`, { method, headers: cookie ? { cookie } : {} });
  };
  type CallResult = { status: number; body: Record<string, unknown>; text: string };
  const read = async (res: Response): Promise<CallResult> => {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* 非 JSON 响应，body 留空 */
    }
    return { status: res.status, body, text };
  };
  const processNext = async (user: TestUser | null, projectId: string, retry = false) =>
    read(
      await processNextRoute.POST(
        await mkRequest(user, "POST", `/api/projects/${projectId}/files/process-next${retry ? "?retry=1" : ""}`),
        { params: Promise.resolve({ id: projectId }) },
      ),
    );
  const deleteFile = async (user: TestUser | null, projectId: string, fileId: string) =>
    read(
      await fileItemRoute.DELETE(
        await mkRequest(user, "DELETE", `/api/projects/${projectId}/files/${fileId}`),
        { params: Promise.resolve({ id: projectId, fileId }) },
      ),
    );
  const listFiles = async (user: TestUser | null, projectId: string) =>
    read(
      await filesRoute.GET(await mkRequest(user, "GET", `/api/projects/${projectId}/files`), {
        params: Promise.resolve({ id: projectId }),
      }),
    );
  const uploadFiles = async (user: TestUser | null, projectId: string) =>
    read(
      await filesRoute.POST(await mkRequest(user, "POST", `/api/projects/${projectId}/files`), {
        params: Promise.resolve({ id: projectId }),
      }),
    );

  /** 被拒的响应：只有 error（可带 requestId），不出现任何文件信息 */
  const LEAK_KEYS = ["documentId", "documentTitle", "parseError", "parseStatus", "documents", "step", "remaining", "url", "blobUrl"];
  const noFileInfo = (r: CallResult) =>
    Object.keys(r.body).every((k) => k === "error" || k === "requestId") &&
    LEAK_KEYS.every((k) => !(k in r.body)) &&
    ![SECRET_TITLE, SECRET_PARSE_ERROR, SECRET_TEXT, `SECRET_SUMMARY_${tag}`].some((s) => r.text.includes(s));

  try {
    // ───────────────────────── 未登录返回 401 ─────────────────────────
    console.log("未登录返回 401");
    {
      const failed = await mkFailedDoc(projA.id);
      const blob = await mkBlobDoc(projA.id);
      const beforeFailed = await snapshot(failed.id);
      const beforeBlob = await snapshot(blob.doc.id);

      const r1 = await processNext(null, projA.id, true);
      ok(r1.status === 401 && r1.body.error === "未登录", "未登录调 process-next?retry=1 → 401「未登录」", r1);
      const r2 = await deleteFile(null, projA.id, blob.doc.id);
      ok(r2.status === 401 && r2.body.error === "未登录", "未登录调 DELETE → 401「未登录」", r2);
      ok((await snapshot(failed.id)) === beforeFailed, "未登录的重试没有重置失败的文件");
      ok((await snapshot(blob.doc.id)) === beforeBlob && fs.existsSync(blob.absPath), "未登录的删除没有删文件记录与原文件");
      ok(noFileInfo(r1) && noFileInfo(r2), "未登录的响应不带文件信息", [r1.body, r2.body]);

      const r3 = await deleteFile(uSuspended, projA.id, blob.doc.id);
      ok(r3.status === 401, "已停用的账号带着会话调 DELETE → 401", r3);
      ok((await snapshot(blob.doc.id)) === beforeBlob && fs.existsSync(blob.absPath), "已停用的账号没有删掉文件记录与原文件");
      const r4 = await listFiles(null, projA.id);
      const r5 = await uploadFiles(null, projA.id);
      ok(r4.status === 401 && r5.status === 401, "未登录调列表与上传 → 401", [r4.status, r5.status]);
    }

    // ───────────────────────── 别的组织的用户 403 ─────────────────────────
    console.log("与项目无关的登录用户返回 403：别的组织的用户");
    {
      const failed = await mkFailedDoc(projA.id);
      const beforeFailed = await snapshot(failed.id);

      const r1 = await processNext(uOutsider, projA.id, false);
      ok(r1.status === 403 && r1.body.error === "无权查看该项目", "别的组织的用户调 process-next → 403「无权查看该项目」", r1);
      const r2 = await processNext(uOutsider, projA.id, true);
      ok(r2.status === 403 && r2.body.error === "无权查看该项目", "别的组织的用户调 process-next?retry=1 → 403", r2);
      ok((await snapshot(failed.id)) === beforeFailed, "被拒的重试：解析状态、解析报错、已抽取文字、摘要状态与摘要内容都与请求前一致", await snapshot(failed.id));
      ok(noFileInfo(r1) && noFileInfo(r2), "被拒的 process-next 响应不带文件信息", [r1.body, r2.body]);

      const blob = await mkBlobDoc(projA.id);
      const beforeBlob = await snapshot(blob.doc.id);
      const r3 = await deleteFile(uOutsider, projA.id, blob.doc.id);
      ok(r3.status === 403 && r3.body.error === "无权查看该项目", "别的组织的用户调 DELETE（真实存在的文件）→ 403", r3);
      ok((await snapshot(blob.doc.id)) === beforeBlob, "被拒的删除：文件记录还在且未变");
      ok(fs.existsSync(blob.absPath), "被拒的删除：存储里的原文件还在");
      ok(noFileInfo(r3), "被拒的 DELETE 响应不带文件信息", r3.body);

      const r4 = await listFiles(uOutsider, projA.id);
      const r5 = await uploadFiles(uOutsider, projA.id);
      ok(r4.status === 403 && r5.status === 403, "别的组织的用户调列表与上传 → 403", [r4.status, r5.status]);
      ok(noFileInfo(r4) && noFileInfo(r5), "被拒的列表与上传响应不带文件信息", [r4.body, r5.body]);
    }

    // ───────────────────────── 被拒的逐步处理不回文件标题与报错、不启动解析 ─────────────────────────
    console.log("被拒的逐步处理：有待解析文件的项目");
    {
      const pending = await db.projectDocument.create({
        data: {
          projectId: projProbe.id,
          title: `${SECRET_TITLE}.pending.pdf`,
          url: `https://example.invalid/${tag}/pending.pdf`,
          fileType: "pdf",
          source: "upload",
          parseStatus: "pending",
        },
      });
      const failed = await mkFailedDoc(projProbe.id);
      const beforePending = await snapshot(pending.id);
      const beforeFailed = await snapshot(failed.id);

      const r1 = await processNext(uOutsider, projProbe.id, false);
      ok(r1.status === 403, "别的组织的用户对有待解析文件的项目调 process-next → 403", r1);
      ok(noFileInfo(r1), "响应里没有 documentId / documentTitle / parseError，也不出现文件标题与报错文字", r1.body);
      ok((await snapshot(pending.id)) === beforePending, "待解析的文件没有被解析（状态与报错都没变）", await snapshot(pending.id));
      ok((await snapshot(failed.id)) === beforeFailed, "带解析报错的文件没有被动过");
      const [intel, runs] = await Promise.all([
        db.projectIntelligence.count({ where: { projectId: { in: [projA.id, projProbe.id] } } }),
        db.tenderAnalysisRun.count({ where: { projectId: { in: [projA.id, projProbe.id] } } }),
      ]);
      ok(intel === 0 && runs === 0, "被拒的请求没有生成项目情报、没有把招标分析入队", { intel, runs });
    }

    // ───────────────────────── 同组织但不是项目成员 / inactive 成员 403 ─────────────────────────
    console.log("与项目无关的登录用户返回 403：同组织非成员、已停用的项目成员");
    {
      const failed = await mkFailedDoc(projA.id);
      const blob = await mkBlobDoc(projA.id);
      const beforeFailed = await snapshot(failed.id);
      const beforeBlob = await snapshot(blob.doc.id);

      const r1 = await deleteFile(uSameOrg, projA.id, blob.doc.id);
      ok(r1.status === 403 && r1.body.error === "无权查看该项目", "同组织但不是项目成员调 DELETE → 403", r1);
      const r2 = await processNext(uSameOrg, projA.id, true);
      ok(r2.status === 403, "同组织但不是项目成员调 process-next?retry=1 → 403", r2);
      const r3 = await processNext(uInactiveMember, projA.id, true);
      ok(r3.status === 403, "项目成员身份为 inactive 的用户调 process-next?retry=1 → 403", r3);
      const r4 = await deleteFile(uInactiveMember, projA.id, blob.doc.id);
      ok(r4.status === 403, "项目成员身份为 inactive 的用户调 DELETE → 403", r4);
      ok((await snapshot(failed.id)) === beforeFailed, "这几次被拒的重试都没有重置失败的文件");
      ok((await snapshot(blob.doc.id)) === beforeBlob && fs.existsSync(blob.absPath), "这几次被拒的删除都没有删文件记录与原文件");
      ok([r1, r2, r3, r4].every(noFileInfo), "响应都不带文件信息");
    }

    // ───────────────────────── 项目不存在或未分发 404 ─────────────────────────
    console.log("项目不存在或未分发返回 404");
    {
      const ghost = `no_such_project_${tag}`;
      const r1 = await processNext(uMember, ghost, false);
      ok(r1.status === 404 && r1.body.error === "项目不存在", "不存在的项目 ID 调 process-next → 404「项目不存在」", r1);
      const r2 = await deleteFile(uMember, ghost, `no_such_file_${tag}`);
      ok(r2.status === 404 && r2.body.error === "项目不存在", "不存在的项目 ID 调 DELETE → 404「项目不存在」", r2);

      const failed = await mkFailedDoc(projPending.id);
      const blob = await mkBlobDoc(projPending.id);
      const beforeFailed = await snapshot(failed.id);
      const beforeBlob = await snapshot(blob.doc.id);
      const r3 = await processNext(uMember, projPending.id, true);
      ok(r3.status === 404 && r3.body.error === "项目不存在", "成员对未分发的项目调 process-next?retry=1 → 404", r3);
      ok((await snapshot(failed.id)) === beforeFailed, "未分发项目里失败的文件没有被重置");
      const r4 = await deleteFile(uMember, projPending.id, blob.doc.id);
      ok(r4.status === 404 && r4.body.error === "项目不存在", "成员对未分发的项目调 DELETE → 404「项目不存在」", r4);
      ok((await snapshot(blob.doc.id)) === beforeBlob && fs.existsSync(blob.absPath), "未分发项目的文件记录与原文件都还在");
      ok([r1, r2, r3, r4].every(noFileInfo), "404 响应都不带文件信息");
      const r5 = await processNext(uSuper, projPending.id, false);
      ok(r5.status === 200, "super_admin 对未分发的项目调 process-next → 200", r5);
    }

    // ───────────────────────── 删除只认本项目的文件 ─────────────────────────
    console.log("删除只认本项目的文件");
    {
      const other = await mkBlobDoc(projB.id);
      const before = await snapshot(other.doc.id);
      const r1 = await deleteFile(uMember, projA.id, other.doc.id);
      ok(r1.status === 404 && r1.body.error === "文件不存在", "项目甲的成员用项目乙的文件 ID 调 DELETE → 404「文件不存在」", r1);
      ok((await snapshot(other.doc.id)) === before && fs.existsSync(other.absPath), "项目乙的这份文件记录与原文件都还在");
      const r2 = await deleteFile(uMember, projA.id, `no_such_file_${tag}`);
      ok(r2.status === 404 && r2.body.error === "文件不存在", "不存在的文件 ID → 404「文件不存在」", r2);
    }

    // ───────────────────────── 有权限的人照常可用 ─────────────────────────
    console.log("项目文件接口只对与项目有关的人开放：成员、负责人、组织管理员、super_admin");
    {
      const r1 = await processNext(uMember, projA.id, false);
      ok(r1.status === 200 && r1.body.done === true && r1.body.step === "none", "成员（viewer）调 process-next → 200，done = true、step = none", r1);

      const failed = await mkFailedDoc(projA.id);
      const r2 = await processNext(uMember, projA.id, true);
      const after = await db.projectDocument.findUnique({ where: { id: failed.id }, select: SNAPSHOT_SELECT });
      ok(r2.status === 200, "成员调 process-next?retry=1 → 200", r2);
      ok(
        after?.parseStatus === "pending" && after.parseError === null && after.contentText === null &&
          after.aiSummaryStatus === "pending" && after.aiSummaryJson === null,
        "成员的重试把失败的文件放回待解析、清空解析报错",
        after,
      );

      const r3 = await processNext(uOwner, projA.id, false);
      const r4 = await processNext(uOrgAdmin, projA.id, false);
      const r5 = await processNext(uSuper, projA.id, false);
      ok(r3.status === 200, "项目负责人调 process-next → 200", r3);
      ok(r4.status === 200, "项目所在组织的管理员（不是项目成员）调 process-next → 200", r4);
      ok(r5.status === 200, "平台 super_admin（不属于该组织）调 process-next → 200", r5);

      const blob = await mkBlobDoc(projA.id);
      const r6 = await listFiles(uMember, projA.id);
      const listed = Array.isArray(r6.body.documents) ? (r6.body.documents as Array<{ id: string }>) : [];
      ok(r6.status === 200 && listed.some((d) => d.id === blob.doc.id), "成员调文件列表 → 200，列表里有这份文件", r6.status);

      const r7 = await deleteFile(uMember, projA.id, blob.doc.id);
      ok(r7.status === 200 && r7.body.success === true && Object.keys(r7.body).length === 1, "成员调 DELETE → 200，正文为 {\"success\":true}", r7);
      ok((await db.projectDocument.findUnique({ where: { id: blob.doc.id } })) === null, "成员删除后文件记录不存在了");
      ok(!fs.existsSync(blob.absPath), "成员删除后存储里的原文件不存在了");

      const blob2 = await mkBlobDoc(projA.id);
      const r8 = await deleteFile(uOwner, projA.id, blob2.doc.id);
      ok(r8.status === 200 && !fs.existsSync(blob2.absPath), "项目负责人调 DELETE → 200，原文件也删了", r8);
    }
  } finally {
    // ───────────────────────── 清理 ─────────────────────────
    const projectIds = [projA.id, projProbe.id, projPending.id, projB.id];
    const orgIds = [orgA.id, orgB.id];
    const userIds = [uOwner, uOrgAdmin, uMember, uSameOrg, uInactiveMember, uSuspended, uOutsider, uSuper].map((u) => u.id);
    const quiet = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        console.log(`  （清理 ${label} 失败，留在隔离库里：${e instanceof Error ? e.message.split("\n")[0] : String(e)}）`);
      }
    };
    await quiet("tenderAnalysisRun", () => db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("projectIntelligence", () => db.projectIntelligence.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("projectDocument", () => db.projectDocument.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("projectMember", () => db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }));
    await quiet("auditLog", () => db.auditLog.deleteMany({ where: { orgId: { in: orgIds } } }));
    await quiet("notification", () => db.notification.deleteMany({ where: { userId: { in: userIds } } }));
    await quiet("project", () => db.project.deleteMany({ where: { id: { in: projectIds } } }));
    await quiet("organizationMember", () => db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } }));
    await quiet("organization", () => db.organization.deleteMany({ where: { id: { in: orgIds } } }));
    await quiet("user", () => db.user.deleteMany({ where: { id: { in: userIds } } }));
    fs.rmSync(blobDir, { recursive: true, force: true });
    await db.$disconnect();
  }

  console.log(`\nFIX-17 project files access (DB + HTTP): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
