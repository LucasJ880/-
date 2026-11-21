/**
 * FIX-13 解析出的文字入库前的清理（纯函数）
 * 运行：npx tsx src/lib/files/__tests__/extracted-text.test.ts
 */
import {
  NOT_UTF8_TEXT_ERROR,
  TEXT_FILE_MAX_NUL_RATIO,
  decodeTextFile,
  hasUnstorableChars,
  toStorableText,
} from "../extracted-text";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const NUL = "\u0000";
const HIGH = "\uD83D"; // 😀 的高位代理
const LOW = "\uDE00"; // 😀 的低位代理
const FFFD = String.fromCharCode(0xfffd);

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

// —— 纯文本 / CSV 的解码 ——
const textOf = (r: { text: string } | { error: string }) => ("text" in r ? r.text : `ERROR:${r.error}`);
const utf16 = (text: string, bigEndian = false) => {
  const body = Buffer.from(text, "utf16le");
  if (bigEndian) body.swap16();
  return body;
};
const SENTENCE = "投标须知 Mandatory: bid bond 10% 😀";
ok(textOf(decodeTextFile(Buffer.from(SENTENCE, "utf-8"))) === SENTENCE, "decodeTextFile：UTF-8 文本原样读出");
ok(textOf(decodeTextFile(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16(SENTENCE)]))) === SENTENCE, "decodeTextFile：FF FE 开头 → 按 UTF-16LE 读，文字逐字正确");
ok(textOf(decodeTextFile(Buffer.concat([Buffer.from([0xfe, 0xff]), utf16(SENTENCE, true)]))) === SENTENCE, "decodeTextFile：FE FF 开头 → 按 UTF-16BE 读，文字逐字正确");
{
  const be = Buffer.concat([Buffer.from([0xfe, 0xff]), utf16("AB", true)]);
  const before = Buffer.from(be);
  decodeTextFile(be);
  ok(be.equals(before), "decodeTextFile：按 UTF-16BE 读时不改动传进来的字节");
  ok(textOf(decodeTextFile(Buffer.concat([be, Buffer.from([0x00])]))) === "AB", "decodeTextFile：UTF-16BE 末尾多出半个字符的字节时不抛错，多出的那个字节丢掉");
}
{
  const r = decodeTextFile(utf16("Item,Qty,Unit price")); // 没有字节序标记的 UTF-16：按 UTF-8 读出来一半是 U+0000
  ok("error" in r && r.error === NOT_UTF8_TEXT_ERROR, "decodeTextFile：没有字节序标记的 UTF-16（满是 U+0000）→ 判为不可读，给出原因");
  ok(NOT_UTF8_TEXT_ERROR.length <= 500 && !hasUnstorableChars(NOT_UTF8_TEXT_ERROR), "这句原因本身不超过 500 字、能入库");
}
ok(textOf(decodeTextFile(Buffer.from(`check the box.\n${NUL} The Bidder declares`, "utf-8"))) === `check the box.\n${NUL} The Bidder declares`, "decodeTextFile：零星的 U+0000 不算不可读，原样交给 toStorableText 去换");
{
  const atLimit = `${NUL}${"x".repeat(9)}`; // 正好 10%
  const overLimit = `${NUL}${NUL}${"x".repeat(8)}`; // 20%
  ok(TEXT_FILE_MAX_NUL_RATIO === 0.1 && "text" in decodeTextFile(Buffer.from(atLimit, "utf-8")) && "error" in decodeTextFile(Buffer.from(overLimit, "utf-8")), "decodeTextFile：U+0000 占比正好 10% 仍可读，超过 10% 判为不可读");
}
ok(textOf(decodeTextFile(Buffer.alloc(0))) === "" && textOf(decodeTextFile(Buffer.from([0xff, 0xfe]))) === "", "decodeTextFile：空文件、只有字节序标记的文件 → 空字符串，不报错");

console.log(`\nfiles extracted-text: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
