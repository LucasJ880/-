/**
 * 运行：npx tsx src/lib/knowledge/__tests__/text-chunk.test.ts
 */

import { chunkTextForEmbedding } from "../text-chunk";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

check("empty", chunkTextForEmbedding("").length === 0);
check("short single", chunkTextForEmbedding("短文本一条。").length === 1);
const long = "这是一段用于测试分块的中文句子。".repeat(80);
check("long splits", chunkTextForEmbedding(long).length > 1);

console.log(failed === 0 ? "\ntext-chunk 检查通过" : `\n失败 ${failed}`);
if (failed > 0) process.exit(1);
