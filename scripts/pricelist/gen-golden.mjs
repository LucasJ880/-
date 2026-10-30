#!/usr/bin/env node
/**
 * 用报价工作台 index.html 自带的 price() / usesFullness() / defaultPricing() 原函数生成黄金用例。
 * 不改一行源逻辑：只把这三个函数和它们依赖的 numeric / cents / clone 抽出来执行。
 * 用法：node scripts/pricelist/gen-golden.mjs <index.html> <seed.json> <out.json>
 */
import fs from "node:fs";
import vm from "node:vm";
const [html, seedPath, outPath] = process.argv.slice(2);
if (!html || !seedPath || !outPath) { console.error("用法：gen-golden.mjs <index.html> <seed.json> <out.json>"); process.exit(2); }
let code = fs.readFileSync(html, "utf8");
code = code.replace(/<script id="materials-data" type="application\/json">[\s\S]*?<\/script>/, "")
           .replace(/<script id="seed" type="application\/json">[\s\S]*?<\/script>/, "");
function fn(name) {
  const i = code.indexOf("function " + name + "(");
  if (i < 0) throw new Error("源码里找不到 function " + name);
  let j = code.indexOf("{", i), depth = 0, k = j;
  for (; k < code.length; k++) { if (code[k] === "{") depth++; else if (code[k] === "}") { depth--; if (depth === 0) break; } }
  return code.slice(i, k + 1);
}
const src = "const numeric=n=>typeof n==='number'&&Number.isFinite(n);const cents=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;const clone=o=>JSON.parse(JSON.stringify(o));\n"
  + fn("usesFullness") + "\n" + fn("price") + "\n" + fn("defaultPricing") + "\nexports.price=price;exports.defaultPricing=defaultPricing;";
const ctx = { exports: {}, Error, Number, Math, JSON, Object, Array };
vm.runInNewContext(src, ctx);
const { price, defaultPricing } = ctx.exports;
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const pr = defaultPricing(seed);
const cases = [];
const add = (row, tag) => {
  try { const r = price(pr, row); cases.push({ tag, input: row, expect: { msrp: r.msrp, standard: r.standard, install: r.install, discount: r.discount, floor: r.floor, billW: r.billW, billH: r.billH, cordless: r.cordless, bump: r.bump, fullnessApplied: r.fullnessApplied, lookupW: r.lookupW } }); }
  catch (e) { cases.push({ tag, input: row, expectError: e.message }); }
};
for (const [w, h] of [[18,30],[24,36],[30,42],[36.5,48],[42,54],[48,60],[54,66],[60,72],[66,75],[72,75],[78,75],[79,75],[78,76],[20,31.25]]) add({ product: "Fauxwood", fabric: "Standard", w, h }, "fauxwood");
for (const [w, h] of [[24,36],[30,42],[36,48],[48,60],[60,72],[72,84],[84,96],[90,108],[96,114],[108,120],[109,120],[108,121],[25.5,36.5],[12,20]]) add({ product: "Allusion", fabric: "Standard", w, h }, "allusion");
for (const [w, h] of [[24,36],[30,36],[48,60],[75,75],[76,60],[60,80],[90,100],[108,120]]) {
  add({ product: "Zebra", fabric: "Light Filtering", w, h, cordless: true }, "cordless-zebra");
  add({ product: "Zebra", fabric: "Blackout", w, h, cordless: true }, "cordless-zebra-bo");
  add({ product: "Roller", fabric: "Light Filtering (Open Roll)", w, h, cordless: true }, "cordless-roller");
  add({ product: "Roller", fabric: "Blackout w Cassette", w, h, cordless: true }, "cordless-roller-cassette");
}
add({ product: "Zebra", fabric: "Light Filtering", w: 24, h: 36, cordless: true, discountOverridePct: 0.45 }, "cordless-override");
add({ product: "Roller", fabric: "Light Filtering (Open Roll)", w: 24, h: 36, cordless: true, discountOverridePct: 0.5 }, "cordless-override");
for (const [w, h] of [[24,36],[48,60],[108,120]]) { add({ product: "Zebra", fabric: "Light Filtering", w, h }, "zebra"); add({ product: "Roller", fabric: "Blackout w Cassette", w, h }, "roller"); }
add({ product: "SHANGRILA", fabric: "Standard", w: 48, h: 60, cordless: true }, "cordless-ignored");
for (const f of [1, 1.8, 2, 2.5, 3, 4]) for (const [w, h] of [[50,108],[100,120],[150,216],[200,324],[300,108],[400,108]]) {
  add({ product: "Drapery", fabric: "Without liner", w, h, fullness: f }, "fullness-drapery");
  add({ product: "Sheer", fabric: "LF Prime", w, h, fullness: f }, "fullness-sheer");
}
add({ product: "Drapery", fabric: "With liner (Black out)", w: 100, h: 120 }, "fullness-default");
add({ product: "Drapery", fabric: "Without liner", w: 100, h: 120, fullness: 0.5 }, "fullness-invalid");
add({ product: "Drapery", fabric: "Without liner", w: 100, h: 120, fullness: 5 }, "fullness-invalid");
add({ product: "Sheer", fabric: "Door Screen Sheer", w: 25, h: 50, fullness: 3 }, "door-screen-no-fullness");
add({ product: "Sheer", fabric: "Door Screen Sheer", w: 30, h: 50 }, "door-screen");
add({ product: "Sheer", fabric: "Door Screen Sheer", w: 41, h: 50 }, "door-screen-err");
for (const [p, f, w, h] of [["Roman Shade","Light Filtering",24,36],["Roman Shade","Blackout",72,72],["SHANGRILA","Standard",120,120],["Cordless Cellular","Standard",120,120],["SkylightHoneycomb","Standard",66,78],["Shutters","Vinyl",10,24],["Shutters","Wood",126,120],["Shutters","Vinyl",70.5,60],["Roller","Light Filtering w Cassette",50,36],["Roller","Light Filtering w Cassette",49.9,36],["Zebra","Blackout",24,36]]) add({ product: p, fabric: f, w, h }, "regression");
fs.writeFileSync(outPath, JSON.stringify({ generatedBy: "上传工具 index.html 内置 price() 原函数 + defaultPricing(seed)，node 直接执行，未改一行逻辑", toolVersion: seed.version, count: cases.length, cases }, null, 1));
console.log("cases", cases.length, "expectError", cases.filter((c) => c.expectError).length, "->", outPath);
