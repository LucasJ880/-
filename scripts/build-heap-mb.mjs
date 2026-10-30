// next build 的堆上限（MB）。16GB 级构建机（生产 Enhanced）保持已验证的 7168；
// 32GB 及以上（qingyan-staging 的 60GB Turbo 机器在 7168 下 webpack 编译阶段 OOM）放到 16384。
import os from "node:os";
import { pathToFileURL } from "node:url";

const GIB = 1024 ** 3;

export function buildHeapMb(totalMemBytes) {
  return totalMemBytes >= 32 * GIB ? 16384 : 7168;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(buildHeapMb(os.totalmem()));
}
