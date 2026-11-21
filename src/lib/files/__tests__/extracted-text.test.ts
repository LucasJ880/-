/**
 * FIX-13 解析出的文字入库前的清理（纯函数）
 * 运行：npx tsx src/lib/files/__tests__/extracted-text.test.ts
 */
import { hasUnstorableChars, toStorableText } from "../extracted-text";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const NUL = "\u0000";
const HIGH = "\uD83D"; // 😀 的高位代理
const LOW = "\uDE00"; // 😀 的低位代理
const FFFD = "�";

console.log("files extracted-text（FIX-13）");

// —— U+0000 → 空格 ——
ok(toStorableText(`check the box.\n${NUL} The Bidder declare`) === "check the box.\n  The Bidder declare", "勾选框式：U+0000 换成一个空格，前后文字逐字不变");
ok(toStorableText(`left${NUL}right`) === "left right", "U+0000 夹在两个词之间：换成空格，两个词不粘在一起");
ok(toStorableText(NUL.repeat(5)) === "     " && toStorableText(NUL.repeat(5)).trim() === "", "整段都是 U+0000：变成同样个数的空格（trim 后为空 → 近乎空白）");
ok(toStorableText(`a${NUL}${NUL}b${NUL}`) === "a  b ", "多个 U+0000：一个换一个空格，长度不变");

// —— 落单代理字符 → U+FFFD ——
ok(toStorableText(`abc${HIGH}`) === `abc${FFFD}`, "末尾落单的高位代理字符 → U+FFFD");
ok(toStorableText(`${LOW}abc`) === `${FFFD}abc`, "开头落单的低位代理字符 → U+FFFD");
ok(toStorableText(`a${HIGH}b${LOW}c`) === `a${FFFD}b${FFFD}c`, "中间各自落单的高位与低位 → 各换成一个 U+FFFD");
ok(toStorableText(`${LOW}${HIGH}`) === `${FFFD}${FFFD}`, "顺序反了的一对（低位在前）：两个都算落单");
ok(toStorableText(`${HIGH}${HIGH}${LOW}`) === `${FFFD}😀`, "两个高位接一个低位：前一个落单，后两个成对保留");

// —— 其余字符原样保留 ——
const plain = "中文 English 😀𠮷\t制表\n换行\r\n回车换行\f换页 café — “引号”";
ok(toStorableText(plain) === plain, "中文、表情符号、扩展区汉字、制表、换行、换页都不变");
ok(toStorableText("") === "", "空字符串不变");
ok(toStorableText(`😀${NUL}😀`) === "😀 😀", "成对的代理字符不动，旁边的 U+0000 照换");

// —— 截断劈开代理对后再清理 ——
const emoji = `ab${"😀".repeat(3)}`; // 长度 8：a b H L H L H L
const cut = emoji.slice(0, 5); // a b H L H —— 最后一对被劈开
ok(hasUnstorableChars(cut) && toStorableText(cut) === `ab😀${FFFD}` && toStorableText(cut).length === 5, "截断劈开一对代理字符：落单的那半个 → U+FFFD，长度不变", cut);

// —— 只读判断 ——
ok(hasUnstorableChars(`a${NUL}`) && hasUnstorableChars(HIGH) && hasUnstorableChars(LOW), "hasUnstorableChars：U+0000、落单高位、落单低位都判为有");
ok(!hasUnstorableChars(plain) && !hasUnstorableChars("") && !hasUnstorableChars("😀"), "hasUnstorableChars：普通文字、空串、成对代理字符都判为没有");

// —— 结果一定能入库 ——
const messy = `${LOW}x${NUL}${HIGH}😀${HIGH}`;
ok(!hasUnstorableChars(toStorableText(messy)) && toStorableText(messy) === `${FFFD}x ${FFFD}😀${FFFD}`, "混在一起：清理后的结果不再含 U+0000 与落单代理字符");
ok(toStorableText(toStorableText(messy)) === toStorableText(messy), "清理两遍与清理一遍结果相同");

console.log(`\nfiles extracted-text: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
