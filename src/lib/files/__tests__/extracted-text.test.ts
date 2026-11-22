/**
 * FIX-13 解析出的文字入库前的清理（纯函数）
 * 运行：npx tsx src/lib/files/__tests__/extracted-text.test.ts
 */
import {
  NOT_UTF8_TEXT_ERROR,
  PARSE_ERROR_MAX_CHARS,
  TEXT_FILE_MAX_NUL_RATIO,
  TEXT_FILE_UNREADABLE_SAMPLE_CHARS,
  decodeTextFile,
  hasUnstorableChars,
  toStorableParseError,
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
  ok(
    NOT_UTF8_TEXT_ERROR === "文本文件不是 UTF-8 编码或含二进制内容，无法读取。请用记事本或 Excel 打开，另存为时编码选 UTF-8，Excel 里选「CSV UTF-8」格式；重新上传后删掉这一份" &&
      !/[（）()]/.test(NOT_UTF8_TEXT_ERROR),
    "这句原因写明怎么另存、重新上传后删掉旧的这一份；不带括号（面板上会拼进「（原因：…）」）",
  );
}
ok(textOf(decodeTextFile(Buffer.from(`check the box.\n${NUL} The Bidder declares`, "utf-8"))) === `check the box.\n${NUL} The Bidder declares`, "decodeTextFile：零星的 U+0000 不算不可读，原样交给 toStorableText 去换");
{
  const atLimit = `${NUL}${"x".repeat(9)}`; // 正好 10%
  const overLimit = `${NUL}${NUL}${"x".repeat(8)}`; // 20%
  ok(TEXT_FILE_MAX_NUL_RATIO === 0.1 && "text" in decodeTextFile(Buffer.from(atLimit, "utf-8")) && "error" in decodeTextFile(Buffer.from(overLimit, "utf-8")), "decodeTextFile：U+0000 占比正好 10% 仍可读，超过 10% 判为不可读");
}
ok(textOf(decodeTextFile(Buffer.alloc(0))) === "" && textOf(decodeTextFile(Buffer.from([0xff, 0xfe]))) === "", "decodeTextFile：空文件、只有字节序标记的文件 → 空字符串，不报错");

// —— 没有字节序标记、读出来 U+0000 不多的情况 ——
{
  const CHINESE = "投标须知：投标人须在截止时间之前提交全部文件。\r\n第二条 投标保证金为投标总价的百分之十。\r\n第三条 交货期为合同签订后三十日内。".repeat(4);
  const noBom = decodeTextFile(utf16(CHINESE)); // 中文为主：U+0000 只来自换行与标点，但两成以上解不出来（U+FFFD）
  ok("error" in noBom && noBom.error === NOT_UTF8_TEXT_ERROR, "decodeTextFile：没有字节序标记、以中文为主的 UTF-16 → 判为不可读（U+0000 加解不出的字符合计超过 10%）");
  const utf32 = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), Buffer.from(Array.from("Item,Qty\nFlag,10").flatMap((ch) => [ch.charCodeAt(0), 0, 0, 0]))]);
  const r32 = decodeTextFile(utf32);
  ok("error" in r32 && r32.error === NOT_UTF8_TEXT_ERROR, "decodeTextFile：UTF-32 小端（字节序标记也以 FF FE 开头）→ 判为不可读，不当成 UTF-16 读出隔字空格");
  const gbkLike = Buffer.from([0xcd, 0xb6, 0xb1, 0xea, 0xd0, 0xeb, 0xd6, 0xaa, 0x20, 0x41, 0x42, 0x43]); // GBK 的「投标须知 ABC」：没有 U+0000
  ok("text" in decodeTextFile(gbkLike), "decodeTextFile：不含 U+0000 的其它编码（如 GBK）照旧按 UTF-8 读（本次不识别，行为不变）");
}

// —— 失败原因写库前的收口 ——
{
  const longNul = `${"E".repeat(300)}${NUL}${"F".repeat(399)}`;
  const longNulOut = toStorableParseError(longNul);
  ok(longNul.length === 700 && longNulOut.length === 500 && longNulOut[300] === " " && !hasUnstorableChars(longNulOut), "toStorableParseError：一段 700 字、带 U+0000 的报错 → 截到 500 字、U+0000 换成空格、能入库");
  const long = "E".repeat(700);
  ok(PARSE_ERROR_MAX_CHARS === 500 && toStorableParseError(long).length === 500, "toStorableParseError：700 字的报错截到 500 字");
  ok(toStorableParseError(`Unrecognized tag: bad${NUL}tag`) === "Unrecognized tag: bad tag", "toStorableParseError：报错文字里的 U+0000 换成空格");
  const split = `${"x".repeat(499)}😀tail`; // 第 500 个字符是表情符号的前一半
  const cut = toStorableParseError(split);
  ok(cut.length === 500 && cut.endsWith(FFFD) && !hasUnstorableChars(cut), "toStorableParseError：截断劈开一对代理字符 → 末尾是 U+FFFD，长度仍是 500，能入库");
  ok(toStorableParseError("下载的文件内容为空") === "下载的文件内容为空" && toStorableParseError("") === "", "toStorableParseError：普通的短报错原样返回");
}

// 「读不了」只看开头：尾部才有一大串 U+0000 的大文本照样能读（改动前它能解析，存进去的那一段不含 U+0000）
{
  const body = "Mandatory requirement: bid bond 10% of the total price.\n".repeat(6000); // 约 33 万字
  const tailNul = Buffer.concat([Buffer.from(body, "utf-8"), Buffer.alloc(50_000)]);
  const r = decodeTextFile(tailNul);
  ok(TEXT_FILE_UNREADABLE_SAMPLE_CHARS === 200_000 && body.length > TEXT_FILE_UNREADABLE_SAMPLE_CHARS && "text" in r, "decodeTextFile：30 多万字的正常文本、尾部 5 万个 U+0000 → 仍可读（只看开头 20 万字）");
  ok("text" in r && toStorableText(r.text).slice(0, body.length) === body && !hasUnstorableChars(toStorableText(r.text)), "这样的文本清理后正文不变、尾部的 U+0000 变成空格、能入库");
  const headNul = Buffer.concat([Buffer.alloc(50_000), Buffer.from(body, "utf-8")]);
  ok("error" in decodeTextFile(headNul), "decodeTextFile：开头就是一大串 U+0000 → 仍判为不可读");
}

console.log(`\nfiles extracted-text: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
