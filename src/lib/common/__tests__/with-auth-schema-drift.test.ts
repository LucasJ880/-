/**
 * withAuth Schema 漂移错误映射（P2021/P2022 → 503）
 * 运行：npx tsx src/lib/common/__tests__/with-auth-schema-drift.test.ts
 */
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import {
  isSchemaDriftPrismaError,
  jsonForWithAuthCatch,
  withAuth,
} from "../api-helpers";

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

function prismaKnown(code: string, message: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: "6.19.2",
    meta,
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function main() {
  console.log("\nisSchemaDriftPrismaError");
  ok(
    isSchemaDriftPrismaError(prismaKnown("P2021", 'Table "SecretTable" does not exist')),
    "P2021 true",
  );
  ok(
    isSchemaDriftPrismaError(prismaKnown("P2022", 'Column "secret_col" does not exist')),
    "P2022 true",
  );
  ok(!isSchemaDriftPrismaError(prismaKnown("P2002", "Unique constraint failed")), "P2002 false");
  ok(!isSchemaDriftPrismaError(new Error("P2022 in message only")), "plain Error false");
  ok(!isSchemaDriftPrismaError({ code: "P2021" }), "plain object false");

  console.log("\njsonForWithAuthCatch");
  {
    const res = jsonForWithAuthCatch(
      prismaKnown(
        "P2021",
        "The table `public.SecretLeakTable` does not exist in the current database.",
        { table: "SecretLeakTable" },
      ),
      "req-p2021",
    );
    const body = await readJson(res);
    const text = JSON.stringify(body);
    ok(res.status === 503, "P2021 status 503");
    ok(body.code === "P2021", "P2021 code");
    ok(body.requestId === "req-p2021", "P2021 requestId");
    ok(!text.includes("SecretLeakTable"), "P2021 no table leak");
    ok(!text.includes("SELECT"), "P2021 no SQL leak");
  }
  {
    const res = jsonForWithAuthCatch(
      prismaKnown(
        "P2022",
        "The column `secret_col` does not exist in the current database.",
        { column: "secret_col" },
      ),
      "req-p2022",
    );
    const body = await readJson(res);
    const text = JSON.stringify(body);
    ok(res.status === 503, "P2022 status 503");
    ok(body.code === "P2022", "P2022 code");
    ok(body.requestId === "req-p2022", "P2022 requestId");
    ok(!text.includes("secret_col"), "P2022 no column leak");
  }
  {
    const res = jsonForWithAuthCatch(new Error("boom SELECT * FROM secrets"), "req-500");
    const body = await readJson(res);
    const text = JSON.stringify(body);
    ok(res.status === 500, "unknown → 500");
    ok(body.code === undefined, "unknown has no code");
    ok(body.requestId === "req-500", "unknown requestId");
    ok(!text.includes("SELECT"), "500 body no SQL from message");
    ok(!text.includes("secrets"), "500 body no leaked fragment");
  }

  console.log("\nwithAuth auth path (not remapped to 503)");
  {
    const handler = withAuth(async () => {
      throw new Error("should not run");
    });
    const nextReq = new NextRequest("http://localhost/api/test", {
      headers: { "x-request-id": "req-unauth" },
    });
    const res = await handler(nextReq, { params: Promise.resolve({}) });
    const body = await readJson(res);
    ok(res.status === 401, "unauthenticated → 401");
    ok(body.error === "未登录", "unauthenticated message");
    ok(body.code !== "P2021" && body.code !== "P2022", "auth not schema codes");
  }

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
