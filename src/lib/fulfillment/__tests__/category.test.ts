/**
 * PERM-3：品类映射（纯函数）
 * 运行：npx tsx src/lib/fulfillment/__tests__/category.test.ts
 */
import { CATEGORIES, CATEGORY_POSITION, categoryOfProductType, categoryOfQuoteProduct, orderCategories, orderCategoriesWithSpec, specCategories, updateKeyFor } from "../category";

let pass = 0, fail = 0;
function ok(c: boolean, n: string) { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } }

console.log("PERM-3 品类映射");
for (const pt of ["卷帘", "斑马帘", "香格里拉"]) ok(categoryOfProductType(pt) === "shades", `工艺单行 ${pt} → shades`);
ok(categoryOfProductType("百叶窗X") === null && categoryOfProductType("") === null && categoryOfProductType(null) === null, "未知 / 空 → null");
ok(categoryOfProductType(" 斑马帘 ") === "shades", "首尾空白容忍");
const shades = ["Zebra", "Roller", "SHANGRILA", "Cordless Cellular", "SkylightHoneycomb", "Roman Shade", "Roman", "Allusion"];
ok(shades.every((p) => categoryOfQuoteProduct(p) === "shades"), "报价行窗饰产品 → shades");
ok(categoryOfQuoteProduct("Drapery") === "drapery" && categoryOfQuoteProduct("Sheer") === "drapery", "Drapery / Sheer → drapery");
ok(categoryOfQuoteProduct("Shutters") === "vinyl", "Shutters → vinyl（判断点 2 默认值）");
ok(categoryOfQuoteProduct("Unknown") === null, "未知报价产品 → null");

console.log("PERM-3 单据品类集合");
ok(orderCategories([{ productType: "斑马帘" }, { productType: "斑马帘" }, { productType: "卷帘" }]).join(",") === "shades", "4 行全 shades → {shades}");
ok(orderCategories([{ productType: "未知" }]).length === 0 && orderCategories([]).length === 0, "全未知 / 空 → 空集合");
ok(CATEGORIES.every((c) => updateKeyFor(c) === `orders.fulfillment.update.${c}` && CATEGORY_POSITION[c].key === `fulfillment_${c}`), "键名与岗位 key 一一对应");

console.log("PERM-3 × sunny-process：参数行计入品类");
const emptySpec = { domestic: [], drapes: [], vinyl: [], purchase: [] };
ok(specCategories(null).length === 0 && specCategories(emptySpec).length === 0, "无参数 / 空参数 → 空集合");
ok(specCategories({ ...emptySpec, domestic: [{}] }).join(",") === "shades", "国内下单表 → shades");
ok(specCategories({ ...emptySpec, drapes: [{}], vinyl: [{}] }).join(",") === "vinyl,drapery", "窗帘 + Vinyl → {vinyl, drapery}");
ok(specCategories({ ...emptySpec, purchase: [{ section: "shutter" }, { section: "drape" }, { section: "shade" }, { section: "x" }] }).join(",") === "vinyl,drapery,shades", "外采购按段：shutter → vinyl / drape → drapery / shade → shades；未知段不计");
ok(orderCategoriesWithSpec([{ productType: "斑马帘" }], { ...emptySpec, vinyl: [{}] }).join(",") === "vinyl,shades", "工艺单行 + 参数行取并集");
ok(orderCategoriesWithSpec([], { ...emptySpec, drapes: [{}] }).join(",") === "drapery", "全部发给国内后 items 为空：品类仍来自参数行");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
