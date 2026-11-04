/**
 * 微信入口开关 WECHAT_BINDING_ENABLED 取值表（openspec change hide-wechat-entry / COLLAB-1）。
 * 去首尾空白、不分大小写后为 1 / true / on 才开；未设置、空串与其他任何值都为关。
 * 纯函数，无 DB、无网络。
 * 运行：npx tsx src/lib/messaging/__tests__/wechat-entry-flag.test.ts
 */
import assert from "node:assert/strict";
import { isWechatBindingEnabled } from "../wechat-entry";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const env = (value?: string): NodeJS.ProcessEnv =>
  (value === undefined ? {} : { WECHAT_BINDING_ENABLED: value }) as NodeJS.ProcessEnv;

console.log("wechat entry flag");

ok("未设置为关", () => {
  assert.equal(isWechatBindingEnabled(env()), false);
});

ok("空串、false、0、off、yes 为关", () => {
  for (const v of ["", "false", "0", "off", "yes"]) {
    assert.equal(isWechatBindingEnabled(env(v)), false, `"${v}" 应为关`);
  }
});

ok("true、TRUE、首尾带空白的 1、on 为开", () => {
  for (const v of ["true", "TRUE", " 1 ", "on"]) {
    assert.equal(isWechatBindingEnabled(env(v)), true, `"${v}" 应为开`);
  }
});

ok("只认 WECHAT_BINDING_ENABLED，不认前端构建变量", () => {
  const e = { NEXT_PUBLIC_WECHAT_BINDING_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;
  assert.equal(isWechatBindingEnabled(e), false);
});

ok("缺省读 process.env", () => {
  const prev = process.env.WECHAT_BINDING_ENABLED;
  try {
    process.env.WECHAT_BINDING_ENABLED = "on";
    assert.equal(isWechatBindingEnabled(), true);
    delete process.env.WECHAT_BINDING_ENABLED;
    assert.equal(isWechatBindingEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.WECHAT_BINDING_ENABLED;
    else process.env.WECHAT_BINDING_ENABLED = prev;
  }
});

console.log(`\nwechat-entry-flag: ${pass} passed, 0 failed`);
