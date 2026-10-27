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

ok("链接列（可选）：规格页、图片；品类名里有逗号也不受影响；非 https 报错；往返不丢", () => {
  const { refs, errors } = parseStyleReferenceText(
    [
      "MX-BL-001, Flannel / Coral Fleece Blanket, https://www.mengxinhometextile.com/products/blankets/flannel-coral-fleece-blanket, https://www.mengxinhometextile.com/email/styles/MX-BL-001.jpg",
      "MX-CP-001, Cushions, Pillows & Throws, https://www.mengxinhometextile.com/products/cushions-pillows/x",
    ].join("\n"),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(refs, [
    {
      code: "MX-BL-001",
      name: "Flannel / Coral Fleece Blanket",
      specUrl: "https://www.mengxinhometextile.com/products/blankets/flannel-coral-fleece-blanket",
      imageUrl: "https://www.mengxinhometextile.com/email/styles/MX-BL-001.jpg",
    },
    { code: "MX-CP-001", name: "Cushions, Pillows & Throws", specUrl: "https://www.mengxinhometextile.com/products/cushions-pillows/x" },
  ]);
  assert.deepEqual(parseStyleReferenceText(formatStyleReferenceText(refs)).refs, refs);
  assert.match(parseStyleReferenceText("MX-BL-001, Blanket, http://example.com/x").errors[0], /要以 https:\/\/ 开头/);
  const r = resolveStyles("MX-BL-001, MX-CP-001", refs);
  assert.equal(r[0].imageUrl, "https://www.mengxinhometextile.com/email/styles/MX-BL-001.jpg");
  assert.equal(r[1].specUrl, "https://www.mengxinhometextile.com/products/cushions-pillows/x");
});

console.log(`\n${pass} passed`);
