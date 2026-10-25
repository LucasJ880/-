/**
 * 款号参考表 纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/style-references.test.ts
 */

import assert from "node:assert/strict";
import {
  describeStyle,
  formatStyleReferenceText,
  parseStyleReferenceText,
  resolveStyles,
} from "../style-references";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("style-references");

ok("解析：逗号 / 中文逗号 / 制表符 / 竖线都行；款号归一；空行和 # 注释忽略；重复款号以最后一次为准", () => {
  const { refs, errors } = parseStyleReferenceText(
    [
      "# 梦馨参考款",
      "mx-bl-001, Flannel / Coral Fleece Blanket",
      "MX-BR-001，Solid / Hotel / Spa Bathrobes",
      "MX-CP-001\tCustom Cushions & Decorative Pillows",
      "",
      "MX-SP-202606 | Printed Flannel TV Blanket",
      "MX-BL-001, Flannel Blanket",
    ].join("\n"),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(refs, [
    { code: "MX-BL-001", name: "Flannel Blanket" },
    { code: "MX-BR-001", name: "Solid / Hotel / Spa Bathrobes" },
    { code: "MX-CP-001", name: "Custom Cushions & Decorative Pillows" },
    { code: "MX-SP-202606", name: "Printed Flannel TV Blanket" },
  ]);
});

ok("解析：缺品类名、款号格式不对 → 按行报错", () => {
  const { errors } = parseStyleReferenceText("MX-BL-001\n毛毯, Blanket\nMX-BR-001, Robe");
  assert.deepEqual(errors, ["第 1 行：缺少品类名（格式：款号, 品类名）", "第 2 行：款号格式不对：毛毯"]);
});

ok("往返：格式化后能原样解析回来", () => {
  const refs = [
    { code: "MX-BL-001", name: "Flannel / Coral Fleece Blanket" },
    { code: "MX-GF-001", name: "Plush Hot Water Bottle Cover" },
  ];
  assert.deepEqual(parseStyleReferenceText(formatStyleReferenceText(refs)).refs, refs);
});

ok("对照：按卡上顺序，不在表里的款号 name = null；写法「品类名 (ref. 款号)」", () => {
  const refs = [{ code: "MX-BL-001", name: "Flannel / Coral Fleece Blanket" }];
  const r = resolveStyles("MX-BR-009, mx-bl-001", refs);
  assert.deepEqual(r, [
    { code: "MX-BR-009", name: null },
    { code: "MX-BL-001", name: "Flannel / Coral Fleece Blanket" },
  ]);
  assert.equal(describeStyle(r[1]), "Flannel / Coral Fleece Blanket (ref. MX-BL-001)");
  assert.equal(describeStyle(r[0]), "MX-BR-009");
  assert.deepEqual(resolveStyles("", refs), []);
});

console.log(`\n${pass} passed`);
