/**
 * product-visual-builder storage 测试（Phase 1D-Storage）
 *
 * 不连接真实 Blob、不调用网络：仅测试纯路径/校验函数与 uploadVisualBuilderImage 的 dryRun 分支。
 *
 * 运行：npx tsx src/lib/skills/product-visual-builder/__tests__/storage.test.ts
 */
import {
  buildVisualBuilderBlobPath,
  validateVisualBuilderImageFile,
  uploadVisualBuilderImage,
  VISUAL_BUILDER_MAX_SOURCE_BYTES,
  VISUAL_BUILDER_MAX_GENERATED_BYTES,
} from "../storage";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}
function throws(fn: () => unknown, name: string) {
  try {
    fn();
    fail++;
    console.error(`  ✗ ${name}（未抛错）`);
  } catch {
    pass++;
  }
}

const FIXED_DATE = new Date("2026-06-27T00:00:00.000Z");

async function main() {
  // 1. 正常路径
  {
    const p = buildVisualBuilderBlobPath({
      orgId: "org_abc",
      executionId: "exec_123",
      assetRole: "source",
      index: 0,
      ext: "jpg",
      date: FIXED_DATE,
    });
    ok(p === "visual-builder/org_abc/2026/06/exec_123/source-0.jpg", "path: 正常路径");
  }

  // 2. 不同 assetRole
  {
    const roles: [string, string][] = [
      ["generated", "visual-builder/org_abc/2026/06/exec_123/generated-1.png"],
      ["spec-sheet", "visual-builder/org_abc/2026/06/exec_123/spec-sheet-2.webp"],
      ["lifestyle", "visual-builder/org_abc/2026/06/exec_123/lifestyle-3.png"],
    ];
    const exts = ["png", "webp", "png"];
    roles.forEach(([role, expected], i) => {
      const p = buildVisualBuilderBlobPath({
        orgId: "org_abc",
        executionId: "exec_123",
        // @ts-expect-error 运行时用字符串测试已知合法 role
        assetRole: role,
        index: i + 1,
        ext: exts[i],
        date: FIXED_DATE,
      });
      ok(p === expected, `path: assetRole=${role}`);
    });
  }

  // 3. 非法 assetRole 拒绝
  {
    for (const role of ["random", "avatar", "contract"]) {
      throws(
        () =>
          buildVisualBuilderBlobPath({
            orgId: "org_abc",
            executionId: "exec_123",
            // @ts-expect-error 故意传非法 role
            assetRole: role,
            index: 0,
            ext: "png",
            date: FIXED_DATE,
          }),
        `path: 非法 assetRole=${role} 拒绝`,
      );
    }
  }

  // 4. 非法 ext 拒绝
  {
    for (const ext of ["exe", "svg", "pdf"]) {
      throws(
        () =>
          buildVisualBuilderBlobPath({
            orgId: "org_abc",
            executionId: "exec_123",
            assetRole: "source",
            index: 0,
            ext,
            date: FIXED_DATE,
          }),
        `path: 非法 ext=${ext} 拒绝`,
      );
    }
  }

  // 5. index 非负整数
  {
    for (const idx of [-1, 1.5, NaN]) {
      throws(
        () =>
          buildVisualBuilderBlobPath({
            orgId: "org_abc",
            executionId: "exec_123",
            assetRole: "source",
            index: idx,
            ext: "png",
            date: FIXED_DATE,
          }),
        `path: 非法 index=${idx} 拒绝`,
      );
    }
  }

  // 6. 路径安全：危险 orgId / executionId 拒绝
  {
    const bad = ["../etc", "org abc", "组织", "org?x=1", "a/b", "a\\b"];
    for (const v of bad) {
      throws(
        () =>
          buildVisualBuilderBlobPath({
            orgId: v,
            executionId: "exec_123",
            assetRole: "source",
            index: 0,
            ext: "png",
            date: FIXED_DATE,
          }),
        `path: 危险 orgId=${JSON.stringify(v)} 拒绝`,
      );
      throws(
        () =>
          buildVisualBuilderBlobPath({
            orgId: "org_abc",
            executionId: v,
            assetRole: "source",
            index: 0,
            ext: "png",
            date: FIXED_DATE,
          }),
        `path: 危险 executionId=${JSON.stringify(v)} 拒绝`,
      );
    }
  }

  // 7. MIME 校验
  {
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      const r = validateVisualBuilderImageFile({ sizeBytes: 1024, mimeType: mime, assetRole: "source" });
      ok(r.ok === true, `mime: 允许 ${mime}`);
    }
    for (const mime of ["application/pdf", "image/svg+xml", "text/plain"]) {
      const r = validateVisualBuilderImageFile({ sizeBytes: 1024, mimeType: mime, assetRole: "source" });
      ok(r.ok === false, `mime: 拒绝 ${mime}`);
    }
  }

  // 8. 大小校验
  {
    const okSource = validateVisualBuilderImageFile({
      sizeBytes: VISUAL_BUILDER_MAX_SOURCE_BYTES,
      mimeType: "image/png",
      assetRole: "source",
    });
    ok(okSource.ok === true, "size: source 5MB 通过");

    const bigSource = validateVisualBuilderImageFile({
      sizeBytes: VISUAL_BUILDER_MAX_SOURCE_BYTES + 1,
      mimeType: "image/png",
      assetRole: "source",
    });
    ok(bigSource.ok === false, "size: source >5MB 拒绝");

    const genOk = validateVisualBuilderImageFile({
      sizeBytes: VISUAL_BUILDER_MAX_SOURCE_BYTES + 1,
      mimeType: "image/png",
      assetRole: "generated",
    });
    ok(genOk.ok === true, "size: generated 6MB 通过（>source 上限）");

    const bigGen = validateVisualBuilderImageFile({
      sizeBytes: VISUAL_BUILDER_MAX_GENERATED_BYTES + 1,
      mimeType: "image/png",
      assetRole: "generated",
    });
    ok(bigGen.ok === false, "size: generated >10MB 拒绝");
  }

  // 9. 文件名安全
  {
    ok(
      validateVisualBuilderImageFile({ sizeBytes: 1024, mimeType: "image/png", assetRole: "source", filename: "photo.png" }).ok === true,
      "filename: 正常文件名通过",
    );
    for (const fn of ["../evil.png", "a b.png", "图片.png", "x.png?y=1", "a/b.png"]) {
      ok(
        validateVisualBuilderImageFile({ sizeBytes: 1024, mimeType: "image/png", assetRole: "source", filename: fn }).ok === false,
        `filename: 危险 ${JSON.stringify(fn)} 拒绝`,
      );
    }
  }

  // 10. dryRun upload：不调用真实 Blob，返回 pathname
  {
    const res = await uploadVisualBuilderImage({
      orgId: "org_abc",
      executionId: "exec_123",
      assetRole: "generated",
      index: 0,
      ext: "png",
      mimeType: "image/png",
      date: FIXED_DATE,
      dryRun: true,
    });
    ok(res.dryRun === true, "dryRun: dryRun=true");
    ok(res.pathname === "visual-builder/org_abc/2026/06/exec_123/generated-0.png", "dryRun: pathname 正确");
    ok(res.url === "", "dryRun: url 为空（未上传）");
    ok(res.accessMode === "public", "dryRun: accessMode=public");
  }

  // 11. dryRun upload：非法 mime 仍拒绝（不上传）
  {
    let threw = false;
    try {
      await uploadVisualBuilderImage({
        orgId: "org_abc",
        executionId: "exec_123",
        assetRole: "generated",
        index: 0,
        ext: "png",
        mimeType: "application/pdf",
        date: FIXED_DATE,
        dryRun: true,
      });
    } catch {
      threw = true;
    }
    ok(threw, "dryRun: 非法 mime 抛错（不上传）");
  }

  console.log(`product-visual-builder storage: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
