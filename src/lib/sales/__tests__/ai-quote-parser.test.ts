/**
 * AI 报价文字解析（本地规则）：2026-10-28 价表新产品词表
 * 运行：npx tsx src/lib/sales/__tests__/ai-quote-parser.test.ts
 */
import assert from "node:assert/strict";
import { parseLocalQuotePlan } from "../ai-quote-parser";

const plan = parseLocalQuotePlan("2 faux wood 36x48; 1 allusion 48x60");
assert.equal(plan.items.length, 3, "2 行 Fauxwood + 1 行 Allusion");
assert.deepEqual(plan.items.map((i) => i.product), ["Fauxwood", "Fauxwood", "Allusion"]);
assert.equal(plan.items[0].fabric, "Standard");
assert.equal(plan.items[0].widthIn, 36);
assert.equal(plan.items[2].heightIn, 60);

const zh = parseLocalQuotePlan("仿木百叶 30x42; 梦幻帘 24x36; zebra bo 24x36");
assert.deepEqual(zh.items.map((i) => i.product), ["Fauxwood", "Allusion", "Zebra"], "中文别名与既有产品共存");
assert.equal(zh.items[2].fabric, "Blackout", "既有面料解析不受影响");

const hyphen = parseLocalQuotePlan("fauxwood 20x30; faux-wood 24x36");
assert.equal(hyphen.items.length, 2, "fauxwood / faux-wood 两种写法");

console.log("AI 报价文字解析（Fauxwood / Allusion 词表）通过");
