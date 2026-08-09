/* eslint-disable no-console */
import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabase } from "../src/lib/testing/assert-safe-test-database";

// Fail-closed：禁止对生产/未识别数据库执行 destructive 测试
assertSafeTestDatabase({ scriptName: "scripts/preview-hd-mask-failure-path.ts" });

const qa = JSON.parse(
  readFileSync("tmp/visualizer-hd-e2e/preview-acceptance/qa-login.local.json", "utf8"),
);
const summary = JSON.parse(
  readFileSync("tmp/visualizer-hd-e2e/preview-acceptance/summary.json", "utf8"),
);
const base = (process.env.PREVIEW_BASE || "http://127.0.0.1:3010").replace(/\/$/, "");

async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: qa.email, password: qa.password }),
  });
  if (!res.ok) throw new Error("login " + res.status);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  const cookie = await login();
  const db = new PrismaClient();
  const sessionId = summary.sample1.sessionId as string;
  const prevExport = (
    await db.visualizerVariant.findUnique({
      where: { id: summary.sample1.variantId },
      select: { exportImageUrl: true },
    })
  )!.exportImageUrl!;

  const emptyVariant = await db.visualizerVariant.create({
    data: { sessionId, name: "PREVIEW TEST - empty fail", sortOrder: 99 },
  });

  const res = await fetch(
    `${base}/api/visualizer/variants/${emptyVariant.id}/render-hd`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "x-org-id": qa.orgId,
      },
      body: JSON.stringify({}),
    },
  );
  const json = (await res.json()) as {
    error?: string;
    code?: string;
    exportImageUrl?: string | null;
  };
  const after = await db.visualizerVariant.findUnique({
    where: { id: summary.sample1.variantId },
    select: { exportImageUrl: true },
  });
  await db.$disconnect();

  const out = {
    status: res.status,
    code: json.code || null,
    error: String(json.error || "").slice(0, 200),
    failed: res.status >= 400,
    preservedPreviousExport: after?.exportImageUrl === prevExport,
    explicitError: !!json.error,
    noFakeSuccess: res.status >= 400,
  };
  writeFileSync(
    "tmp/visualizer-hd-e2e/preview-acceptance/failure-path.json",
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  if (!(out.failed && out.preservedPreviousExport && out.explicitError)) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
