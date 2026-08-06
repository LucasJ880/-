import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { middleware } from "../../../middleware";

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "marketing-middleware-test-secret";

async function token(role: string) {
  return new SignJWT({ sub: `user-${role}`, email: `${role}@example.test`, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

async function request(pathname: string, role: string) {
  return new NextRequest(`https://qingyan.test${pathname}`, {
    headers: { cookie: `qy_session=${await token(role)}` },
  });
}

test("销售访问营销页面会被送回销售工作区", async () => {
  const response = await middleware(await request("/operations/growth/metrics", "sales"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://qingyan.test/sales");
});

test("销售直接调用营销 API 得到 403", async () => {
  const response = await middleware(await request("/api/marketing/dashboard", "sales"));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "销售账号无权访问营销工作区" });
});

test("运营可继续访问营销页面，销售业务页面不受影响", async () => {
  const operationsResponse = await middleware(await request("/operations/growth", "operations"));
  assert.equal(operationsResponse.headers.get("x-middleware-next"), "1");
  const salesResponse = await middleware(await request("/sales/quote-sheet", "sales"));
  assert.equal(salesResponse.headers.get("x-middleware-next"), "1");
});

test.after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
